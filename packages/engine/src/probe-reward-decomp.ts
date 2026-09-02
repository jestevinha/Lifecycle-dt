/**
 * Probe — Experiment 29 reward-component decomposition (DIAGNOSTIC ONLY).
 *
 * Instrument-and-report. Modifies NOTHING in the production path: reward.ts,
 * experiments.ts, actions.ts and every agent are imported UNMODIFIED. Agent action
 * selection is BYPASSED (forced fixed action per run) — no epsilon schedule, no
 * reward weight, no constant is touched. If this file is deleted, Experiment 29
 * reproduces bit-for-bit.
 *
 * It replicates the experiments.ts interactive loop (experiments.ts:227-378, :428-430)
 * EXACTLY — same per-shift command resolution, same computeStepReward call order,
 * same aggregateShiftReward, same episode-reward formula stored in the DB/CSV — so the
 * numbers below are directly comparable to the Experiment 29 `reward` CSV column.
 *
 * The ONLY differences vs experiments.ts:
 *   1. currentActionId is a constant (forced), never agent.selectAction(...).
 *   2. Per-shift reward components are decomposed and logged (read-only accounting;
 *      it re-reads the exact StepRewardComponents the production loop produces, so it
 *      cannot perturb rewards — see the bit-identical self-check in run()).
 *
 * Exp 29 config (from DB): { simSteps: 200, simSeed: 42, totalEpisodes: 500 }.
 * We use simSteps=200, seeds 42+0..42+19 (== Exp29's first 20 episode seeds), 20 eps.
 *
 * Run:  npx tsx src/probe-reward-decomp.ts
 */

import fs from "node:fs";
import { runInteractiveSimulation, type StepCommand } from "./runner.js";
import { ACTIONS, STEPS_PER_SHIFT, shouldTriggerMaintenance } from "./actions.js";
import {
  WEAR_THRESHOLD, THROUGHPUT_WEIGHT, COST_WEIGHT, ACCIDENT_PENALTY, FAILURE_PENALTY,
  WEAR_PENALTY_SCALE, computeStepReward, aggregateShiftReward, maintenancePenalty,
  type StepRewardComponents,
} from "./reward.js";
import type { KpiStep } from "./types.js";

// ── probe config (comparable to Experiment 29) ──────────────────────
const SIM_STEPS   = Number(process.env.SIM_STEPS ?? 200);   // Exp29 simSteps
const BASE_SEED   = Number(process.env.BASE_SEED ?? 42);    // Exp29 simSeed
const EPISODES    = Number(process.env.EPISODES ?? 20);
const SHIFT_CSV   = "C:/Users/Joaom/AppData/Local/Temp/claude/c--Users-Joaom-Documents-Learn-Tese-dt-monorepo/43c559cb-9c4b-4e65-bb9e-0b11f61d3619/scratchpad/reward_decomp_shifts.csv";
const SUM_JSON    = "C:/Users/Joaom/AppData/Local/Temp/claude/c--Users-Joaom-Documents-Learn-Tese-dt-monorepo/43c559cb-9c4b-4e65-bb9e-0b11f61d3619/scratchpad/reward_decomp_summary.json";

// Forced actions under test (ids per actions.ts: rate*4 + threshold-index).
const PROBE_ACTIONS = [
  { id: 4,  name: "low_no_maint" },
  { id: 10, name: "medium_t75" },
  { id: 11, name: "medium_t60" },
  { id: 15, name: "high_t60" },
];

/** Per-episode decomposition — every field aggregated the way the DB/CSV reward is. */
interface EpisodeDecomp {
  total: number;            // == aggregateShiftReward(all stepRewards)  == Exp29 CSV `reward`
  thrContrib: number;       // + mean(throughput)               (weighted, in reward units)
  costContrib: number;      // - mean(costPenalty)
  accContrib: number;       // - sum(accidentPenalty)
  failContrib: number;      // - sum(failurePenalty)  UNPLANNED breakdown term
  wearContrib: number;      // - mean(wearPenalty)
  plannedMaint: number;     // - sum(maintenancePenalty) PLANNED-maint cost (see note below)
  // raw diagnostics
  totalAccidents: number;
  totalUnplannedFailures: number;
  numMaintEvents: number;
  avgSetpointRate: number;
  avgProductCost: number;
  nSteps: number;
}

let shiftRows: string[] = [];

/** One forced-action episode. Loop body copied verbatim from experiments.ts:227-378. */
async function forcedEpisode(actionId: number, actionName: string, seed: number, epIdx: number): Promise<EpisodeDecomp> {
  // ── state mirrors experiments.ts exactly ──
  const currentActionId = actionId;               // FORCED (was agent.selectAction)
  let prevAccidents = 0;
  let prevWear: number[] = new Array(16).fill(0);
  let subStep = 0;
  let shiftRate = ACTIONS[currentActionId].setpointRate;
  let maintTarget = -1;
  let preMaintenanceWearFrac = 0;
  let shiftStepRewards: StepRewardComponents[] = [];

  // Whole-episode accumulator (this is what aggregateShiftReward(stepRewards) sees).
  const stepRewards: StepRewardComponents[] = [];
  let plannedMaintTotal = 0;      // sum of maintenancePenalty across shifts (SEPARATE term)
  let numMaintEvents = 0;
  let shiftIdx = 0;

  // resolveCommand — verbatim from experiments.ts:259-285
  function resolveCommand(): number | StepCommand {
    shiftRate = ACTIONS[currentActionId].setpointRate;
    const firstEligible = prevWear.findIndex(w => w < WEAR_THRESHOLD);
    const maxIdx = firstEligible < 0
      ? 0
      : prevWear.reduce((best, w, idx) => (w < WEAR_THRESHOLD && w > prevWear[best] ? idx : best), firstEligible);
    const maxWearFrac = prevWear.length > 0 && firstEligible >= 0 ? prevWear[maxIdx] / WEAR_THRESHOLD : 0;
    if (firstEligible >= 0 && prevWear[maxIdx] > 0 && shouldTriggerMaintenance(currentActionId, maxWearFrac)) {
      maintTarget = maxIdx;
      preMaintenanceWearFrac = maxWearFrac;
      return { rate: shiftRate, maintainWorkarea: maintTarget };
    }
    maintTarget = -1;
    preMaintenanceWearFrac = 0;
    return shiftRate;
  }

  let initialCmd = resolveCommand();

  await runInteractiveSimulation(
    { steps: SIM_STEPS, seed },
    initialCmd,
    (kpiStep: KpiStep, stepIndex: number) => {
      subStep++;

      // Per-step reward — identical call to production (experiments.ts:307-313)
      const accidentDelta = kpiStep.numberAccidents - prevAccidents;
      prevAccidents = kpiStep.numberAccidents;
      const reward = computeStepReward(kpiStep, accidentDelta, prevWear);
      stepRewards.push(reward);
      shiftStepRewards.push(reward);
      prevWear = kpiStep.wearByWorkarea ? [...kpiStep.wearByWorkarea] : prevWear;

      if (subStep >= STEPS_PER_SHIFT || stepIndex === SIM_STEPS - 1) {
        // Shift-level reward (as given to the agent in production, experiments.ts:317-332)
        let shiftReward = aggregateShiftReward(shiftStepRewards);
        let plannedPenalty = 0;
        if (maintTarget >= 0) {
          plannedPenalty = maintenancePenalty(preMaintenanceWearFrac);
          shiftReward -= plannedPenalty;
          plannedMaintTotal += plannedPenalty;
          numMaintEvents++;
        }

        // ── DIAGNOSTIC-ONLY per-shift decomposition (read-only accounting) ──
        const nS = shiftStepRewards.length;
        const thrRawMean  = shiftStepRewards.reduce((s, r) => s + r.throughput / THROUGHPUT_WEIGHT, 0) / nS; // == mean setpointRate
        const thrWtMean   = shiftStepRewards.reduce((s, r) => s + r.throughput, 0) / nS;
        const costRawMean = shiftStepRewards.reduce((s, r) => s + r.costPenalty / COST_WEIGHT, 0) / nS;       // == mean productCost
        const costWtMean  = shiftStepRewards.reduce((s, r) => s + r.costPenalty, 0) / nS;
        const accRaw      = shiftStepRewards.reduce((s, r) => s + r.accidentPenalty / ACCIDENT_PENALTY, 0);   // Σ accident deltas
        const accWt       = shiftStepRewards.reduce((s, r) => s + r.accidentPenalty, 0);
        const failRaw     = shiftStepRewards.reduce((s, r) => s + r.newFailures, 0);                          // Σ unplanned failures
        const failWt      = shiftStepRewards.reduce((s, r) => s + r.failurePenalty, 0);
        const wearRawMean = shiftStepRewards.reduce((s, r) => s + Math.sqrt(r.wearPenalty / WEAR_PENALTY_SCALE), 0) / nS; // mean wearFrac
        const wearWtMean  = shiftStepRewards.reduce((s, r) => s + r.wearPenalty, 0) / nS;
        shiftRows.push([
          actionName, epIdx, shiftIdx, currentActionId,
          thrRawMean.toFixed(4), thrWtMean.toFixed(4),
          costRawMean.toFixed(4), costWtMean.toFixed(4),
          accRaw.toFixed(0), accWt.toFixed(4),
          maintTarget >= 0 ? "planned" : "-", (preMaintenanceWearFrac * 100).toFixed(1), plannedPenalty.toFixed(4),
          failRaw.toFixed(0), failWt.toFixed(4),
          wearRawMean.toFixed(4), wearWtMean.toFixed(4),
          shiftReward.toFixed(4),
        ].join(","));

        subStep = 0;
        shiftStepRewards = [];
        shiftIdx++;
        return resolveCommand();
      }
      return shiftRate;
    },
  );

  // ── Episode reward EXACTLY as stored by experiments.ts:428-430 ──
  const total = aggregateShiftReward(stepRewards);

  // Decompose that same aggregate into additive contributions (sum == total).
  const n = stepRewards.length;
  const thrContrib  =  stepRewards.reduce((s, r) => s + r.throughput, 0) / n;
  const costContrib = -stepRewards.reduce((s, r) => s + r.costPenalty, 0) / n;
  const accContrib  = -stepRewards.reduce((s, r) => s + r.accidentPenalty, 0);
  const failContrib = -stepRewards.reduce((s, r) => s + r.failurePenalty, 0);
  const wearContrib = -stepRewards.reduce((s, r) => s + r.wearPenalty, 0) / n;

  return {
    total, thrContrib, costContrib, accContrib, failContrib, wearContrib,
    plannedMaint: -plannedMaintTotal,
    totalAccidents: stepRewards.reduce((s, r) => s + r.accidentPenalty / ACCIDENT_PENALTY, 0),
    totalUnplannedFailures: stepRewards.reduce((s, r) => s + r.newFailures, 0),
    numMaintEvents,
    avgSetpointRate: thrContrib / THROUGHPUT_WEIGHT,
    avgProductCost: (-costContrib) / COST_WEIGHT,
    nSteps: n,
  };
}

function mean(xs: number[]): number { return xs.reduce((s, x) => s + x, 0) / xs.length; }

async function main() {
  console.log("═".repeat(96));
  console.log("EXPERIMENT 29 — REWARD DECOMPOSITION PROBE (forced-action, diagnostic only)");
  console.log(`config: SIM_STEPS=${SIM_STEPS} (${SIM_STEPS / STEPS_PER_SHIFT} shifts/ep), seeds=${BASE_SEED}..${BASE_SEED + EPISODES - 1}, ${EPISODES} eps/action`);
  console.log(`constants: THROUGHPUT_WEIGHT=${THROUGHPUT_WEIGHT} COST_WEIGHT=${COST_WEIGHT} ACCIDENT_PENALTY=${ACCIDENT_PENALTY} FAILURE_PENALTY=${FAILURE_PENALTY} WEAR_PENALTY_SCALE=${WEAR_PENALTY_SCALE}`);
  console.log("═".repeat(96));

  shiftRows = ["action,ep,shift,actionId,thrRaw(setpt),thrWt,costRaw,costWt,accRaw,accWt,maint,preWear%,plannedMaintPen,failRaw,failWt,wearRaw(frac),wearWt,shiftReward"];

  const summary: Record<string, EpisodeDecomp> = {};
  const perAction: Record<string, EpisodeDecomp[]> = {};

  for (const act of PROBE_ACTIONS) {
    const eps: EpisodeDecomp[] = [];
    // Bit-identical self-check: recompute episode total a second, independent way
    // (Σ of the additive contributions) and confirm it equals aggregateShiftReward.
    let maxDrift = 0;
    for (let i = 0; i < EPISODES; i++) {
      const d = await forcedEpisode(act.id, act.name, BASE_SEED + i, i);
      const reconstructed = d.thrContrib + d.costContrib + d.accContrib + d.failContrib + d.wearContrib;
      maxDrift = Math.max(maxDrift, Math.abs(reconstructed - d.total));
      eps.push(d);
      process.stdout.write(`  ${act.name} ep ${i + 1}/${EPISODES}  R=${d.total.toFixed(1)}      \r`);
    }
    perAction[act.name] = eps;
    summary[act.name] = {
      total: mean(eps.map(e => e.total)),
      thrContrib: mean(eps.map(e => e.thrContrib)),
      costContrib: mean(eps.map(e => e.costContrib)),
      accContrib: mean(eps.map(e => e.accContrib)),
      failContrib: mean(eps.map(e => e.failContrib)),
      wearContrib: mean(eps.map(e => e.wearContrib)),
      plannedMaint: mean(eps.map(e => e.plannedMaint)),
      totalAccidents: mean(eps.map(e => e.totalAccidents)),
      totalUnplannedFailures: mean(eps.map(e => e.totalUnplannedFailures)),
      numMaintEvents: mean(eps.map(e => e.numMaintEvents)),
      avgSetpointRate: mean(eps.map(e => e.avgSetpointRate)),
      avgProductCost: mean(eps.map(e => e.avgProductCost)),
      nSteps: eps[0].nSteps,
    };
    console.log(`\n  [self-check] ${act.name}: max |Σcontrib − aggregateShiftReward| over ${EPISODES} eps = ${maxDrift.toExponential(2)}  ${maxDrift < 1e-9 ? "✓ bit-identical" : "✗ DRIFT"}`);
  }

  fs.writeFileSync(SHIFT_CSV, shiftRows.join("\n"));
  fs.writeFileSync(SUM_JSON, JSON.stringify({ config: { SIM_STEPS, BASE_SEED, EPISODES }, summary, perAction }, null, 2));

  // ── Task 3 table ──
  const pad = (s: string | number, n: number) => String(s).padStart(n);
  console.log("\n" + "═".repeat(96));
  console.log("TASK 3 — mean per-episode reward decomposition (additive; columns sum to total)");
  console.log("─".repeat(96));
  console.log([
    "action".padEnd(14), pad("total", 9), pad("thr+", 9), pad("cost-", 9),
    pad("acc-", 9), pad("fail-", 9), pad("wear-", 9), pad("[plMaint]", 10),
  ].join(" "));
  console.log("─".repeat(96));
  for (const act of PROBE_ACTIONS) {
    const s = summary[act.name];
    console.log([
      act.name.padEnd(14), pad(s.total.toFixed(2), 9), pad(s.thrContrib.toFixed(2), 9),
      pad(s.costContrib.toFixed(2), 9), pad(s.accContrib.toFixed(2), 9),
      pad(s.failContrib.toFixed(2), 9), pad(s.wearContrib.toFixed(2), 9),
      pad(s.plannedMaint.toFixed(2), 10),
    ].join(" "));
  }
  console.log("─".repeat(96));
  console.log("raw diagnostics (mean/episode):");
  for (const act of PROBE_ACTIONS) {
    const s = summary[act.name];
    console.log(`  ${act.name.padEnd(14)} accidents=${s.totalAccidents.toFixed(1).padStart(6)}  unplannedFailures=${s.totalUnplannedFailures.toFixed(1).padStart(5)}  maintEvents=${s.numMaintEvents.toFixed(1).padStart(5)}  avgRate=${s.avgSetpointRate.toFixed(3)}  avgCost=${s.avgProductCost.toFixed(2)}`);
  }
  console.log("\nNOTE: [plMaint] (planned-maintenance / maintenancePenalty) is applied to the per-shift");
  console.log("reward the AGENT sees (experiments.ts:322) but is EXCLUDED from the episode reward stored");
  console.log("in the DB/CSV (experiments.ts:430 recomputes aggregateShiftReward with no maint penalty).");
  console.log("So 'total' == Exp29 CSV reward; [plMaint] is reported separately, not added into total.");
  console.log(`\nShift-level CSV → ${SHIFT_CSV}`);
  console.log(`Summary JSON    → ${SUM_JSON}`);
}

main().catch(err => { console.error("Probe failed:", err); process.exit(1); });
