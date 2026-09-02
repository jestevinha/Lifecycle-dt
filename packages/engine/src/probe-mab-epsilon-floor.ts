/**
 * Probe — MAB epsilon-floor calibration (episode-level bandit framing).
 *
 * PURPOSE (does NOT modify reward.ts or any agent):
 *   1. Build an EMPIRICAL per-action episode-reward pool at W=THROUGHPUT_WEIGHT by
 *      rolling out each of the 20 factored actions as a FIXED policy for N_POOL
 *      episodes (distinct seeds). This is the same rollout math as
 *      probe-throughput-weight-sweep.ts, but it logs the PER-EPISODE reward
 *      (mean AND variance) instead of only the mean.
 *   2. Emit the pool to scratchpad JSON so the in-memory MAB F-sweep
 *      (probe-mab-fsweep.ts) can draw rewards without re-invoking Java.
 *
 * Episode-level bandit framing (matches the registered problem's arithmetic
 * "50 episodes / 20 actions ≈ 2-3 samples per action"): one arm = one action,
 * one pull = one full-episode rollout, reward = episode reward at W.
 *
 * Reward per episode (identical to reward.ts / the calibration sweep):
 *   episodeReward(W) = Σ_shift [ W·avg(setpointRate)
 *                                − avg(COST_WEIGHT·productCost)
 *                                − Σ ACCIDENT_PENALTY·accidentDelta
 *                                − Σ FAILURE_PENALTY·newFailures
 *                                − avg(WEAR_PENALTY_SCALE·maxWearFrac²)
 *                                − maintenancePenalty(preMaintWearFrac) ]
 *
 * Run: SWEEP_EPISODES=50 npx tsx src/probe-mab-epsilon-floor.ts
 *      POOL_ACTIONS=11,15 npx tsx src/probe-mab-epsilon-floor.ts   (variance subset)
 */

import fs from "node:fs";
import { runInteractiveSimulation, type StepCommand } from "./runner.js";
import { ACTIONS, STEPS_PER_SHIFT, shouldTriggerMaintenance } from "./actions.js";
import {
  WEAR_THRESHOLD,
  THROUGHPUT_WEIGHT,
  computeStepReward,
  maintenancePenalty,
} from "./reward.js";
import type { KpiStep } from "./types.js";

const W             = THROUGHPUT_WEIGHT;                       // 8 (finalized)
const N_POOL        = Number(process.env.SWEEP_EPISODES ?? 50);
const BASE_SEED     = Number(process.env.BASE_SEED ?? 1234);
const SHIFTS_PER_EP = Number(process.env.SWEEP_SHIFTS ?? 60);
const SIM_STEPS     = SHIFTS_PER_EP * STEPS_PER_SHIFT;
const OUT_PATH      = process.env.POOL_OUT
  ?? "C:/Users/Joaom/AppData/Local/Temp/claude/c--Users-Joaom-Documents-Learn-Tese-dt-monorepo/13141a31-5cc3-48a0-b34a-5333c804b4ca/scratchpad/reward_pool_w8.json";
// Which actions to roll out (default: all 20). e.g. POOL_ACTIONS=11,15
const POOL_ACTIONS  = process.env.POOL_ACTIONS
  ? process.env.POOL_ACTIONS.split(",").map(Number)
  : ACTIONS.map((_, i) => i);

const SEEDS = Array.from({ length: N_POOL }, (_, i) => BASE_SEED + i);

/** First-eligible argmax of wear (mirrors experiments.ts exactly). */
function resolveMaint(actionId: number, prevWear: number[]): { cmd: number | StepCommand; maintPen: number } {
  const rate = ACTIONS[actionId].setpointRate;
  const firstEligible = prevWear.findIndex(w => w < WEAR_THRESHOLD);
  const maxIdx = firstEligible < 0
    ? 0
    : prevWear.reduce((best, w, idx) => (w < WEAR_THRESHOLD && w > prevWear[best] ? idx : best), firstEligible);
  const maxWearFrac = firstEligible >= 0 ? prevWear[maxIdx] / WEAR_THRESHOLD : 0;
  if (firstEligible >= 0 && prevWear[maxIdx] > 0 && shouldTriggerMaintenance(actionId, maxWearFrac)) {
    return { cmd: { rate, maintainWorkarea: maxIdx }, maintPen: maintenancePenalty(maxWearFrac) };
  }
  return { cmd: rate, maintPen: 0 };
}

/** One fixed-policy episode → the scalar episode reward at weight W. */
async function rolloutEpisodeReward(actionId: number, seed: number): Promise<number> {
  const rate = ACTIONS[actionId].setpointRate;
  let prevAccidents = 0;
  let prevWear: number[] = new Array(16).fill(0);
  let subStep = 0;

  let shiftSumRate = 0, shiftSumCost = 0, shiftSumWear = 0, shiftSumAccPen = 0, shiftSumFailPen = 0, shiftN = 0;
  let episodeReward = 0;

  let init = resolveMaint(actionId, prevWear);
  let currentMaintPen = init.maintPen;

  function closeShift(): void {
    if (shiftN === 0) return;
    const meanRate = shiftSumRate / shiftN;
    const meanCost = shiftSumCost / shiftN;
    const meanWear = shiftSumWear / shiftN;
    // shiftReward = W·meanRate − meanCost − Σacc − Σfail − meanWear − maintPen
    episodeReward += W * meanRate - meanCost - shiftSumAccPen - shiftSumFailPen - meanWear - currentMaintPen;
    shiftSumRate = shiftSumCost = shiftSumWear = shiftSumAccPen = shiftSumFailPen = shiftN = 0;
  }

  await runInteractiveSimulation(
    { steps: SIM_STEPS, seed },
    init.cmd,
    (kpi: KpiStep, stepIndex: number) => {
      subStep++;
      const accidentDelta = kpi.numberAccidents - prevAccidents;
      prevAccidents = kpi.numberAccidents;
      const r = computeStepReward(kpi, accidentDelta, prevWear);

      shiftSumRate    += kpi.setpointRate ?? ACTIONS[actionId].setpointRate;  // bounded [0.2,0.8]
      shiftSumCost    += r.costPenalty;
      shiftSumWear    += r.wearPenalty;
      shiftSumAccPen  += r.accidentPenalty;
      shiftSumFailPen += r.failurePenalty;
      shiftN++;

      prevWear = kpi.wearByWorkarea ? [...kpi.wearByWorkarea] : prevWear;

      if (subStep >= STEPS_PER_SHIFT || stepIndex === SIM_STEPS - 1) {
        closeShift();
        subStep = 0;
        const next = resolveMaint(actionId, prevWear);
        currentMaintPen = next.maintPen;
        return next.cmd;
      }
      return rate;
    },
  );
  closeShift();
  return episodeReward;
}

function stats(xs: number[]): { mean: number; std: number; sem: number; min: number; max: number } {
  const n = xs.length;
  const mean = xs.reduce((s, v) => s + v, 0) / n;
  // sample std (n-1)
  const variance = n > 1 ? xs.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  const std = Math.sqrt(variance);
  return { mean, std, sem: std / Math.sqrt(n), min: Math.min(...xs), max: Math.max(...xs) };
}

async function main() {
  console.log("═".repeat(80));
  console.log(`MAB EPSILON-FLOOR PROBE — per-action episode-reward pool at W=${W}`);
  console.log(`Actions   : ${POOL_ACTIONS.length} (${POOL_ACTIONS.map(i => ACTIONS[i].name).join(", ")})`);
  console.log(`Pool size : ${N_POOL} episodes/action × ${SHIFTS_PER_EP} shifts  (seeds ${SEEDS[0]}..${SEEDS[SEEDS.length - 1]})`);
  console.log("═".repeat(80));

  const pool: Record<number, number[]> = {};
  const t0 = Date.now();
  for (const a of POOL_ACTIONS) {
    const rewards: number[] = [];
    for (const seed of SEEDS) {
      rewards.push(await rolloutEpisodeReward(a, seed));
    }
    pool[a] = rewards;
    const s = stats(rewards);
    console.log(
      `${ACTIONS[a].name.padEnd(18)} (id ${String(a).padStart(2)})  ` +
      `mean=${s.mean.toFixed(3).padStart(9)}  std=${s.std.toFixed(3).padStart(8)}  ` +
      `sem=${s.sem.toFixed(3).padStart(7)}  [min=${s.min.toFixed(1)}, max=${s.max.toFixed(1)}]`
    );
  }
  console.log(`\nElapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Emit pool + summary stats
  const summary: Record<string, unknown> = { W, N_POOL, BASE_SEED, SHIFTS_PER_EP, actions: {} };
  for (const a of POOL_ACTIONS) {
    const s = stats(pool[a]);
    (summary.actions as Record<string, unknown>)[a] = {
      name: ACTIONS[a].name, rate: ACTIONS[a].setpointRate,
      mean: s.mean, std: s.std, sem: s.sem, min: s.min, max: s.max,
      rewards: pool[a],
    };
  }
  fs.writeFileSync(OUT_PATH, JSON.stringify(summary, null, 2));
  console.log(`Pool written → ${OUT_PATH}`);
}

main().catch(err => { console.error("Probe failed:", err); process.exit(1); });
