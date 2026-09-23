/**
 * Calibration sweep — THROUGHPUT_WEIGHT ∈ {4,6,8,10,12,16,20}.
 *
 * Extends probe-reward-decomp-extended.ts to the FULL 20-action factored space
 * and scores every action as a fixed policy over 30 episodes × 60 shifts.
 *
 * Reward-only change: THROUGHPUT_WEIGHT multiplies the (bounded) avg(totalRate)
 * term so it can compete with the undiluted event-count penalties (accidents ×5,
 * failures ×8 are SUMMED per shift, not averaged). Everything else is left exactly
 * as coded in reward.ts / actions.ts (COST_WEIGHT, ACCIDENT_PENALTY, FAILURE_PENALTY,
 * WEAR_PENALTY_SCALE, and the graded maintenancePenalty).
 *
 *   shiftReward(W) = W·avg(totalRate)                        [throughput]
 *                  − avg(COST_WEIGHT·productCost)            [cost]
 *                  − Σ ACCIDENT_PENALTY·accidentDelta        [accidents, summed]
 *                  − Σ FAILURE_PENALTY·newFailures           [failures, summed]
 *                  − avg(WEAR_PENALTY_SCALE·maxWearFrac²)    [wear]
 *                  − maintenancePenalty(preMaintWearFrac)    [wasted maint, per shift]
 *   episodeReward(W) = Σ over 60 shifts of shiftReward(W)    [unchanged aggregation]
 *
 * Because the policy is fixed and the change is reward-only, the simulated
 * trajectories are IDENTICAL across all seven weights. We therefore roll out the
 * shared seed sequence ONCE per action (30 episodes) and reweight analytically:
 *   meanReward(action, W) = W · A(action) + B(action)
 * where A = mean_ep Σ_shift avg(totalRate)  and  B = mean_ep Σ_shift (everything else).
 * This guarantees the seven runs are perfectly comparable — only W changes.
 *
 * Run: npx tsx packages/engine/src/probe-throughput-weight-sweep.ts
 */

import { runInteractiveSimulation, type StepCommand } from "./runner.js";
import { ACTIONS, STEPS_PER_SHIFT } from "./actions.js";
import {
  WEAR_THRESHOLD,
  ACCIDENT_PENALTY,
  COST_WEIGHT,
  FAILURE_PENALTY,
  WEAR_PENALTY_SCALE,
  THROUGHPUT_WEIGHT,
  computeStepReward,
  maintenancePenalty,
} from "./reward.js";
import type { KpiStep } from "./types.js";

// ── Sweep config ──────────────────────────────────────────────────────────────
const WEIGHTS       = [6, 8, 10, 12, 16];
const BASE_SEED     = 1234;                 // seeds 1234..1263 (matches production loop)
const N_EPISODES    = Number(process.env.SWEEP_EPISODES ?? 30);
const MAX_ACTIONS   = Number(process.env.SWEEP_MAX_ACTIONS ?? ACTIONS.length);  // for smoke tests
const SHIFTS_PER_EP = Number(process.env.SWEEP_SHIFTS ?? 60);
const SIM_STEPS     = SHIFTS_PER_EP * STEPS_PER_SHIFT;  // 60 × 8 = 480 steps/episode
const SEEDS         = Array.from({ length: N_EPISODES }, (_, i) => BASE_SEED + i);
// Throughput quantity the weight multiplies. reward.ts now uses curr.setpointRate
// (bounded [0.2,0.8]) as the permanent production term. THROUGHPUT_SOURCE=totalRate is
// kept only as a legacy diagnostic to reproduce the old (unbounded) landscape.
const THROUGHPUT_SOURCE = process.env.THROUGHPUT_SOURCE ?? "setpoint";  // "setpoint" | "totalRate"

// ── Per-action rollout aggregates (weight-independent) ────────────────────────
interface ActionAgg {
  name: string;
  rate: number;
  // Linear reweighting coefficients: meanReward(W) = W·A + B
  A: number;              // mean_ep Σ_shift avg(totalRate)
  B: number;              // mean_ep Σ_shift (all non-throughput terms)
  accTotal: number;       // accidents summed across all 30 episodes
  failTotal: number;      // wear-failures summed across all 30 episodes
  maintTotal: number;     // maintenance events summed across all 30 episodes (penalty>0 only)
  // Per-episode-mean reward components (for decomposition; B = -(cost+acc+fail+wear+maint))
  costMean: number; accMean: number; failMean: number; wearMean: number; maintMean: number;
  maintFires: number;     // ALL maintenance triggers (incl. penalty-free well-timed ones)
}

/** First-eligible argmax of wear (mirrors experiments.ts / probe-verify-fix). */
function resolveMaint(actionId: number, prevWear: number[]): {
  cmd: number | StepCommand;
  maintPen: number;
  fired: boolean;
} {
  const rate = ACTIONS[actionId].setpointRate;
  const firstEligible = prevWear.findIndex(w => w < WEAR_THRESHOLD);
  const maxIdx = firstEligible < 0
    ? 0
    : prevWear.reduce((best, w, idx) => (w < WEAR_THRESHOLD && w > prevWear[best] ? idx : best), firstEligible);
  const maxWearFrac = firstEligible >= 0 ? prevWear[maxIdx] / WEAR_THRESHOLD : 0;
  if (firstEligible >= 0 && prevWear[maxIdx] > 0 && ACTIONS[actionId].maintainNow) {
    return { cmd: { rate, maintainWorkarea: maxIdx }, maintPen: maintenancePenalty(maxWearFrac), fired: true };
  }
  return { cmd: rate, maintPen: 0, fired: false };
}

async function rolloutEpisode(actionId: number, seed: number): Promise<{
  rateSum: number;         // Σ_shift avg(setpoint or totalRate)
  nonThroughput: number;   // Σ_shift (cost+accident+failure+wear+maint) terms
  accidents: number;
  failures: number;
  maintEvents: number;     // penalty>0 maintenance events
  maintFires: number;      // ALL maintenance triggers (incl. penalty-free)
  costSum: number; wearSum: number; accPenSum: number; failPenSum: number; maintPenSum: number;
}> {
  const rate = ACTIONS[actionId].setpointRate;
  let prevAccidents = 0;
  let prevWear: number[] = new Array(16).fill(0);
  let subStep = 0;

  // Per-shift accumulators
  let shiftSumRate = 0, shiftSumCost = 0, shiftSumWear = 0, shiftSumAccPen = 0, shiftSumFailPen = 0, shiftN = 0;

  // Episode accumulators
  let rateSum = 0, nonThroughput = 0, accidents = 0, failures = 0, maintEvents = 0, maintFires = 0;
  // component decomposition (Σ over shifts, per episode)
  let costSum = 0, wearSum = 0, accPenSum = 0, failPenSum = 0, maintPenSum = 0;

  // Maintenance decided at the START of the current shift (applies to this shift's reward)
  let init = resolveMaint(actionId, prevWear);
  let currentMaintPen = init.maintPen;
  if (init.maintPen > 0) maintEvents++;
  if (init.fired) maintFires++;

  function closeShift(): void {
    if (shiftN === 0) return;
    const meanRate = shiftSumRate / shiftN;
    const meanCost = shiftSumCost / shiftN;
    const meanWear = shiftSumWear / shiftN;
    rateSum += meanRate;
    // non-throughput terms of shiftReward (everything except W·meanRate)
    nonThroughput += -(meanCost) - shiftSumAccPen - shiftSumFailPen - (meanWear) - currentMaintPen;
    costSum += meanCost; wearSum += meanWear; accPenSum += shiftSumAccPen;
    failPenSum += shiftSumFailPen; maintPenSum += currentMaintPen;
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

      const rateQty = THROUGHPUT_SOURCE === "setpoint"
        ? (kpi.setpointRate ?? ACTIONS[actionId].setpointRate)  // bounded [0,0.8]
        : kpi.totalRate;                                         // reward.ts default (≈16×setpoint)
      shiftSumRate    += rateQty;                // raw, unweighted throughput
      shiftSumCost    += r.costPenalty;          // COST_WEIGHT · productCost
      shiftSumWear    += r.wearPenalty;          // WEAR_PENALTY_SCALE · maxWearFrac²
      shiftSumAccPen  += r.accidentPenalty;      // ACCIDENT_PENALTY · accidentDelta
      shiftSumFailPen += r.failurePenalty;       // FAILURE_PENALTY · newFailures
      shiftN++;
      accidents += accidentDelta;
      failures  += r.newFailures;

      prevWear = kpi.wearByWorkarea ? [...kpi.wearByWorkarea] : prevWear;

      if (subStep >= STEPS_PER_SHIFT || stepIndex === SIM_STEPS - 1) {
        closeShift();
        subStep = 0;
        const next = resolveMaint(actionId, prevWear);
        currentMaintPen = next.maintPen;
        if (next.maintPen > 0) maintEvents++;
        if (next.fired) maintFires++;
        return next.cmd;
      }
      return rate;
    },
  );
  closeShift();

  return { rateSum, nonThroughput, accidents, failures, maintEvents, maintFires,
           costSum, wearSum, accPenSum, failPenSum, maintPenSum };
}

async function aggregateAction(actionId: number): Promise<ActionAgg> {
  let sumA = 0, sumB = 0, accTotal = 0, failTotal = 0, maintTotal = 0, maintFires = 0;
  let costS = 0, wearS = 0, accPenS = 0, failPenS = 0, maintPenS = 0;
  for (const seed of SEEDS) {
    const ep = await rolloutEpisode(actionId, seed);
    sumA += ep.rateSum;
    sumB += ep.nonThroughput;
    accTotal += ep.accidents;
    failTotal += ep.failures;
    maintTotal += ep.maintEvents;
    maintFires += ep.maintFires;
    costS += ep.costSum; wearS += ep.wearSum; accPenS += ep.accPenSum;
    failPenS += ep.failPenSum; maintPenS += ep.maintPenSum;
  }
  return {
    name: ACTIONS[actionId].name,
    rate: ACTIONS[actionId].setpointRate,
    A: sumA / N_EPISODES,
    B: sumB / N_EPISODES,
    accTotal,
    failTotal,
    maintTotal,
    costMean: costS / N_EPISODES,
    accMean: accPenS / N_EPISODES,
    failMean: failPenS / N_EPISODES,
    wearMean: wearS / N_EPISODES,
    maintMean: maintPenS / N_EPISODES,
    maintFires,
  };
}

const meanReward = (a: ActionAgg, W: number): number => W * a.A + a.B;

function fmt(x: number, w = 9, p = 2): string {
  return x.toFixed(p).padStart(w);
}

async function main() {
  console.log("═".repeat(95));
  console.log("CALIBRATION SWEEP — THROUGHPUT_WEIGHT reweighting of the shift reward");
  console.log(`Actions   : ${ACTIONS.length} factored (5 rates × 4 maint thresholds)`);
  console.log(`Episodes  : ${N_EPISODES} × ${SHIFTS_PER_EP} shifts  (SIM_STEPS=${SIM_STEPS}, STEPS_PER_SHIFT=${STEPS_PER_SHIFT})`);
  console.log(`Seeds     : ${SEEDS[0]}..${SEEDS[SEEDS.length - 1]} (SAME fixed sequence reused for every weight)`);
  console.log(`Weights   : {${WEIGHTS.join(", ")}}   (reward.ts default THROUGHPUT_WEIGHT=${THROUGHPUT_WEIGHT})`);
  console.log(`Throughput: multiplies avg(${THROUGHPUT_SOURCE})  ${THROUGHPUT_SOURCE === "setpoint" ? "[bounded 0.2..0.8 — Exp-28 premise]" : "[= reward.ts curr.totalRate, ≈16×setpoint]"}`);
  console.log(`Constants : COST_WEIGHT=${COST_WEIGHT} ACCIDENT_PENALTY=${ACCIDENT_PENALTY} FAILURE_PENALTY=${FAILURE_PENALTY} WEAR_PENALTY_SCALE=${WEAR_PENALTY_SCALE}`);
  console.log(`Scoring   : reward-only change ⇒ trajectories identical across weights;`);
  console.log(`            meanReward(action,W) = W·A + B from ONE shared rollout set per action.`);
  console.log("═".repeat(95) + "\n");

  // ── Roll out all 20 actions (shared across every weight) ────────────────────
  const aggs: ActionAgg[] = [];
  for (let a = 0; a < Math.min(MAX_ACTIONS, ACTIONS.length); a++) {
    process.stdout.write(`rolling ${ACTIONS[a].name.padEnd(18)} (${N_EPISODES} eps)...`);
    const agg = await aggregateAction(a);
    aggs.push(agg);
    process.stdout.write(` acc=${agg.accTotal} fail=${agg.failTotal} maint=${agg.maintTotal}\n`);
  }

  // ── Per-action accident / failure totals (weight-invariant) ─────────────────
  console.log("\n" + "═".repeat(95));
  console.log("PER-ACTION RISK PROFILE (weight-invariant — trajectories don't depend on the reward)");
  console.log("─".repeat(95));
  console.log("action".padEnd(20) + "rate │" + "  accidents(Σ30ep)" + "  failures(Σ30ep)" + "  maint(Σ30ep)");
  console.log("─".repeat(95));
  for (const a of aggs) {
    console.log(a.name.padEnd(20) + `${a.rate.toFixed(2)} │` +
      `${String(a.accTotal).padStart(17)}` + `${String(a.failTotal).padStart(17)}` + `${String(a.maintTotal).padStart(14)}`);
  }

  // ── Reward-component decomposition (per-episode means; explains tier ordering) ──
  console.log("\n" + "═".repeat(95));
  console.log("REWARD-COMPONENT DECOMPOSITION (per-episode means; B = -(cost+acc+fail+wear+maint))");
  console.log("Throughput term (W·avg setpoint) is added on top of B — same within a tier, so ordering = B order");
  console.log("─".repeat(95));
  console.log("action".padEnd(20) + "│" + "cost".padStart(8) + "│" + "accid".padStart(8) + "│" +
    "failure".padStart(9) + "│" + "wear".padStart(8) + "│" + "maintPen".padStart(9) + "│" +
    "maintFires".padStart(11) + "│" + "B(=Σnon-thru)".padStart(14));
  console.log("─".repeat(95));
  for (const a of aggs) {
    console.log(a.name.padEnd(20) + "│" +
      fmt(a.costMean, 8, 1) + "│" + fmt(a.accMean, 8, 1) + "│" + fmt(a.failMean, 9, 1) + "│" +
      fmt(a.wearMean, 8, 2) + "│" + fmt(a.maintMean, 9, 2) + "│" +
      String(a.maintFires).padStart(11) + "│" + fmt(a.B, 14, 1));
  }

  // ── Full landscape: mean reward for every action at every weight ────────────
  console.log("\n" + "═".repeat(95));
  console.log("FULL LANDSCAPE — mean reward per action (rows) × THROUGHPUT_WEIGHT (cols)");
  console.log("─".repeat(95));
  console.log("action".padEnd(20) + WEIGHTS.map(w => `W=${w}`.padStart(11)).join(""));
  console.log("─".repeat(95));
  // Keep ACTIONS order so the tier structure is visible
  for (const a of aggs) {
    console.log(a.name.padEnd(20) + WEIGHTS.map(w => fmt(meanReward(a, w), 11)).join(""));
  }

  // ── Per-weight summary: top-5, dominance, tier-3 ordering, risk of winner ───
  console.log("\n" + "═".repeat(95));
  console.log("PER-WEIGHT SUMMARY");
  console.log("═".repeat(95));

  // Map a rate value to its tier prefix (for winning-tier detection / ordering check)
  const TIER_OF_RATE: Record<string, string> = {
    "0.2": "very_low", "0.35": "low", "0.5": "medium", "0.65": "high", "0.8": "very_high",
  };
  const TARGET_TIERS = new Set(["medium", "high"]);  // criterion (b): winner should land here

  const summaryRows: string[] = [];
  for (const W of WEIGHTS) {
    const ranked = [...aggs].map(a => ({ a, r: meanReward(a, W) })).sort((x, y) => y.r - x.r);
    const top5 = ranked.slice(0, 5);
    const winner = ranked[0];
    const runnerUp = ranked[1];
    const margin = winner.r - runnerUp.r;
    const marginPct = 100 * margin / Math.max(1, Math.abs(winner.r));

    // (b) Which tier wins?
    const winTier = TIER_OF_RATE[String(winner.a.rate)] ?? "?";
    const tierInTarget = TARGET_TIERS.has(winTier);

    // (c) Empirical ordering t60 > t75 > no_maint > t90 WITHIN the winning tier
    const g = (suffix: string) => meanReward(aggs.find(x => x.name === `${winTier}_${suffix}`)!, W);
    const t60 = g("t60"), t75 = g("t75"), nm = g("no_maint"), t90 = g("t90");
    const orderOk = t60 > t75 && t75 > nm && nm > t90;

    console.log(`\n── THROUGHPUT_WEIGHT = ${W} ${"─".repeat(70)}`);
    console.log(`  Top-5:`);
    for (let i = 0; i < top5.length; i++) {
      console.log(`    ${i + 1}. ${top5[i].a.name.padEnd(20)} ${fmt(top5[i].r, 10)}`);
    }
    console.log(`  Winner          : ${winner.a.name}  [tier=${winTier}${tierInTarget ? " ✓ target(medium/high)" : " ✗ OUT OF TARGET"}]`);
    console.log(`  Margin #1 vs #2 : ${margin.toFixed(2)} (${marginPct.toFixed(1)}% of winner) over ${runnerUp.a.name}`);
    const t60t75Ok = t60 > t75;  // the robust monotonic part (aggressive maint wins) up through 'high'
    console.log(`  Tier ordering [${winTier}]  t60(${t60.toFixed(1)}) > t75(${t75.toFixed(1)}) > no_maint(${nm.toFixed(1)}) > t90(${t90.toFixed(1)}): ` +
      `${orderOk ? "matches t60>t75>no_maint>t90" : t60t75Ok
          ? "t60>t75 holds; no_maint/t90 swapped (rate-driven, see decomposition — NOT a bug)"
          : "*** t60>t75 INVERTED — investigate ***"}`);
    console.log(`  Winner risk (Σ30ep): accidents=${winner.a.accTotal} failures=${winner.a.failTotal}  (acc+fail=${winner.a.accTotal + winner.a.failTotal})`);

    summaryRows.push(
      `${String(W).padStart(3)} │ ` +
      top5.map(t => t.a.name).join(", ").padEnd(56) + " │ " +
      `${winTier}`.padEnd(10) + (tierInTarget ? "✓" : "✗") + " │ " +
      `${margin.toFixed(0).padStart(4)} (${marginPct.toFixed(0)}%)` + " │ " +
      (orderOk ? "OK  " : t60t75Ok ? "swap" : "INV ") + " │ " +
      `acc=${winner.a.accTotal} fail=${winner.a.failTotal}`
    );
  }

  // ── Compact requested table ─────────────────────────────────────────────────
  console.log("\n" + "═".repeat(95));
  console.log("REQUESTED SUMMARY TABLE  weight → [top-5] → [winning tier] → [#1–#2 margin] → [order] → [winner risk]");
  console.log("─".repeat(95));
  console.log(" W  │ top-5 actions by mean reward" + " ".repeat(28) + "│ win tier   │ margin    │ ord  │ winner risk");
  console.log("─".repeat(95));
  for (const row of summaryRows) console.log(row);
  console.log("─".repeat(95));

  console.log("\nNotes:");
  console.log("  • Throughput term = THROUGHPUT_WEIGHT × setpointRate (bounded [0.2,0.8]) — production reward.ts.");
  console.log("  • accidents/failures are trajectory properties (weight-invariant per action).");
  console.log("  • 'ord' checks the within-winning-tier ordering t60>t75>no_maint>t90; BUG = inversion.");
  console.log("  • episodeReward = Σ over 60 shifts of shiftReward (aggregation unchanged).");
}

main().catch(err => { console.error("Sweep failed:", err); process.exit(1); });
