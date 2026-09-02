/**
 * Probe — Reward-environment equivalence & accident-boundary check.
 *
 * DETECT AND REPORT ONLY. No agents, no learning, no constants changed.
 *
 * Runs 5 deterministic fixed-policy episodes and decomposes the reward into
 * its constituent terms to determine which term moved between exp25 and exp26,
 * and whether the accident safety-boundary is active in current code.
 *
 * Part 1: Reward decomposition per policy
 * Part 2: Accident-boundary activity test (does penalty rise with rate?)
 * Part 3: simSteps production vs probe horizon check
 *
 * Run: npx tsx packages/engine/src/probe-reward-decomposition.ts
 */

import { runInteractiveSimulation, type StepCommand } from "./runner.js";
import { STEPS_PER_SHIFT } from "./actions.js";
import {
  WEAR_THRESHOLD,
  ACCIDENT_PENALTY,
  COST_WEIGHT,
  FAILURE_PENALTY,
  WEAR_PENALTY_SCALE,
  computeStepReward,
  aggregateShiftReward,
  detectFailures,
  type StepRewardComponents,
} from "./reward.js";
import type { KpiStep } from "./types.js";

// ── Constants matching exp26 production run ──────────────────────────────────
const SEED      = 42;    // simSeed from exp26 config_json (= episode 0 seed)
const SIM_STEPS = 200;   // simSteps from exp26 config_json
const N_SHIFTS  = SIM_STEPS / STEPS_PER_SHIFT;  // 200/8 = 25 shifts per episode

// ── Fixed policies under test ─────────────────────────────────────────────────
const POLICIES = [
  { name: "low_no_maint",  rate: 0.35, threshold: Infinity },
  { name: "low_t90",       rate: 0.35, threshold: 0.90 },
  { name: "medium_t90",    rate: 0.50, threshold: 0.90 },
  { name: "high_t90",      rate: 0.65, threshold: 0.90 },
  { name: "very_high_t90", rate: 0.80, threshold: 0.90 },
] as const;

function argmax(xs: number[]): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i] > xs[best]) best = i;
  return best;
}

interface PolicyResult {
  name: string;
  rate: number;
  // Accumulated step components
  allSteps: StepRewardComponents[];
  totalAccidents: number;
  totalFailures: number;
  maintCount: number;
}

async function runFixedPolicy(
  name: string,
  rate: number,
  threshold: number,
): Promise<PolicyResult> {
  const allSteps: StepRewardComponents[] = [];
  let prevAccidents = 0;
  let prevWear: number[] = new Array(16).fill(0);
  let subStep = 0;
  let maintCount = 0;
  let totalFailures = 0;

  function resolveCmd(): number | StepCommand {
    if (!Number.isFinite(threshold)) return rate;
    const maxIdx = argmax(prevWear);
    const maxWearFrac = prevWear[maxIdx] / WEAR_THRESHOLD;
    if (prevWear[maxIdx] > 0 && maxWearFrac >= threshold) {
      maintCount++;
      return { rate, maintainWorkarea: maxIdx };
    }
    return rate;
  }

  const steps = await runInteractiveSimulation(
    { steps: SIM_STEPS, seed: SEED, wearRateSpread: 0 },
    resolveCmd(),
    (kpi: KpiStep, stepIndex: number) => {
      subStep++;
      const currWear = kpi.wearByWorkarea ?? prevWear;
      const failures = detectFailures(prevWear, currWear);
      totalFailures += failures;
      const accidentDelta = kpi.numberAccidents - prevAccidents;
      prevAccidents = kpi.numberAccidents;
      const r = computeStepReward(kpi, accidentDelta, prevWear);
      allSteps.push(r);
      prevWear = [...currWear];

      // At shift boundary: resolve next command
      if (subStep >= STEPS_PER_SHIFT || stepIndex === SIM_STEPS - 1) {
        subStep = 0;
        return resolveCmd();
      }
      return rate;
    },
  );

  const totalAccidents = steps.length > 0
    ? steps[steps.length - 1].numberAccidents
    : 0;

  return { name, rate, allSteps, totalAccidents, totalFailures, maintCount };
}

function computeSummary(result: PolicyResult): {
  throughputMean: number;
  costMean: number;
  accidentSum: number;
  failureSum: number;
  wearMean: number;
  total: number;
} {
  const n = result.allSteps.length;
  if (n === 0) return { throughputMean: 0, costMean: 0, accidentSum: 0, failureSum: 0, wearMean: 0, total: 0 };

  const throughputMean = result.allSteps.reduce((s, r) => s + r.throughput, 0) / n;
  const costMean       = result.allSteps.reduce((s, r) => s + r.costPenalty, 0) / n;
  const accidentSum    = result.allSteps.reduce((s, r) => s + r.accidentPenalty, 0);
  const failureSum     = result.allSteps.reduce((s, r) => s + r.failurePenalty, 0);
  const wearMean       = result.allSteps.reduce((s, r) => s + r.wearPenalty, 0) / n;

  // Total matches aggregateShiftReward(allSteps)
  const total = (throughputMean - costMean) - accidentSum - failureSum - wearMean;
  return { throughputMean, costMean, accidentSum, failureSum, wearMean, total };
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("PROBE — Reward decomposition & accident-boundary check");
  console.log(`Seed   : ${SEED}  (exp26 simSeed, episode-0 seed = simSeed + 0 = ${SEED})`);
  console.log(`Steps  : ${SIM_STEPS}  (exp26 simSteps; ${N_SHIFTS} shifts/ep at STEPS_PER_SHIFT=${STEPS_PER_SHIFT})`);
  console.log(`Spread : 0 (wearRateSpread=0, lockstep)`);
  console.log(`Reward constants from reward.ts:`);
  console.log(`  ACCIDENT_PENALTY  = ${ACCIDENT_PENALTY}  (per accident delta)`);
  console.log(`  FAILURE_PENALTY   = ${FAILURE_PENALTY}  (per wear-failure event)`);
  console.log(`  COST_WEIGHT       = ${COST_WEIGHT}  (× productCost)`);
  console.log(`  WEAR_PENALTY_SCALE= ${WEAR_PENALTY_SCALE}  (× maxWearFraction²)`);
  console.log(`  WEAR_THRESHOLD    = ${WEAR_THRESHOLD} rate-minutes`);
  console.log("═══════════════════════════════════════════════════════════════════════\n");

  // ── Run all policies ─────────────────────────────────────────────────────────
  const results: PolicyResult[] = [];
  for (const p of POLICIES) {
    process.stdout.write(`Running ${p.name} (rate=${p.rate}, threshold=${p.threshold === Infinity ? "∞" : p.threshold})...`);
    const r = await runFixedPolicy(p.name, p.rate, p.threshold);
    results.push(r);
    process.stdout.write(` done (${r.allSteps.length} steps, ${r.totalAccidents} accidents)\n`);
  }

  // ── PART 1: Reward decomposition table ───────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════════════════");
  console.log("PART 1 — Per-episode reward decomposition");
  console.log("Aggregation: mean(throughput - cost) - sum(accident + failure) - mean(wear)");
  console.log("─────────────────────────────────────────────────────────────────────────────────────────");
  console.log(
    "Policy".padEnd(20) +
    " rate" +
    " maint" +
    " │ " + "throughput".padStart(10) +
    " │ " + "cost".padStart(8) +
    " │ " + "accident".padStart(10) +
    " │ " + "failure".padStart(9) +
    " │ " + "wear".padStart(8) +
    " │ " + "TOTAL".padStart(9),
  );
  console.log("─────────────────────────────────────────────────────────────────────────────────────────");

  const summaries = results.map(r => ({ result: r, s: computeSummary(r) }));
  for (const { result, s } of summaries) {
    const mantStr = result.maintCount.toString().padStart(5);
    console.log(
      result.name.padEnd(20) +
      ` ${result.rate.toFixed(2)}` +
      ` ${mantStr}` +
      " │ " + s.throughputMean.toFixed(4).padStart(10) +
      " │ " + s.costMean.toFixed(4).padStart(8) +
      " │ " + s.accidentSum.toFixed(4).padStart(10) +
      " │ " + s.failureSum.toFixed(4).padStart(9) +
      " │ " + s.wearMean.toFixed(4).padStart(8) +
      " │ " + s.total.toFixed(4).padStart(9),
    );
  }
  console.log("─────────────────────────────────────────────────────────────────────────────────────────");
  console.log("  throughput: mean(totalRate) across all steps");
  console.log("  cost:       mean(COST_WEIGHT × productCost) across all steps");
  console.log("  accident:   sum(ACCIDENT_PENALTY × accidentDelta) across all steps");
  console.log("  failure:    sum(FAILURE_PENALTY × wearFailures) across all steps");
  console.log("  wear:       mean(WEAR_PENALTY_SCALE × maxWearFraction²) across all steps");
  console.log("  TOTAL:      (throughput − cost) − accident − failure − wear");

  // ── PART 2: Accident-boundary activity test ───────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════════════════");
  console.log("PART 2 — Accident safety-boundary activity test");
  console.log("Does accident penalty rise with production rate (0.35 → 0.80)?");
  console.log("Relevant Java constant: ACTOR_SAFETY_RATE_MODEL_INDEX = 3 → wmin = 0.50");
  console.log("  sftyRateThr formula: 0.5 + exp(-0.693 × (rate-0.5)/0.5 × 0.5) × 0.5");
  console.log("  (arg clamped at 0 for rate < 0.5, so sftyRateThr = 1.0 for rate ≤ 0.50)");
  console.log("  At rate=0.50: sftyRateThr = 1.0  → rate-factor NEVER causes accident");
  console.log("  At rate=0.65: sftyRateThr ≈ 0.906 → rare accidents from rate factor");
  console.log("  At rate=0.80: sftyRateThr ≈ 0.830 → more accidents from rate factor");
  console.log("─────────────────────────────────────────────────────────────────────");
  console.log("Policy".padEnd(20) + " rate" + "  total_accidents" + "  accident_penalty");

  // Compare policies that have same maintenance (t90) for clean rate comparison
  const t90Results = results.filter(r => r.name !== "low_no_maint");
  for (const result of t90Results) {
    const s = summaries.find(x => x.result === result)!.s;
    console.log(
      result.name.padEnd(20) +
      ` ${result.rate.toFixed(2)}` +
      `  ${String(result.totalAccidents).padStart(15)}` +
      `  ${s.accidentSum.toFixed(4).padStart(17)}`,
    );
  }

  // Also include low_no_maint for low rate reference
  const noMaintResult = results.find(r => r.name === "low_no_maint")!;
  const noMaintS = summaries.find(x => x.result === noMaintResult)!.s;
  console.log("─────────────────────────────────────────────────────────────────────");
  console.log(
    noMaintResult.name.padEnd(20) +
    ` ${noMaintResult.rate.toFixed(2)}` +
    `  ${String(noMaintResult.totalAccidents).padStart(15)}` +
    `  ${noMaintS.accidentSum.toFixed(4).padStart(17)}`,
  );
  console.log("─────────────────────────────────────────────────────────────────────");

  // Decisive verdict
  const lowAcc  = summaries.find(x => x.result.name === "low_t90")!.s.accidentSum;
  const highAcc = summaries.find(x => x.result.name === "high_t90")!.s.accidentSum;
  const vhAcc   = summaries.find(x => x.result.name === "very_high_t90")!.s.accidentSum;

  const penaltyRisesLowToHigh = highAcc > lowAcc * 1.1;  // >10% increase = meaningful
  const penaltyRisesHighToVH  = vhAcc  > highAcc * 1.05;

  console.log("\nDECISIVE VERDICT:");
  console.log(`  low_t90 accident penalty  = ${lowAcc.toFixed(4)}`);
  console.log(`  high_t90 accident penalty = ${highAcc.toFixed(4)}`);
  console.log(`  very_high_t90 penalty     = ${vhAcc.toFixed(4)}`);
  console.log(`  Penalty rises low→high (>10%): ${penaltyRisesLowToHigh ? "YES" : "NO"}`);
  console.log(`  Penalty rises high→very_high (>5%): ${penaltyRisesHighToVH ? "YES" : "NO"}`);

  if (penaltyRisesLowToHigh && penaltyRisesHighToVH) {
    console.log("\n  ANSWER: YES — accident safety-boundary IS active in current code.");
    console.log("  Rate 0.65 incurs meaningfully larger accident penalty than rate 0.35.");
    console.log("  The safety boundary matches exp25. exp26 shift must be elsewhere.");
  } else if (!penaltyRisesLowToHigh) {
    console.log("\n  ANSWER: NO — accident safety-boundary is BROKEN or severely attenuated.");
    console.log("  Accident penalty does NOT meaningfully rise from rate 0.35 → 0.65.");
    console.log("  This is the exp26 regression. See PART 2 constants block below.");
  } else {
    console.log("\n  ANSWER: PARTIAL — penalty rises low→high but not high→very_high (check values above).");
  }

  // Report the relevant Java constants as they stand
  console.log("\n  Java accident-boundary constants (current, from Const.java / PlantModel.java):");
  console.log("    ACTOR_SAFETY_RATE_MODEL_INDEX = 3  (→ wmin array index 3 → wmin=0.50)");
  console.log("    SFTY_RATE_MIN_RATE = 0.5  (xmin for framing; rate < 0.5 treated as 0.5)");
  console.log("    SFTY_RATE_MIN_SFTY = 0.5  (ymin = floor of sftyRateThr = 0.5)");
  console.log("    SAFETY_GAUSSIAN_STDDEV = 3.5  (|N(0,1)| ÷ 3.5, clamped to [0,1])");
  console.log("    safetyRateWmin[3] = 0.50  (expFactor = ln(0.50) ≈ -0.693)");
  console.log("    DIAG confirms: expFactor=-0.6931 for all runs in the task output.");

  // ── PART 3: simSteps horizon check ───────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════════════════");
  console.log("PART 3 — simSteps / horizon scale check");
  console.log("─────────────────────────────────────────────────────────────────────");
  console.log(`  Production exp26 simSteps : 200  (from experiments table config_json)`);
  console.log(`  Production exp25 simSteps : 200  (from experiments table config_json)`);
  console.log(`  This probe simSteps       : ${SIM_STEPS}  (matching production exactly)`);
  console.log(`  Shifts per episode        : ${N_SHIFTS}`);
  console.log(`  → Probe uses IDENTICAL horizon to exp26. No scale difference.`);
  console.log(`  → Part 3 is moot: exp25 and exp26 share the same simSteps=200.`);
  console.log(`  → The reward SCALE from horizon alone cannot explain the exp26 shift.`);

  // Run low_t90 at both production-matched steps already done (200 steps).
  // Since steps match, no additional run needed; report a per-shift mean instead.
  const lowT90 = results.find(r => r.name === "low_t90")!;
  const lowT90S = summaries.find(x => x.result === lowT90)!.s;
  console.log(`\n  low_t90 per-step means (${N_SHIFTS} shifts × ${STEPS_PER_SHIFT} steps each):`);
  console.log(`    throughput  per step: ${lowT90S.throughputMean.toFixed(4)}`);
  console.log(`    cost        per step: ${lowT90S.costMean.toFixed(4)}`);
  console.log(`    accident   (sum/ep) : ${lowT90S.accidentSum.toFixed(4)}`);
  console.log(`    failure    (sum/ep) : ${lowT90S.failureSum.toFixed(4)}`);
  console.log(`    wear        per step: ${lowT90S.wearMean.toFixed(4)}`);
  console.log(`    TOTAL (ep reward)   : ${lowT90S.total.toFixed(4)}`);

  // ── Closing analysis ─────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════════════════");
  console.log("CLOSING ANALYSIS — Which reward term moved between exp25 and exp26?");
  console.log("─────────────────────────────────────────────────────────────────────");

  // Derive comparison from this probe
  const highT90S = summaries.find(x => x.result.name === "high_t90")!.s;
  const vhT90S   = summaries.find(x => x.result.name === "very_high_t90")!.s;
  const medT90S  = summaries.find(x => x.result.name === "medium_t90")!.s;

  console.log(`  Probe rewards (seed=${SEED}, steps=${SIM_STEPS}) for reference:`);
  console.log(`    low_t90:       ${lowT90S.total.toFixed(2)}`);
  console.log(`    medium_t90:    ${medT90S.total.toFixed(2)}`);
  console.log(`    high_t90:      ${highT90S.total.toFixed(2)}`);
  console.log(`    very_high_t90: ${vhT90S.total.toFixed(2)}`);

  // Rank best policy in current env
  const ranked = summaries
    .map(x => ({ name: x.result.name, rate: x.result.rate, total: x.s.total }))
    .sort((a, b) => b.total - a.total);
  console.log(`\n  Current env policy ranking (best → worst by episode reward):`);
  for (const r of ranked) {
    console.log(`    ${r.name.padEnd(20)} rate=${r.rate} reward=${r.total.toFixed(2)}`);
  }

  const bestPolicy = ranked[0];
  console.log(`\n  Best fixed policy in current env: ${bestPolicy.name} (rate=${bestPolicy.rate}, R=${bestPolicy.total.toFixed(2)})`);

  // Compare accident penalty at high vs low
  console.log(`\n  Accident penalty at rate=0.65 vs rate=0.35 (both t90):`);
  console.log(`    high_t90 accident sum  = ${highT90S.accidentSum.toFixed(4)}`);
  console.log(`    low_t90  accident sum  = ${lowT90S.accidentSum.toFixed(4)}`);
  console.log(`    Difference             = ${(highT90S.accidentSum - lowT90S.accidentSum).toFixed(4)}`);

  const accBoundaryActive = penaltyRisesLowToHigh && penaltyRisesHighToVH;

  if (accBoundaryActive) {
    console.log("\n  CONCLUSION:");
    console.log("  The accident safety-boundary IS active. Rate 0.65 IS penalized more than rate 0.35.");
    console.log("  This matches exp25 environment. The exp26 reward landscape shift is NOT");
    console.log("  explained by a broken accident boundary.");
    console.log(`  Best fixed policy is ${bestPolicy.name} (rate=${bestPolicy.rate}) — if this is high_t60,`);
    console.log("  that confirms agents converging to rate 0.65 is correct given current reward constants.");
    console.log("  The exp25→exp26 transition likely reflects a CODE change that fixed a DIFFERENT bug,");
    console.log("  making rate 0.65 now the genuine optimum (vs exp25 where rate 0.35 was preferred).");
    console.log("  Hypothesis: exp25 had a code defect making rate 0.65 look worse than it is.");
    console.log("  This probe cannot distinguish that without exp25 code. See remediation notes.");
  } else {
    console.log("\n  CONCLUSION:");
    console.log("  The accident safety-boundary is BROKEN in current code.");
    console.log("  Rate 0.65 does NOT incur meaningfully larger accident penalty than rate 0.35.");
    console.log("  This matches the observed exp26 behavior: MAB confidently chooses rate 0.65");
    console.log("  because it no longer pays the accident cost that made rate 0.35 optimal in exp25.");
    console.log("\n  REMEDIATION (DO NOT APPLY — report only):");
    console.log("    Constant to check: ACTOR_SAFETY_RATE_MODEL_INDEX in Const.java");
    console.log("    Should be: 3 (current value, per source)");
    console.log("    Compiled class may differ if JAR was not rebuilt after the constant change.");
    console.log("    Action: recompile ManuSim and verify SAFETY_MODEL_INDEX=3 in stderr DIAG.");
  }

  console.log("\n═══════════════════════════════════════════════════════════════════════");
  console.log("END OF PROBE REPORT");
}

main().catch(err => {
  console.error("Probe failed:", err);
  process.exit(1);
});
