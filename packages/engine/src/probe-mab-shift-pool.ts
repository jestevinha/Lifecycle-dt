/**
 * Probe — per-SHIFT reward pool at W=8 (for the corrected shift-level MAB model).
 *
 * The prior calibration used an EPISODE-level pool (Σ over 60 shifts = 1 sample
 * per episode). That is UNUSABLE for the real production structure, where the
 * MABAgent selects an action and receives a reward once per SHIFT (~60 pulls per
 * episode; experiments.ts:356/:360), with epsilon decaying once per EPISODE (:451).
 *
 * This probe rolls out each of the 20 factored actions as a FIXED policy and logs
 * EACH shift's reward exactly as experiments.ts computes it:
 *     shiftReward = aggregateShiftReward(shiftStepRewards) − maintenancePenalty(preMaintWearFrac)
 * where computeStepReward already folds THROUGHPUT_WEIGHT (=8) into the throughput
 * term. Result: ~50 episodes × 60 shifts = ~3000 per-shift reward samples per action.
 *
 * FIDELITY NOTE: rewards are per-shift under a FIXED-policy wear trajectory. A real
 * MAB interleaves actions during exploration, so its wear state when a rarely-pulled
 * arm fires differs from that arm's fixed-policy trajectory. But (a) the winner is
 * exploited in long fixed-action stretches → accurate; (b) the marginal per-shift
 * mean/variance per arm is what the sample-average update needs. i.i.d. draws from
 * this pool reproduce that marginal — the correct object for MAB convergence dynamics.
 *
 * Run: SWEEP_EPISODES=50 npx tsx src/probe-mab-shift-pool.ts
 */

import fs from "node:fs";
import { runInteractiveSimulation, type StepCommand } from "./runner.js";
import { ACTIONS, STEPS_PER_SHIFT, shouldTriggerMaintenance } from "./actions.js";
import {
  WEAR_THRESHOLD, THROUGHPUT_WEIGHT,
  computeStepReward, aggregateShiftReward, maintenancePenalty,
  type StepRewardComponents,
} from "./reward.js";
import type { KpiStep } from "./types.js";

const W             = THROUGHPUT_WEIGHT;
const N_POOL        = Number(process.env.SWEEP_EPISODES ?? 50);
const BASE_SEED     = Number(process.env.BASE_SEED ?? 1234);
const SHIFTS_PER_EP = Number(process.env.SWEEP_SHIFTS ?? 60);
const SIM_STEPS     = SHIFTS_PER_EP * STEPS_PER_SHIFT;
const OUT_PATH      = process.env.SHIFT_POOL_OUT
  ?? "C:/Users/Joaom/AppData/Local/Temp/claude/c--Users-Joaom-Documents-Learn-Tese-dt-monorepo/13141a31-5cc3-48a0-b34a-5333c804b4ca/scratchpad/reward_pool_shift_w8.json";
const POOL_ACTIONS  = process.env.POOL_ACTIONS
  ? process.env.POOL_ACTIONS.split(",").map(Number)
  : ACTIONS.map((_, i) => i);

const SEEDS = Array.from({ length: N_POOL }, (_, i) => BASE_SEED + i);

/** First-eligible argmax of wear (mirrors experiments.ts). Returns cmd + pre-maint wear frac. */
function resolveMaint(actionId: number, prevWear: number[]): {
  cmd: number | StepCommand; maintFired: boolean; preWearFrac: number;
} {
  const rate = ACTIONS[actionId].setpointRate;
  const firstEligible = prevWear.findIndex(w => w < WEAR_THRESHOLD);
  const maxIdx = firstEligible < 0
    ? 0
    : prevWear.reduce((best, w, idx) => (w < WEAR_THRESHOLD && w > prevWear[best] ? idx : best), firstEligible);
  const maxWearFrac = firstEligible >= 0 ? prevWear[maxIdx] / WEAR_THRESHOLD : 0;
  if (firstEligible >= 0 && prevWear[maxIdx] > 0 && shouldTriggerMaintenance(actionId, maxWearFrac)) {
    return { cmd: { rate, maintainWorkarea: maxIdx }, maintFired: true, preWearFrac: maxWearFrac };
  }
  return { cmd: rate, maintFired: false, preWearFrac: 0 };
}

/** One fixed-policy episode → array of ~60 per-shift rewards (production formula). */
async function rolloutShiftRewards(actionId: number, seed: number): Promise<number[]> {
  const rate = ACTIONS[actionId].setpointRate;
  let prevAccidents = 0;
  let prevWear: number[] = new Array(16).fill(0);
  let subStep = 0;
  let shiftStepRewards: StepRewardComponents[] = [];
  const shiftRewards: number[] = [];

  let init = resolveMaint(actionId, prevWear);
  let maintFired = init.maintFired;
  let preWearFrac = init.preWearFrac;

  await runInteractiveSimulation(
    { steps: SIM_STEPS, seed },
    init.cmd,
    (kpi: KpiStep, stepIndex: number) => {
      subStep++;
      const accidentDelta = kpi.numberAccidents - prevAccidents;
      prevAccidents = kpi.numberAccidents;
      const r = computeStepReward(kpi, accidentDelta, prevWear);
      shiftStepRewards.push(r);
      prevWear = kpi.wearByWorkarea ? [...kpi.wearByWorkarea] : prevWear;

      if (subStep >= STEPS_PER_SHIFT || stepIndex === SIM_STEPS - 1) {
        // Exact production shift reward: aggregate − maintenance-timing penalty.
        let shiftReward = aggregateShiftReward(shiftStepRewards);
        if (maintFired) shiftReward -= maintenancePenalty(preWearFrac);
        shiftRewards.push(shiftReward);

        subStep = 0;
        shiftStepRewards = [];
        const next = resolveMaint(actionId, prevWear);
        maintFired = next.maintFired;
        preWearFrac = next.preWearFrac;
        return next.cmd;
      }
      return rate;
    },
  );
  return shiftRewards;
}

function stats(xs: number[]) {
  const n = xs.length;
  const mean = xs.reduce((s, v) => s + v, 0) / n;
  const variance = n > 1 ? xs.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  return { n, mean, std: Math.sqrt(variance), min: Math.min(...xs), max: Math.max(...xs) };
}

async function main() {
  console.log("═".repeat(84));
  console.log(`PER-SHIFT reward pool at W=${W}  (production shift-level structure)`);
  console.log(`Actions ${POOL_ACTIONS.length} × ${N_POOL} episodes × ${SHIFTS_PER_EP} shifts = ` +
              `${N_POOL * SHIFTS_PER_EP} shift-samples/action  (seeds ${SEEDS[0]}..${SEEDS[SEEDS.length - 1]})`);
  console.log("═".repeat(84));

  const summary: Record<string, unknown> = { W, N_POOL, SHIFTS_PER_EP, level: "shift", actions: {} };
  const t0 = Date.now();
  for (const a of POOL_ACTIONS) {
    const all: number[] = [];
    for (const seed of SEEDS) all.push(...await rolloutShiftRewards(a, seed));
    const s = stats(all);
    (summary.actions as Record<string, unknown>)[a] = {
      name: ACTIONS[a].name, rate: ACTIONS[a].setpointRate,
      mean: s.mean, std: s.std, min: s.min, max: s.max, n: s.n, rewards: all,
    };
    console.log(`${ACTIONS[a].name.padEnd(18)} (id ${String(a).padStart(2)})  ` +
      `n=${String(s.n).padStart(4)}  perShiftMean=${s.mean.toFixed(3).padStart(8)}  ` +
      `std=${s.std.toFixed(3).padStart(7)}  [${s.min.toFixed(1)}, ${s.max.toFixed(1)}]`);
  }
  console.log(`\nElapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  fs.writeFileSync(OUT_PATH, JSON.stringify(summary, null, 2));
  console.log(`Shift pool written → ${OUT_PATH}`);
}

main().catch(err => { console.error("Probe failed:", err); process.exit(1); });
