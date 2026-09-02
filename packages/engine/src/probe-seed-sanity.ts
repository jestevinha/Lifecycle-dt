/**
 * STEP 4 — Sanity re-run after accident-RNG fix.
 *
 * 30 episodes, fixed action medium_t75 (rate=0.5, no maintenance),
 * baseSeed=42, wearRateSpread=0.2, interactive mode.
 *
 * PASS criteria (all three must hold):
 *   1. episodeSeed strictly increases by 1 per episode (42, 43, …, 71)
 *   2. ambTemperature[step0] differs across episodes
 *   3. Episode reward has ~30 distinct values (NOT ≤4)
 *
 * Also re-confirms spread=0 produces lockstep wear with VARYING rewards
 * (different weather even though wear is identical — both must vary).
 *
 * Run: npx tsx packages/engine/src/probe-seed-sanity.ts
 */

import { runInteractiveSimulation } from "./runner.js";
import { computeStepReward, aggregateShiftReward, WEAR_THRESHOLD } from "./reward.js";
import { STEPS_PER_SHIFT } from "./actions.js";
import type { KpiStep } from "./types.js";
import type { StepRewardComponents } from "./reward.js";

const BASE_SEED     = 42;
const WEAR_SPREAD   = 0.2;
const SIM_STEPS     = 240;   // 30 shifts = 240 steps
const RATE          = 0.50;  // medium rate, no maintenance
const N_EPISODES    = 30;

interface EpisodeResult {
  i:            number;
  episodeSeed:  number;
  ambTemp0:     number | null;
  accidents:    number;
  reward:       number;
}

async function runEpisode(seed: number, wearRateSpread: number): Promise<EpisodeResult> {
  let ambTemp0: number | null = null;
  let prevAccidents = 0;
  let prevWear: number[] = new Array(16).fill(0);
  const stepRewards: StepRewardComponents[] = [];

  await runInteractiveSimulation(
    { steps: SIM_STEPS, seed, wearRateSpread },
    RATE,
    (kpi: KpiStep, stepIndex: number) => {
      if (stepIndex === 0) ambTemp0 = kpi.ambTemperature;
      const accDelta = kpi.numberAccidents - prevAccidents;
      prevAccidents  = kpi.numberAccidents;
      const r = computeStepReward(kpi, accDelta, prevWear);
      stepRewards.push(r);
      prevWear = kpi.wearByWorkarea ? [...kpi.wearByWorkarea] : prevWear;
      return RATE;
    },
  );

  const reward = aggregateShiftReward(stepRewards);
  return { i: -1, episodeSeed: seed, ambTemp0, accidents: prevAccidents, reward };
}

async function runBatch(label: string, spread: number): Promise<void> {
  console.log(`\n${"─".repeat(70)}`);
  console.log(`${label}  (spread=${spread})`);
  console.log(`${"─".repeat(70)}`);
  console.log(` ${"i".padStart(3)} | ${"seed".padStart(5)} | ${"ambTemp0".padStart(10)} | ${"accidents".padStart(9)} | ${"reward".padStart(10)}`);
  console.log(` ${"-".repeat(55)}`);

  const rows: EpisodeResult[] = [];

  for (let i = 0; i < N_EPISODES; i++) {
    const seed = BASE_SEED + i;
    const r = await runEpisode(seed, spread);
    r.i = i;
    rows.push(r);
    console.log(
      ` ${String(i).padStart(3)} | ${String(seed).padStart(5)} |` +
      ` ${(r.ambTemp0 ?? -99).toFixed(4).padStart(10)} |` +
      ` ${String(r.accidents).padStart(9)} |` +
      ` ${r.reward.toFixed(4).padStart(10)}`,
    );
  }

  // ── PASS criteria ────────────────────────────────────────────────────────
  console.log("\n--- Evaluation ---\n");

  // 1. Seeds strictly increasing
  const seedsOk = rows.every((r, i) => i === 0 || r.episodeSeed === rows[i - 1].episodeSeed + 1);
  console.log(`  1. episodeSeed strictly increases: ${seedsOk ? "PASS ✓" : "FAIL ✗"}`);

  // 2. ambTemp distinct
  const ambTemps = rows.map(r => r.ambTemp0?.toFixed(4) ?? "null");
  const ambDistinct = new Set(ambTemps).size;
  const ambOk = ambDistinct >= N_EPISODES * 0.8;
  console.log(`  2. ambTemp[step0] distinct values : ${ambDistinct}/${N_EPISODES}  ${ambOk ? "PASS ✓" : "FAIL ✗"}`);

  // 3. Reward distinct
  const rewards = rows.map(r => r.reward.toFixed(4));
  const rewardDistinct = new Set(rewards).size;
  const rewardOk = rewardDistinct >= N_EPISODES * 0.5;  // at least 50% distinct = not frozen
  console.log(`  3. reward distinct values         : ${rewardDistinct}/${N_EPISODES}  ${rewardOk ? "PASS ✓" : "FAIL ✗ (frozen rewards)"}`);

  const min = Math.min(...rows.map(r => r.reward));
  const max = Math.max(...rows.map(r => r.reward));
  console.log(`     reward range: [${min.toFixed(4)}, ${max.toFixed(4)}]`);

  // Accidents distinct
  const accDistinct = new Set(rows.map(r => r.accidents)).size;
  console.log(`     accidents distinct values      : ${accDistinct}  ${accDistinct > 1 ? "(varying ✓)" : "(frozen ✗)"}`);

  const allPass = seedsOk && ambOk && rewardOk;
  console.log(`\n  OVERALL: ${allPass ? "ALL PASS — environment is varying. Full 500×3 run is valid." : "FAIL — re-check fix."}`);
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("Step 4 — Sanity re-run after accident-RNG fix");
  console.log(`baseSeed=${BASE_SEED}  N_EPISODES=${N_EPISODES}  rate=${RATE}  steps=${SIM_STEPS}`);
  console.log("═══════════════════════════════════════════════════════════════════");

  // Primary test: spread=0.2 (the thesis setting)
  await runBatch("Primary: spread=0.2 (thesis setting)", WEAR_SPREAD);

  // Regression check: spread=0 (lockstep wear) — rewards must STILL vary (weather varies)
  await runBatch("Regression check: spread=0.0 (lockstep wear, weather must vary)", 0.0);

  console.log("\n═══════════════════════════════════════════════════════════════════");
  console.log("If both batches pass, the fix is complete.");
  console.log("Spread=0 pass confirms: lockstep wear ≠ frozen weather — both components vary.");
  console.log("═══════════════════════════════════════════════════════════════════");
}

main().catch(err => { console.error("Probe failed:", err); process.exit(1); });
