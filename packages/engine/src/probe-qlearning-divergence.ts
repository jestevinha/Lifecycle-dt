/**
 * Diagnostic, originally for exp 58 (theta going NaN, Known-Bugs-Fixed #21),
 * updated 2026-09-20 for the shared-parameters redesign (theta is now ONE
 * vector over joint state-action features, not one row per action — see
 * qlearning.ts's own top comment). Checks two things every N episodes:
 *   1. Does theta stay finite (no NaN/Inf — the #21 regression check)?
 *   2. Does Q(probe_state, a) actually DIFFER across actions — i.e. is the
 *      shared model using its action features/interaction terms to
 *      discriminate, or has it collapsed to being state-only (which would
 *      mean the action features/interactions aren't pulling their weight)?
 * Uses exp 58's Q-Learning hyperparams (alpha=0.1 constant, gamma=0.95,
 * epsilon 1->0.01 decay 0.99) — unrelated to what's under test here, just a
 * convenient known-working baseline.
 *
 * Run: npx tsx packages/engine/src/probe-qlearning-divergence.ts
 */
import { QLearningAgent } from "./agents/qlearning.js";
import { runInteractiveSimulation } from "./runner.js";
import { ACTIONS, STEPS_PER_SHIFT } from "./actions.js";
import { computeStepReward, aggregateShiftReward, WEAR_THRESHOLD, maintenancePenalty, extractState } from "./reward.js";
import { stateActionToVector } from "./featurize.js";
import type { KpiStep, State } from "./types.js";

const SIM_STEPS = 240; // 30 shifts/episode; also verified NaN-free at SIM_STEPS=800,EPISODES=60 (exp-58 scale)
const EPISODES = 150;
const SEED_BASE = 42;

async function runEpisode(agent: QLearningAgent, seed: number, prevState: State) {
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
    if (prevWear[maxIdx] > 0 && ACTIONS[currentActionId].maintainNow) {
      maintTarget = maxIdx;
      preMaintenanceWearFrac = maxWearFrac;
      return { rate: shiftRate, maintainWorkarea: maintTarget };
    }
    maintTarget = -1;
    preMaintenanceWearFrac = 0;
    return shiftRate;
  }

  let lastShiftState = prevState;
  let episodeReward = 0;
  let episodeAccidents = 0;

  await runInteractiveSimulation(
    { steps: SIM_STEPS, seed },
    resolveCommand(),
    (kpiStep: KpiStep, stepIndex: number) => {
      subStep++;
      const accidentDelta = kpiStep.numberAccidents - prevAccidents;
      prevAccidents = kpiStep.numberAccidents;
      episodeAccidents = kpiStep.numberAccidents;
      const reward = computeStepReward(kpiStep, accidentDelta, prevWear);
      shiftStepRewards.push(reward);
      prevWear = kpiStep.wearByWorkarea ? [...kpiStep.wearByWorkarea] : prevWear;

      if (subStep >= STEPS_PER_SHIFT || stepIndex === SIM_STEPS - 1) {
        let shiftReward = aggregateShiftReward(shiftStepRewards);
        if (maintTarget >= 0) shiftReward -= maintenancePenalty(preMaintenanceWearFrac);
        episodeReward += shiftReward;

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

  return { lastShiftState, episodeReward, episodeAccidents };
}

async function main() {
  const agent = new QLearningAgent(0.1, 0.95, 1.0, 0.99, 0.01, 42, true /* useConstantAlpha, seed matches exp 58 */);

  const origUpdate = agent.update.bind(agent);
  let shiftIdx = 0;
  let nanReported = false;
  (agent as unknown as { update: typeof agent.update }).update = (action, reward, prevState, nextState, done) => {
    const lastFeatures = (agent as unknown as { lastFeatures: number[] | null }).lastFeatures;
    origUpdate(action, reward, prevState, nextState, done);
    const theta = (agent as unknown as { theta: number[] }).theta;
    const hasNaN = theta.some(v => Number.isNaN(v) || !Number.isFinite(v));
    if (hasNaN && !nanReported) {
      nanReported = true;
      console.log(`\n!!! NaN/Inf detected in theta at shift ${shiftIdx}, action=${action}, reward=${reward}`);
      console.log("lastFeatures (x):", lastFeatures);
      console.log("nextState:", nextState);
      console.log("theta:", theta);
    }
    shiftIdx++;
  };

  let state = extractState(
    { step: 0, auditDay: 0, weekDay: 0, clock: "00:00",
      ambTemperature: 20, rawMaterialQuality: 0.5,
      currPower: 0, totalRate: 0, setpointRate: 0,
      cumProduction: 0, cumEnergy: 0, cumCost: 0,
      productEnergy: 0, productCost: 0, numberAccidents: 0 },
    SIM_STEPS,
  );

  // Fixed probe state (mid-run, moderate wear) to evaluate Q(s,a) consistently across training.
  const probeMidWear = extractState(
    { step: SIM_STEPS / 2, auditDay: 0, weekDay: 2, clock: "12:00",
      ambTemperature: 20, rawMaterialQuality: 0.5,
      currPower: 0, totalRate: 0, setpointRate: 0,
      cumProduction: 0, cumEnergy: 0, cumCost: 0,
      productEnergy: 0, productCost: 0, numberAccidents: 0,
      wearByWorkarea: new Array(16).fill(WEAR_THRESHOLD * 0.7) },
    SIM_STEPS,
  );
  console.log(`ep, meanReward(prev10), accidents, |theta|, Q(probeMidWear,*), argmax, spread`);

  const rewardWindow: number[] = [];
  for (let ep = 0; ep < EPISODES; ep++) {
    const { lastShiftState, episodeReward, episodeAccidents } = await runEpisode(agent, SEED_BASE + ep, state);
    state = lastShiftState;
    agent.decayEpsilon();
    rewardWindow.push(episodeReward);
    if (rewardWindow.length > 10) rewardWindow.shift();

    if (ep % 10 === 0 || ep === EPISODES - 1) {
      const theta = (agent as unknown as { theta: number[] }).theta;
      const norm = Math.sqrt(theta.reduce((s, v) => s + v * v, 0));
      const hasNaN = theta.some(v => Number.isNaN(v));
      // Q(probeMidWear, a) per action — differentiation now comes from the
      // ACTION features/interaction terms within a single shared theta, not
      // from a different row per action, so recompute the joint vector per
      // action against the one theta.
      const qVals = ACTIONS.map(a => {
        const x = stateActionToVector(probeMidWear, a);
        let s = 0;
        for (let i = 0; i < Math.min(theta.length, x.length); i++) s += theta[i] * x[i];
        return s;
      });
      let argmax = -1, best = -Infinity;
      qVals.forEach((v, i) => { if (!Number.isNaN(v) && v > best) { best = v; argmax = i; } });
      const spread = Math.max(...qVals) - Math.min(...qVals);
      const meanR = rewardWindow.reduce((a, b) => a + b, 0) / rewardWindow.length;
      console.log(`${ep}, ${meanR.toFixed(1)}, ${episodeAccidents}, ${norm.toFixed(2)}, [${qVals.map(v => v.toFixed(2)).join(" ")}], argmax=${hasNaN ? "NaN-IN-THETA" : (argmax >= 0 ? ACTIONS[argmax].name : "ALL-NaN")}, spread=${spread.toFixed(2)}`);
    }
  }
}

main().catch((err) => {
  console.error("Probe failed:", err);
  process.exit(1);
});
