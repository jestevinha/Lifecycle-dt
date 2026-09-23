/**
 * Verification probe — LinUCB feature normalization fix.
 *
 * Runs the REAL production loop (mirrors experiments.ts interactive path exactly,
 * including decisionState tracking) for MAB, LinUCB, and Q-Learning.
 * Reports per-agent: last-25% mean±std, best-ever reward, gap-to-best.
 * Also reports LinUCB θ weights per dimension to verify temperature is no longer dominant.
 *
 * Run: npx tsx packages/engine/src/probe-verify-fix.ts
 */

import { MABAgent }       from "./agents/mab.js";
import { LinUCBAgent }    from "./agents/linucb.js";
import { QLearningAgent } from "./agents/qlearning.js";
import type { Agent }     from "./agents/types.js";
import { runInteractiveSimulation } from "./runner.js";
import {
  computeStepReward, aggregateShiftReward, extractState,
  WEAR_THRESHOLD, maintenancePenalty,
} from "./reward.js";
import { ACTIONS, STEPS_PER_SHIFT } from "./actions.js";
import type { KpiStep, State } from "./types.js";

const N_EPISODES = 500;   // matches exp 25 for clean comparison
const SIM_STEPS  = 240;   // 30 shifts per episode (matches production)
const BASE_SEED  = 1234;

// ── Mirrors experiments.ts interactive loop ───────────────────────────────────

async function runAgentEpisodes(
  agentName: string,
  agent: Agent,
): Promise<void> {
  console.log(`\n─── ${agentName} (${N_EPISODES} episodes) ────────────────────────────────`);

  const episodeRewards: number[] = [];
  let bestEver = -Infinity;

  // Carry state across episodes (same as experiments.ts: prevState persists)
  const nullKpi: KpiStep = {
    step: 0, auditDay: 0, weekDay: 0, clock: "00:00",
    ambTemperature: 20, rawMaterialQuality: 0.5,
    currPower: 0, totalRate: 0, setpointRate: 0,
    cumProduction: 0, cumEnergy: 0, cumCost: 0,
    productEnergy: 0, productCost: 0, numberAccidents: 0,
  };
  let prevState: State = extractState(nullKpi, SIM_STEPS);

  for (let ep = 0; ep < N_EPISODES; ep++) {
    const seed = BASE_SEED + ep;

    // ── Per-episode state ──
    let decisionState: State = prevState;
    let currentActionId = agent.selectAction(prevState);

    let prevAccidents = 0;
    let prevWear: number[] = new Array(16).fill(0);
    let subStep = 0;
    let maintTarget = -1;
    let preMaintenanceWearFrac = 0;
    let shiftRate = ACTIONS[currentActionId].setpointRate;
    let shiftStepRewards: ReturnType<typeof computeStepReward>[] = [];
    const allStepRewards: ReturnType<typeof computeStepReward>[] = [];

    function resolveCommand(): number | { rate: number; maintainWorkarea: number } {
      shiftRate = ACTIONS[currentActionId].setpointRate;
      const firstEligible = prevWear.findIndex(w => w < WEAR_THRESHOLD);
      const maxIdx = firstEligible < 0
        ? 0
        : prevWear.reduce(
            (best, w, idx) => (w < WEAR_THRESHOLD && w > prevWear[best] ? idx : best),
            firstEligible,
          );
      const maxWearFrac = prevWear.length > 0 && firstEligible >= 0
        ? prevWear[maxIdx] / WEAR_THRESHOLD
        : 0;
      if (firstEligible >= 0 && prevWear[maxIdx] > 0 && ACTIONS[currentActionId].maintainNow) {
        maintTarget = maxIdx;
        preMaintenanceWearFrac = maxWearFrac;
        return { rate: shiftRate, maintainWorkarea: maintTarget };
      }
      maintTarget = -1;
      preMaintenanceWearFrac = 0;
      return shiftRate;
    }

    const steps = await runInteractiveSimulation(
      { steps: SIM_STEPS, seed },
      resolveCommand(),
      (kpiStep: KpiStep, stepIndex: number) => {
        subStep++;
        const accidentDelta = kpiStep.numberAccidents - prevAccidents;
        prevAccidents = kpiStep.numberAccidents;
        const stepReward = computeStepReward(kpiStep, accidentDelta, prevWear);
        shiftStepRewards.push(stepReward);
        allStepRewards.push(stepReward);
        prevWear = kpiStep.wearByWorkarea ? [...kpiStep.wearByWorkarea] : prevWear;

        if (subStep >= STEPS_PER_SHIFT || stepIndex === SIM_STEPS - 1) {
          let shiftReward = aggregateShiftReward(shiftStepRewards);
          if (maintTarget >= 0) shiftReward -= maintenancePenalty(preMaintenanceWearFrac);

          const shiftState = extractState(kpiStep, SIM_STEPS);
          const done = stepIndex === SIM_STEPS - 1;
          // Fixed call: prevState = decisionState (decision-time context)
          agent.update(currentActionId, shiftReward, decisionState, shiftState, done);
          decisionState = shiftState;
          currentActionId = agent.selectAction(shiftState);
          subStep = 0;
          shiftStepRewards = [];
          return resolveCommand();
        }
        return shiftRate;
      },
    );

    if (steps.length === 0) continue;

    prevState = extractState(steps[steps.length - 1], SIM_STEPS);
    const epReward = aggregateShiftReward(allStepRewards);
    episodeRewards.push(epReward);
    if (epReward > bestEver) bestEver = epReward;

    agent.decayEpsilon?.();
    agent.advanceEpisode?.();

    // Progress tick
    if ((ep + 1) % 10 === 0 || ep === N_EPISODES - 1) {
      const eps = agent.getEpsilon?.();
      const qSize = agent.getStateSize?.();
      const msg = [
        `ep${ep + 1}`,
        eps != null ? `ε=${eps.toFixed(3)}` : null,
        qSize != null ? `|Q|=${qSize}` : null,
        `R=${epReward.toFixed(2)}`,
      ].filter(Boolean).join(" ");
      process.stdout.write(`  ${msg}\n`);
    }
  }

  // ── Report ──
  const windowStart = Math.floor(N_EPISODES * 0.75);
  const lastQ = episodeRewards.slice(windowStart);
  const mean  = lastQ.reduce((a, b) => a + b, 0) / lastQ.length;
  const std   = Math.sqrt(lastQ.reduce((a, b) => a + (b - mean) ** 2, 0) / lastQ.length);
  const gap   = bestEver - mean;

  console.log(`\n  Results (last 25% = eps ${windowStart}–${N_EPISODES - 1}):`);
  console.log(`    mean reward : ${mean.toFixed(2)}`);
  console.log(`    std         : ${std.toFixed(2)}`);
  console.log(`    best-ever   : ${bestEver.toFixed(2)}`);
  console.log(`    gap to best : ${gap.toFixed(2)}`);
}

// ── Theta-weight diagnostic for LinUCB ───────────────────────────────────────

const DIM_NAMES = ["ambTemp[0,1]", "rawMatQuality", "stepNorm", "shiftPhase", "accidents[0,1]", "maxWear"];

function matVecMul(M: number[][], v: number[]): number[] {
  return M.map(row => row.reduce((s, x, i) => s + x * v[i], 0));
}

function invertMatrix(M: number[][]): number[][] {
  const n = M.length;
  const aug = M.map((row, i) => {
    const r = [...row];
    for (let j = 0; j < n; j++) r.push(i === j ? 1 : 0);
    return r;
  });
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-12) continue;
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivot;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = aug[row][col];
      for (let j = 0; j < 2 * n; j++) aug[row][j] -= f * aug[col][j];
    }
  }
  return aug.map(row => row.slice(n));
}

function reportLinUCBWeights(agent: LinUCBAgent): void {
  const A = (agent as unknown as { A: number[][][] }).A;
  const b = (agent as unknown as { b: number[][] }).b;

  console.log("\n  LinUCB θ weights per action (normalized feature space):");
  console.log(`  ${"action".padEnd(22)} ${DIM_NAMES.map(n => n.padStart(15)).join("  ")}`);

  for (let a = 0; a < ACTIONS.length; a++) {
    const Ainv = invertMatrix(A[a]);
    const theta = matVecMul(Ainv, b[a]);
    const name = ACTIONS[a].name.padEnd(22);
    const weights = theta.map((w, i) => (i < DIM_NAMES.length ? w.toFixed(4).padStart(15) : "")).join("  ");
    console.log(`  ${name} ${weights}`);
  }

  // Per-dimension max |θ| across all actions (shows which dims the model uses most)
  const nDims = b[0].length;
  const maxAbsTheta = new Array(nDims).fill(0);
  for (let a = 0; a < ACTIONS.length; a++) {
    const Ainv = invertMatrix(A[a]);
    const theta = matVecMul(Ainv, b[a]);
    for (let d = 0; d < nDims; d++) {
      if (Math.abs(theta[d]) > maxAbsTheta[d]) maxAbsTheta[d] = Math.abs(theta[d]);
    }
  }

  console.log(`\n  Max |θ| per dimension (across all actions):`);
  for (let d = 0; d < nDims; d++) {
    const label = (DIM_NAMES[d] ?? `dim${d}`).padEnd(22);
    const bar = "█".repeat(Math.round(Math.min(maxAbsTheta[d], 5) * 4));
    console.log(`    ${label}  ${maxAbsTheta[d].toFixed(4)}  ${bar}`);
  }

  const tempMax  = maxAbsTheta[0] || 1e-9;
  const wearMax  = nDims >= 6 ? maxAbsTheta[5] : 0;
  const ratio    = tempMax / (wearMax || 1e-9);
  console.log(`\n  temp/wear |θ| ratio: ${ratio.toFixed(2)}× (pre-fix was ~20–70×; target: near 1×)`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("Verification — LinUCB feature normalization fix");
  console.log(`N_EPISODES=${N_EPISODES}, SIM_STEPS=${SIM_STEPS} (${SIM_STEPS / STEPS_PER_SHIFT} shifts/ep), wearRateSpread=0 (lockstep)`);
  console.log("Hyperparams: MAB ε-decay=0.91 | LinUCB α=2.5 | QL ε-decay=0.99 γ=0.95 α=0.1");
  console.log("Fix: stateToVector normalises all dims to [0,1] using fixed a-priori ranges");
  console.log("     ambTemp:[10,30] rawMat:[0,1] stepNorm:[0,1] phase:[0,1] accidents:[0,10] wear:[0,1]");
  console.log("═══════════════════════════════════════════════════════════════");

  const mab  = new MABAgent(1.0, 0.91, 0.01);
  const lucb = new LinUCBAgent(2.5);
  const ql   = new QLearningAgent(0.1, 0.95, 1.0, 0.99, 0.01);

  await runAgentEpisodes("MAB      (ε-decay=0.91, sample-avg)", mab);
  await runAgentEpisodes("LinUCB   (α=2.5)", lucb);
  await runAgentEpisodes("Q-Learning (ε-decay=0.99, γ=0.95, α=0.1)", ql);

  console.log("\n── LinUCB weight diagnostic ────────────────────────────────────");
  reportLinUCBWeights(lucb);

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("VERIFICATION SUMMARY — see 'Results' lines above per agent");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");
  console.log("ENVIRONMENT CONTROL: MAB best-ever should be ≈ −18 (same as exp 25/23).");
  console.log("  If MAB best-ever drifted from −18, the environment changed — comparison is void.");
  console.log("");
  console.log("NORMALIZATION FIX CRITERIA:");
  console.log("  LinUCB mean (last 25%) should rise from ~−107 toward best-ever (~−18.5).");
  console.log("  LinUCB converged policy should move off medium_t60 toward low-rate safe basin.");
  console.log("  temp/wear |θ| ratio should be near 1× (was 20–70× before fix).");
  console.log("  MAB and Q-Learning: expect UNCHANGED (they do not use LinUCB's stateToVector).");
}

main().catch(err => { console.error("Probe failed:", err); process.exit(1); });
