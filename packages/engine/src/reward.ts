import type { KpiStep, State } from "./types.js";
import { clockToMinutes } from "./utils.js";

// ─── constants ────────────────────────────────────────────────────
// Must match Java's Const.NO_PARTS_WEAR_BREAKDOWN = 3 * 24 * 60 * 1.0 = 4320.
// (Previously 43200 — a 10× mismatch that made every wearFraction 10× too small,
// which is why every agent appeared to "maintain at 10%" when in fact workareas
// were running all the way to failure.)
export const WEAR_THRESHOLD     = 4320;    // rate-minutes to failure
export const FAILURE_PENALTY    = 8.0;     // per workarea failure event
// Convex wear penalty: applied as SCALE * maxWearFraction^2 so mid-wear barely
// costs anything and only near-failure wear is punished. Prevents the reward
// from pushing agents toward premature maintenance.
export const WEAR_PENALTY_SCALE = 0.4;     // was 1.0 + linear; now multiplies wearFrac²
export const ACCIDENT_PENALTY   = 5.0;     // per accident delta (tuned: pushes agents toward high over very_high)
export const COST_WEIGHT        = 0.5;     // productCost weight
// Throughput term: multiplies the BOUNDED setpoint rate (∈[0.2,0.8]) so it competes
// on the same scale as the undiluted event-count penalties (accidents/failures are
// summed, not averaged). Using the bounded setpoint — instead of totalRate (≈16×setpoint,
// unbounded) — is what makes the winning tier rise smoothly with the weight
// (very_low→medium→high→very_high) rather than collapsing to very_high immediately.
export const THROUGHPUT_WEIGHT  = 8;       // × setpointRate; calibrated (medium/high competitive, ordering intact, risk contained)

// ─── maintenance timing penalty ──────────────────────────────────
// Penalises triggering maintenance when wear is low (wasted downtime).
// Penalty scales linearly from full at 0% wear to zero at MAINT_IDEAL_WEAR.
export const WASTED_MAINT_PENALTY = 6.0;   // max penalty per wasted maintenance event (was 3.0)
export const MAINT_IDEAL_WEAR    = 0.85;   // above 85% wear → no penalty (was 0.70)

/**
 * Compute the penalty for triggering maintenance at a given wear fraction.
 * Returns 0 when wear >= MAINT_IDEAL_WEAR (well-timed maintenance).
 * Returns up to WASTED_MAINT_PENALTY when wear is near 0 (wasted).
 */
export function maintenancePenalty(maxWearFraction: number): number {
  if (maxWearFraction >= MAINT_IDEAL_WEAR) return 0;
  return WASTED_MAINT_PENALTY * (1 - maxWearFraction / MAINT_IDEAL_WEAR);
}

// ─── step reward components ───────────────────────────────────────
export interface StepRewardComponents {
  throughput:      number;   // THROUGHPUT_WEIGHT × setpointRate (bounded [0.2,0.8])
  costPenalty:     number;   // COST_WEIGHT × productCost
  accidentPenalty: number;   // ACCIDENT_PENALTY × accidentDelta
  failurePenalty:  number;   // FAILURE_PENALTY × newFailures
  wearPenalty:     number;   // WEAR_PENALTY_SCALE × maxWearFraction
  total:           number;
  newFailures:     number;   // raw count of wear-driven failures this step (for episode logging)
}

/**
 * Detect wear failure transitions by finding workareas whose wear
 * was near the threshold and then reset (dropped sharply).
 */
export function detectFailures(
  prevWear: number[],
  currWear: number[],
): number {
  let newFailures = 0;
  const len = Math.min(prevWear.length, currWear.length, 16);
  for (let i = 0; i < len; i++) {
    const wasNearThreshold = prevWear[i] > WEAR_THRESHOLD * 0.95;
    const hasReset = currWear[i] < prevWear[i] * 0.1; // dropped >90%
    if (wasNearThreshold && hasReset) newFailures++;
  }
  return newFailures;
}

/**
 * Compute per-step reward with failure and wear penalties.
 */
export function computeStepReward(
  curr: KpiStep,
  accidentDelta: number,
  prevWear: number[],
): StepRewardComponents {
  const currWear = curr.wearByWorkarea ?? [];
  const newFailures = detectFailures(prevWear, currWear);

  const throughput      = THROUGHPUT_WEIGHT * curr.setpointRate;
  const costPenalty     = COST_WEIGHT * curr.productCost;
  const accidentPenalty = ACCIDENT_PENALTY * accidentDelta;
  const failurePenalty  = FAILURE_PENALTY * newFailures;

  const maxWearFraction = currWear.length > 0
    ? Math.max(...currWear) / WEAR_THRESHOLD
    : 0;
  // Convex in wear: negligible below ~50%, rises sharply toward failure.
  const wearPenalty = WEAR_PENALTY_SCALE * maxWearFraction * maxWearFraction;

  const total = throughput - costPenalty - accidentPenalty - failurePenalty - wearPenalty;

  return { throughput, costPenalty, accidentPenalty, failurePenalty, wearPenalty, total, newFailures };
}

/**
 * Aggregate per-step rewards into a shift/episode reward.
 * Continuous signals (throughput, cost, wear) are averaged.
 * Event-based penalties (accidents, failures) are summed to preserve sharp signal.
 */
export function aggregateShiftReward(steps: StepRewardComponents[]): number {
  if (steps.length === 0) return 0;
  const n = steps.length;
  const baseReward = steps.reduce((s, r) => s + r.throughput - r.costPenalty, 0) / n;
  const penalties  = steps.reduce((s, r) => s + r.accidentPenalty + r.failurePenalty, 0);
  const wearCost   = steps.reduce((s, r) => s + r.wearPenalty, 0) / n;
  return baseReward - penalties - wearCost;
}

// INCENTIVE VERIFICATION (ACCIDENT_PENALTY=5.0, sim model index 3 wmin=0.50):
// Rate 0.80: ~6 accidents/ep × 5.0 = 30 penalty, rate gain ~0.15 over 0.65 → net loss
// Rate 0.65: fewer accidents → better net reward (confirmed by Q-Learning R=-12 vs -20)
// Penalty tuned to push agents toward high (0.65) over very_high (0.80).
//
// MAINTENANCE TIMING:
// Maint at 10% wear: penalty = 6.0 × (1 − 0.10/0.85) ≈ 5.29 (very wasteful)
// Maint at 60% wear: penalty = 6.0 × (1 − 0.60/0.85) ≈ 1.76 (still wasteful)
// Maint at 85% wear: penalty = 0 (ideal timing)
// Combined with convex wear penalty (≈ 0.4 × wearFrac²), the reward only
// punishes wear near failure — so the agent is free to let wear climb before
// acting, which was the original goal of this signal.

/**
 * Extract a state vector from a single KPI step.
 *
 * When wearByWorkarea is available (interactive mode), the 6th dimension
 * maxWearFraction is included as a predictive maintenance signal.
 */
export function extractState(step: KpiStep, totalSteps: number): State;
export function extractState(steps: KpiStep[], totalSteps: number): State;
export function extractState(input: KpiStep | KpiStep[], totalSteps: number): State {
  const step: KpiStep = Array.isArray(input) ? (input[input.length - 1] ?? {
    step: 0, auditDay: 0, weekDay: 0, clock: "00:00",
    ambTemperature: 20, rawMaterialQuality: 0.5,
    currPower: 0, totalRate: 0, setpointRate: 0,
    cumProduction: 0, cumEnergy: 0, cumCost: 0,
    productEnergy: 0, productCost: 0, numberAccidents: 0,
  }) : input;

  // Shift-phase-of-day: which 8h block (00:00 / 08:00 / 16:00) this boundary
  // falls in, normalized to {0, 0.5, 1.0}. Replaces within-shift progress, which
  // was constant (0) at every observed shift boundary. The daily temperature
  // cosine peaks at 16:00, so phase is a live predictor of Unit C power/wear.
  const minuteOfDay = clockToMinutes(step.clock);
  const shiftPhaseNorm = Math.floor(minuteOfDay / 480) / 2;

  const state: State = {
    ambTemperature: step.ambTemperature,
    rawMaterialQuality: step.rawMaterialQuality,
    stepNorm: step.step / totalSteps,
    shiftPhaseNorm,
    numberAccidents: step.numberAccidents,
  };

  if (step.wearByWorkarea && step.wearByWorkarea.length > 0) {
    state.maxWearFraction = Math.max(...step.wearByWorkarea) / WEAR_THRESHOLD;
  }

  return state;
}
