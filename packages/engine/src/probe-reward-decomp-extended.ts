/**
 * Extended probe — adds t60 and t75 policies (the ones exp26 MAB actually chose)
 * to complete the Part 1 reward decomposition table.
 * Same seed/steps/spread as the main probe.
 * Run: npx tsx packages/engine/src/probe-reward-decomp-extended.ts
 */

import { runInteractiveSimulation, type StepCommand } from "./runner.js";
import { STEPS_PER_SHIFT } from "./actions.js";
import {
  WEAR_THRESHOLD,
  ACCIDENT_PENALTY,
  COST_WEIGHT,
  FAILURE_PENALTY,
  WEAR_PENALTY_SCALE,
  WASTED_MAINT_PENALTY,
  MAINT_IDEAL_WEAR,
  computeStepReward,
  aggregateShiftReward,
  detectFailures,
  maintenancePenalty,
  type StepRewardComponents,
} from "./reward.js";
import type { KpiStep } from "./types.js";

const SEED      = 42;
const SIM_STEPS = 200;

const POLICIES = [
  { name: "low_no_maint",   rate: 0.35, threshold: Infinity },
  { name: "medium_no_maint",rate: 0.50, threshold: Infinity },
  { name: "medium_t90",     rate: 0.50, threshold: 0.90 },
  { name: "medium_t75",     rate: 0.50, threshold: 0.75 },
  { name: "medium_t60",     rate: 0.50, threshold: 0.60 },
  { name: "high_no_maint",  rate: 0.65, threshold: Infinity },
  { name: "high_t90",       rate: 0.65, threshold: 0.90 },
  { name: "high_t75",       rate: 0.65, threshold: 0.75 },
  { name: "high_t60",       rate: 0.65, threshold: 0.60 },
] as const;

function argmax(xs: number[]): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i] > xs[best]) best = i;
  return best;
}

interface PolicyResult {
  name: string;
  rate: number;
  threshold: number;
  allSteps: StepRewardComponents[];
  totalAccidents: number;
  maintCount: number;
  totalMaintPenalty: number;
}

async function runFixedPolicy(name: string, rate: number, threshold: number): Promise<PolicyResult> {
  const allSteps: StepRewardComponents[] = [];
  let prevAccidents = 0;
  let prevWear: number[] = new Array(16).fill(0);
  let subStep = 0;
  let maintCount = 0;
  let totalMaintPenalty = 0;

  function resolveCmd(): number | StepCommand {
    if (!Number.isFinite(threshold)) return rate;
    const maxIdx = argmax(prevWear);
    const maxWearFrac = prevWear[maxIdx] / WEAR_THRESHOLD;
    if (prevWear[maxIdx] > 0 && maxWearFrac >= threshold) {
      maintCount++;
      const penalty = maintenancePenalty(maxWearFrac);
      totalMaintPenalty += penalty;
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
      const accidentDelta = kpi.numberAccidents - prevAccidents;
      prevAccidents = kpi.numberAccidents;
      const r = computeStepReward(kpi, accidentDelta, prevWear);
      allSteps.push(r);
      prevWear = [...currWear];

      if (subStep >= STEPS_PER_SHIFT || stepIndex === SIM_STEPS - 1) {
        subStep = 0;
        return resolveCmd();
      }
      return rate;
    },
  );

  const totalAccidents = steps.length > 0 ? steps[steps.length - 1].numberAccidents : 0;
  return { name, rate, threshold, allSteps, totalAccidents, maintCount, totalMaintPenalty };
}

function computeSummary(result: PolicyResult) {
  const n = result.allSteps.length;
  if (n === 0) return { throughputMean: 0, costMean: 0, accidentSum: 0, failureSum: 0, wearMean: 0, total: 0, totalWithMaint: 0 };
  const throughputMean = result.allSteps.reduce((s, r) => s + r.throughput, 0) / n;
  const costMean       = result.allSteps.reduce((s, r) => s + r.costPenalty, 0) / n;
  const accidentSum    = result.allSteps.reduce((s, r) => s + r.accidentPenalty, 0);
  const failureSum     = result.allSteps.reduce((s, r) => s + r.failurePenalty, 0);
  const wearMean       = result.allSteps.reduce((s, r) => s + r.wearPenalty, 0) / n;
  const total          = (throughputMean - costMean) - accidentSum - failureSum - wearMean;
  // Add maintenance penalty (as agent sees it — subtracted from shift reward in production)
  const totalWithMaint = total - result.totalMaintPenalty;
  return { throughputMean, costMean, accidentSum, failureSum, wearMean, total, totalWithMaint };
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("EXTENDED PROBE — Medium/High rate t60/t75 decomposition");
  console.log(`seed=${SEED}, steps=${SIM_STEPS}, wearRateSpread=0 (lockstep)`);
  console.log(`MAINT_IDEAL_WEAR=${MAINT_IDEAL_WEAR}, WASTED_MAINT_PENALTY=${WASTED_MAINT_PENALTY}`);
  console.log("═══════════════════════════════════════════════════════════════════════\n");

  const results: PolicyResult[] = [];
  for (const p of POLICIES) {
    process.stdout.write(`${p.name}...`);
    const r = await runFixedPolicy(p.name, p.rate, p.threshold);
    results.push(r);
    process.stdout.write(` acc=${r.totalAccidents} maint=${r.maintCount}\n`);
  }

  const summaries = results.map(r => ({ result: r, s: computeSummary(r) }));

  console.log("\n─────────────────────────────────────────────────────────────────────────────────────────────────────");
  console.log(
    "Policy".padEnd(20) + " rate" +
    " maint│" + " throughput│" + "     cost│" + "  accident│" + "   failure│" + "     wear│" +
    " maint_pen│" + "  TOTAL(no-maint-pen)│" + " TOTAL(w-maint-pen)",
  );
  console.log("─────────────────────────────────────────────────────────────────────────────────────────────────────");

  for (const { result, s } of summaries) {
    const thrStr = Number.isFinite(result.threshold) ? result.threshold.toFixed(2) : "∞";
    console.log(
      result.name.padEnd(20) + ` ${result.rate.toFixed(2)}` +
      `  ${String(result.maintCount).padStart(4)}│` +
      `${s.throughputMean.toFixed(3).padStart(10)}│` +
      `${s.costMean.toFixed(3).padStart(9)}│` +
      `${s.accidentSum.toFixed(2).padStart(10)}│` +
      `${s.failureSum.toFixed(2).padStart(10)}│` +
      `${s.wearMean.toFixed(3).padStart(9)}│` +
      `${result.totalMaintPenalty.toFixed(2).padStart(10)}│` +
      `${s.total.toFixed(2).padStart(20)}│` +
      `${s.totalWithMaint.toFixed(2).padStart(19)}`,
    );
  }
  console.log("─────────────────────────────────────────────────────────────────────────────────────────────────────");
  console.log("Note: 'TOTAL(w-maint-pen)' = what agent's shift updates aggregate to (includes maintenance penalty)");
  console.log("      'TOTAL(no-maint-pen)' = raw step-reward sum (same as aggregateShiftReward(allSteps))");
  console.log("      exp26 DB: MAB high_t60 avg=-123.45 max=-110.99 | medium_t60 (best-ever 1ep) = -88.65");
  console.log("      exp25 DB: MAB low_no_maint avg=-18.65 max=-18.20 | medium_t60 (357ep) avg=-90.25");
}

main().catch(err => { console.error("Probe failed:", err); process.exit(1); });
