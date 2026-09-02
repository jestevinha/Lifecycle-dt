/**
 * Q-Learning falsifiability probe.
 *
 * Falsifiable question: with ε=0, is the action taken always argmax Q[s]?
 *
 * Protocol:
 *   1. Train a QLearningAgent for TRAIN_EPISODES to populate the Q-table
 *      with non-trivial values (otherwise all entries are 0 and the argmax
 *      is trivially action 0 at every step — no discriminating power).
 *   2. Freeze ε=0.  Run one traced episode through the same interactive-mode
 *      loop that experiments.ts uses.
 *   3. At EVERY selectAction call, log:
 *        • key produced by selectAction (= lastStateKey stored for update)
 *        • full Q-value vector for that key
 *        • argmax index (expected action)
 *        • actual action returned
 *        • MATCH / MISMATCH
 *   4. At every update call, log:
 *        • key actually used inside update (lastStateKey at call time)
 *        • whether it equals the immediately prior selectAction key
 *
 * Run as: npx tsx packages/engine/src/probe-qlearning-trace.ts
 */
import { QLearningAgent } from "./agents/qlearning.js";
import { runInteractiveSimulation } from "./runner.js";
import { ACTIONS, STEPS_PER_SHIFT, shouldTriggerMaintenance } from "./actions.js";
import { computeStepReward, aggregateShiftReward, WEAR_THRESHOLD, maintenancePenalty, MAINT_IDEAL_WEAR } from "./reward.js";
import { extractState } from "./reward.js";
import type { KpiStep, State } from "./types.js";

const TRAIN_EPISODES  = 25;     // enough to get non-trivial Q-values
const SEED_BASE       = 42;
const SIM_STEPS       = 240;    // 30 shifts per episode

// ── Monkey-patch wrapper ──────────────────────────────────────────────────────

interface TraceRecord {
  shiftNum:    number;
  callType:    "select" | "update";
  key:         string;
  qValues:     number[];
  argmax:      number;
  action:      number;
  match:       boolean;           // action === argmax (only meaningful for select)
  updateKey:   string | null;     // key inside lastStateKey at update time
  keysMatch:   boolean | null;    // updateKey === prior selectKey (only for update)
}

function patchAgent(agent: QLearningAgent) {
  const records: TraceRecord[] = [];
  let shiftNum = 0;
  let lastSelectKey = "";

  const origSelect = agent.selectAction.bind(agent);
  const origUpdate = agent.update.bind(agent);

  agent.selectAction = (state) => {
    const action = origSelect(state);
    // Read the private fields at runtime (compiled TS has no runtime privacy)
    const key    = (agent as unknown as Record<string,unknown>).lastStateKey as string;
    const table  = (agent as unknown as Record<string,unknown>).qTable as Map<string, number[]>;
    const qVals  = table.get(key) ?? new Array(ACTIONS.length).fill(0);
    const argmax = qVals.indexOf(Math.max(...qVals));

    lastSelectKey = key;
    records.push({
      shiftNum, callType: "select", key, qValues: [...qVals],
      argmax, action, match: action === argmax,
      updateKey: null, keysMatch: null,
    });
    return action;
  };

  agent.update = (action, reward, prevState, nextState, done = false) => {
    origUpdate(action, reward, prevState, nextState, done);
    const updateKey = (agent as unknown as Record<string,unknown>).lastStateKey as string;
    const keysMatch = updateKey === lastSelectKey;
    records.push({
      shiftNum, callType: "update", key: lastSelectKey,
      qValues: [], argmax: -1, action,
      match: true,          // n/a for update
      updateKey, keysMatch,
    });
    shiftNum++;
  };

  return records;
}

// ── Replicated interactive loop (mirrors experiments.ts) ──────────────────────

async function runEpisode(
  agent: QLearningAgent,
  seed: number,
  traceRecords: TraceRecord[] | null,
  prevState = extractState(
    { step: 0, auditDay: 0, weekDay: 0, clock: "00:00",
      ambTemperature: 20, rawMaterialQuality: 0.5,
      currPower: 0, totalRate: 0, setpointRate: 0,
      cumProduction: 0, cumEnergy: 0, cumCost: 0,
      productEnergy: 0, productCost: 0, numberAccidents: 0 },
    SIM_STEPS,
  ),
) {
  let decisionState: State = prevState;
  let currentActionId = agent.selectAction(prevState);
  let prevAccidents = 0;
  let prevWear: number[] = new Array(16).fill(0);
  let subStep = 0;
  let shiftStepRewards: ReturnType<typeof computeStepReward>[] = [];
  let maintTarget = -1;
  let preMaintenanceWearFrac = 0;
  let shiftRate = ACTIONS[currentActionId].setpointRate;

  function resolveCommand() {
    shiftRate = ACTIONS[currentActionId].setpointRate;
    const maxIdx = prevWear.reduce((best, w, idx) => (w > prevWear[best] ? idx : best), 0);
    const maxWearFrac = prevWear.length > 0 ? prevWear[maxIdx] / WEAR_THRESHOLD : 0;
    if (prevWear[maxIdx] > 0 && shouldTriggerMaintenance(currentActionId, maxWearFrac)) {
      maintTarget = maxIdx;
      preMaintenanceWearFrac = maxWearFrac;
      return { rate: shiftRate, maintainWorkarea: maintTarget };
    }
    maintTarget = -1;
    preMaintenanceWearFrac = 0;
    return shiftRate;
  }

  let lastShiftState = prevState;

  await runInteractiveSimulation(
    { steps: SIM_STEPS, seed },
    resolveCommand(),
    (kpiStep: KpiStep, stepIndex: number) => {
      subStep++;
      const accidentDelta = kpiStep.numberAccidents - prevAccidents;
      prevAccidents = kpiStep.numberAccidents;
      const reward = computeStepReward(kpiStep, accidentDelta, prevWear);
      shiftStepRewards.push(reward);
      prevWear = kpiStep.wearByWorkarea ? [...kpiStep.wearByWorkarea] : prevWear;

      if (subStep >= STEPS_PER_SHIFT || stepIndex === SIM_STEPS - 1) {
        let shiftReward = aggregateShiftReward(shiftStepRewards);
        if (maintTarget >= 0) shiftReward -= maintenancePenalty(preMaintenanceWearFrac);

        const shiftState = extractState(kpiStep, SIM_STEPS);
        const done = stepIndex === SIM_STEPS - 1;
        agent.update(currentActionId, shiftReward, decisionState, shiftState, done);
        decisionState = shiftState;
        currentActionId = agent.selectAction(shiftState);
        lastShiftState = shiftState;
        subStep = 0;
        shiftStepRewards = [];
        return resolveCommand();
      }
      return shiftRate;
    },
  );

  return lastShiftState;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const agent = new QLearningAgent(
    0.1,   // alpha
    0.95,  // gamma
    1.0,   // epsilon (will decay during training)
    0.92,  // epsilonDecay
    0.01,  // epsilonMin
  );

  // ── Phase 1: training ──
  console.log(`\nPhase 1: training for ${TRAIN_EPISODES} episodes to populate Q-table…`);
  let state = extractState(
    { step: 0, auditDay: 0, weekDay: 0, clock: "00:00",
      ambTemperature: 20, rawMaterialQuality: 0.5,
      currPower: 0, totalRate: 0, setpointRate: 0,
      cumProduction: 0, cumEnergy: 0, cumCost: 0,
      productEnergy: 0, productCost: 0, numberAccidents: 0 },
    SIM_STEPS,
  );
  for (let ep = 0; ep < TRAIN_EPISODES; ep++) {
    state = await runEpisode(agent, SEED_BASE + ep, null, state);
    agent.decayEpsilon();
    if ((ep + 1) % 5 === 0) {
      process.stdout.write(` ep${ep + 1}(ε=${agent.getEpsilon().toFixed(3)},|Q|=${(agent as unknown as Record<string,unknown>).qTable instanceof Map ? ((agent as unknown as {qTable: Map<string,unknown>}).qTable.size) : "?"})`);
    }
  }
  console.log("\nTraining done.\n");

  const qTableSize = (agent as unknown as {qTable: Map<string, number[]>}).qTable.size;
  console.log(`Q-table entries: ${qTableSize}`);
  if (qTableSize < 3) {
    console.warn("WARNING: Q-table has fewer than 3 entries — trace episode will have low discriminating power.");
  }

  // ── Phase 2: freeze epsilon, attach tracer, run one episode ──
  console.log("\nPhase 2: traced episode with ε=0…\n");
  // Directly set epsilon to 0 (runtime access — no setter in interface)
  (agent as unknown as {epsilon: number}).epsilon = 0;

  const records = patchAgent(agent);
  await runEpisode(agent, SEED_BASE + TRAIN_EPISODES, records, state);

  // ── Report ────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(90)}`);
  console.log(`TRACE REPORT — ${records.length} events (${records.filter(r => r.callType === "select").length} shifts)`);
  console.log(`${"─".repeat(90)}\n`);

  let mismatches = 0;
  let keyDivergences = 0;
  let selectCount = 0;
  let updateCount = 0;

  let lastSelectRecord: TraceRecord | null = null;

  for (const r of records) {
    if (r.callType === "select") {
      selectCount++;
      const matchStr = r.match ? "OK" : "MISMATCH";
      if (!r.match) mismatches++;
      const qStr = r.qValues.map(v => v.toFixed(3)).join(", ");
      console.log(
        `  shift ${String(r.shiftNum).padStart(2)} SELECT  key=${r.key}  ` +
        `Q=[${qStr}]  argmax=${r.argmax}  taken=${r.action}  ${matchStr}`,
      );
      lastSelectRecord = r;
    } else {
      updateCount++;
      const kMatch = r.keysMatch ? "keys-match" : "KEY-DIVERGE";
      if (!r.keysMatch) keyDivergences++;
      console.log(
        `  shift ${String(r.shiftNum).padStart(2)} UPDATE  lastStateKey=${r.updateKey}  ` +
        `selectKey=${lastSelectRecord?.key ?? "?"}  ${kMatch}`,
      );
    }
  }

  console.log(`\n${"─".repeat(90)}`);
  console.log(`VERDICT`);
  console.log(`${"─".repeat(90)}`);
  console.log(`  Select calls:      ${selectCount}`);
  console.log(`  Update calls:      ${updateCount}`);
  console.log(`  Key divergences:   ${keyDivergences}`);
  console.log(`  Action mismatches: ${mismatches}`);
  console.log();

  if (keyDivergences > 0) {
    console.error(`  FAIL — lastStateKey used by update differs from prior selectAction key`);
    console.error(`  Bug: agent.update is bootstrapping with the wrong state.`);
  } else {
    console.log(`  PASS — keys consistent: update always uses the key from the immediately prior selectAction`);
  }

  if (mismatches > 0) {
    console.error(`  FAIL — action taken ≠ argmax Q[s] with ε=0`);
    console.error(`  Bug: greedy policy is not selecting the argmax.`);
  } else {
    console.log(`  PASS — action taken = argmax Q[s] at every shift with ε=0`);
  }

  if (keyDivergences === 0 && mismatches === 0) {
    console.log(`\n  Both invariants hold. Q-Learning selectAction and update are consistent.`);
  }
}

main().catch((err) => {
  console.error("Probe failed:", err);
  process.exit(1);
});
