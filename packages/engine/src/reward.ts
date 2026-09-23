import type { KpiStep, State, RewardProfile } from "./types.js";
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
// Throughput term: multiplies the ACHIEVED plant output, normalized to the same
// [0.2,0.8]-ish scale as setpointRate by dividing the raw 16-workarea sum
// (totalRate, ∈[0,12.8] at full capacity) by the 16 total workareas — NOT by the
// count still online, which would average away the very production loss this term
// exists to surface. At 16/16 online, totalRate/16 == setpointRate exactly, so the
// term degrades gracefully from the old setpointRate-only behavior as workareas fail.
export const THROUGHPUT_WEIGHT  = 8;       // × (totalRate/16); calibrated (medium/high competitive, ordering intact, risk contained)
export const TOTAL_WORKAREAS    = 16;      // plant-wide capacity divisor for the throughput term

// ─── reward profiles (2026-09-23) ───────────────────────────────────
// The weights above ("balanced") are the long-tuned reference numbers used for
// every experiment to date. "production" and "efficiency" reweight the SAME
// components — nothing new is added to the reward, only how much each existing
// term counts — so all three profiles remain comparable apples-to-apples.
// accidentPenalty/failurePenalty are held fixed across profiles: safety is
// treated as a constraint the agent must respect regardless of its goal, not a
// knob to trade off against throughput or cost.
export interface RewardWeights {
  throughputWeight: number;
  costWeight: number;
  accidentPenalty: number;
  failurePenalty: number;
  wearPenaltyScale: number;
}

export const REWARD_WEIGHT_PROFILES: Record<RewardProfile, RewardWeights> = {
  balanced: {
    throughputWeight: THROUGHPUT_WEIGHT,
    costWeight: COST_WEIGHT,
    accidentPenalty: ACCIDENT_PENALTY,
    failurePenalty: FAILURE_PENALTY,
    wearPenaltyScale: WEAR_PENALTY_SCALE,
  },
  // Pushes for maximum output: throughput counts 1.5× more, cost and wear
  // count for half as much — the agent should run hotter and tolerate more
  // wear/cost to chase rate.
  production: {
    throughputWeight: THROUGHPUT_WEIGHT * 1.5,
    costWeight: COST_WEIGHT * 0.5,
    accidentPenalty: ACCIDENT_PENALTY,
    failurePenalty: FAILURE_PENALTY,
    wearPenaltyScale: WEAR_PENALTY_SCALE * 0.5,
  },
  // Pushes for low cost/wear: throughput counts for less, cost and wear count
  // 2× more — the agent should favor cheaper, gentler operation even if
  // output dips.
  efficiency: {
    throughputWeight: THROUGHPUT_WEIGHT * 0.625,
    costWeight: COST_WEIGHT * 2,
    accidentPenalty: ACCIDENT_PENALTY,
    failurePenalty: FAILURE_PENALTY,
    wearPenaltyScale: WEAR_PENALTY_SCALE * 2,
  },
};

/** Resolve a (possibly undefined) profile name to its weights. Defaults to "balanced". */
export function resolveRewardWeights(profile?: RewardProfile): RewardWeights {
  return REWARD_WEIGHT_PROFILES[profile ?? "balanced"];
}

// ─── maintenance timing penalty (REMOVED from the live experiment path 2026-09-19) ──
// Penalised triggering maintenance when wear is low (wasted downtime), on top of
// the natural production loss already incurred while the targeted workarea is
// offline (Unit.java: currRate=0 under STATUS_MAINTENANCE, reflected in the
// `throughput` term below). That's a hand-tuned bias toward the modeler's own
// assumption of "ideal" wear timing, not a signal the environment actually
// produces — agents should learn the maintenance-timing tradeoff purely from the
// unbiased production-loss cost, not from an artificial penalty layered on top.
// `packages/api/src/routes/experiments.ts` no longer calls `maintenancePenalty()`.
// Left here (not deleted) only because several historical `probe-*.ts` scripts
// still reference it as part of what they were testing at the time.
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
  throughput:      number;   // THROUGHPUT_WEIGHT × (totalRate/16) — achieved output, plant-capacity-normalized
  costPenalty:     number;   // COST_WEIGHT × productCost
  accidentPenalty: number;   // ACCIDENT_PENALTY × accidentDelta
  failurePenalty:  number;   // FAILURE_PENALTY × newFailures
  wearPenalty:     number;   // WEAR_PENALTY_SCALE × maxWearFraction
  total:           number;
  newFailures:     number;   // raw count of wear-driven failures this step (for episode logging)
}

/**
 * Detect wear failure transitions by finding workareas whose wear crosses
 * WEAR_THRESHOLD this step (STATUS_ON → STATUS_FAILURE onset in Unit.java).
 *
 * Fires exactly once per failure, at onset — not at self-heal completion.
 * Wear is frozen (not incremented) for the whole STATUS_FAILURE/STATUS_MAINTENANCE
 * dwell in Unit.java, so currWear[i] stays >= WEAR_THRESHOLD on every subsequent
 * step (no refire), and the eventual self-heal reset (wearStatus → 0) sees
 * prevWear[i] already >= WEAR_THRESHOLD, so the reset step doesn't match either.
 *
 * `maintainedWorkarea` (Known-Bugs-Fixed #13, fixed 2026-09-05; widened to
 * accept multiple indices 2026-09-21 for multi-target maintenance — see
 * Per-Workarea-Rate-Control.md): the index (or indices) of the workarea(s)
 * deliberately targeted by this shift's MAINT command, or -1/empty if none.
 * Preventive maintenance normally resets wear before it ever reaches
 * WEAR_THRESHOLD, so it wouldn't trigger this detector anyway — the exclusion
 * remains as a guard for the edge case of a maintenance threshold at/near 1.0.
 */
export function detectFailures(
  prevWear: number[],
  currWear: number[],
  maintainedWorkarea: number | number[] = -1,
): number {
  const maintained = new Set(Array.isArray(maintainedWorkarea) ? maintainedWorkarea : [maintainedWorkarea]);
  let newFailures = 0;
  const len = Math.min(prevWear.length, currWear.length, 16);
  for (let i = 0; i < len; i++) {
    if (maintained.has(i)) continue; // deliberate reset, not a failure
    const crossedThreshold = prevWear[i] < WEAR_THRESHOLD && currWear[i] >= WEAR_THRESHOLD;
    if (crossedThreshold) newFailures++;
  }
  return newFailures;
}

/**
 * Compute per-step reward with failure and wear penalties.
 *
 * `maintainedWorkarea` (Known-Bugs-Fixed #13): forwarded to `detectFailures`
 * so a step's deliberate MAINT target isn't miscounted as an unplanned
 * failure. Defaults to -1 (no exclusion) so existing callers (probe scripts)
 * that don't pass it keep their prior behavior.
 *
 * `weights` (2026-09-23, reward profiles): defaults to the "balanced" profile
 * (the module constants above), so existing callers that don't pass it keep
 * their prior behavior unchanged. Pass `resolveRewardWeights(profile)` to
 * train under "production" or "efficiency" instead.
 */
export function computeStepReward(
  curr: KpiStep,
  accidentDelta: number,
  prevWear: number[],
  maintainedWorkarea: number | number[] = -1,
  weights: RewardWeights = REWARD_WEIGHT_PROFILES.balanced,
): StepRewardComponents {
  const currWear = curr.wearByWorkarea ?? [];
  const newFailures = detectFailures(prevWear, currWear, maintainedWorkarea);

  const throughput      = weights.throughputWeight * (curr.totalRate / TOTAL_WORKAREAS);
  const costPenalty     = weights.costWeight * curr.productCost;
  const accidentPenalty = weights.accidentPenalty * accidentDelta;
  const failurePenalty  = weights.failurePenalty * newFailures;

  const maxWearFraction = currWear.length > 0
    ? Math.max(...currWear) / WEAR_THRESHOLD
    : 0;
  // Convex in wear: negligible below ~50%, rises sharply toward failure.
  const wearPenalty = weights.wearPenaltyScale * maxWearFraction * maxWearFraction;

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
 * maxWearFraction is included as a predictive maintenance signal — by
 * default the PLANT-WIDE max across all 16 workareas. Pass `workareaIndex`
 * (2026-09-20, per-workarea agent mode) to get that ONE workarea's own wear
 * fraction instead — the state a per-workarea decision should actually see,
 * since "the plant's worst workarea is at 80%" tells workarea #3 nothing
 * useful about its OWN wear if it happens to be healthy.
 */
export function extractState(step: KpiStep, totalSteps: number, workareaIndex?: number): State;
export function extractState(steps: KpiStep[], totalSteps: number, workareaIndex?: number): State;
export function extractState(input: KpiStep | KpiStep[], totalSteps: number, workareaIndex?: number): State {
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
    const wear = workareaIndex !== undefined
      ? step.wearByWorkarea[workareaIndex] ?? 0
      : Math.max(...step.wearByWorkarea);
    state.maxWearFraction = wear / WEAR_THRESHOLD;
  }

  return state;
}
