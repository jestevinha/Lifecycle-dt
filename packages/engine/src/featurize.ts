import type { Action, State } from "./types.js";

// Fixed normalization ranges (anchored to Java constants in Const.java):
//   ambTemperature:    [10, 30]  ← Const.TEMP_MIN / TEMP_MAX
//   rawMaterialQuality:[0,  1]   ← Const.RAW_MAT_MIN_SPEC / RAW_MAT_MAX_SPEC
//   stepNorm:          [0,  1]   ← already normalised by extractState
//   shiftPhaseNorm:    [0,  1]   ← already in {0, 0.5, 1.0} ⊂ [0,1]
//   numberAccidents:   [0, 10]   ← soft cap; SHIFT-SCOPED count (accidents during the
//                                  shift just completed), not episode-cumulative — see
//                                  Known-Bugs-Fixed #15 (fixed 2026-09-11).
//   maxWearFraction:   [0,  1]   ← already normalised by extractState (÷ WEAR_THRESHOLD)
//
// All constants are FIXED (not adaptive) — adaptive normalisation would break the
// stationarity assumption of any linear model built on this feature vector (LinUCB,
// and Q-Learning's linear function approximation as of 2026-09-19) and reintroduce
// context drift.
const TEMP_NORM_MIN = 10;
const TEMP_NORM_MAX = 30;
const ACC_NORM_MAX  = 10;  // shift-scoped accident cap; clipped, not wrapped

/**
 * Continuous feature vector shared by LinUCB and Q-Learning's linear function
 * approximation (see 04-Experiments/Qlearning-Linear-Approximation.md in the
 * vault), so the two agents differ only in how they use the same information —
 * single-shot linear-bandit fit vs. γ-bootstrapped TD — not in what they can see.
 */
export function stateToVector(s: State): number[] {
  const v = [
    (s.ambTemperature - TEMP_NORM_MIN) / (TEMP_NORM_MAX - TEMP_NORM_MIN),
    s.rawMaterialQuality,
    s.stepNorm,
    s.shiftPhaseNorm,
    Math.min(s.numberAccidents / ACC_NORM_MAX, 1),
  ];
  if (s.maxWearFraction !== undefined) {
    v.push(s.maxWearFraction);
  }
  return v;
}

// Rate above which the Java accident-safety curve actually turns on
// (Const.SFTY_RATE_MIN_RATE = 0.5 — below this the check's threshold is
// pinned at 1.0/unreachable, see Reward-Function-Evolution.md). `rateExcess`
// exposes that kink directly rather than making a shared linear model
// rediscover it implicitly, which a single linear term in raw rate cannot do.
const RATE_SAFETY_KNEE = 0.5;

/**
 * Action-only features for the joint state-action model (2026-09-20 —
 * parameter sharing across actions, see Known-Bugs-Fixed / the vault note
 * this motivated). `rate` and `maintainNow` alone let a shared linear model
 * learn a flat throughput/maintenance-cost trend across the whole action
 * grid instead of fitting each action from scratch — the actual point of
 * sharing. `rateExcess` gives it the accident-risk kink above 0.5 without
 * needing a full polynomial basis.
 */
export function actionToFeatures(a: Action): number[] {
  return [
    a.setpointRate,
    Math.max(0, a.setpointRate - RATE_SAFETY_KNEE),
    a.maintainNow ? 1 : 0,
  ];
}

/**
 * Joint (state, action) feature vector for a SHARED linear model — one set
 * of weights covering every action, instead of one independent model per
 * action id (LinUCB's old `A[a]/b[a]`, Q-Learning's old `theta[a]`). Plain
 * concatenation of state and action features would only let a linear model
 * represent their SUM, which cannot express "maintaining matters more when
 * wear is high" — exactly the behavior this action space exists to let an
 * agent learn. The `maintainNow × wear` cross terms make that interaction
 * directly representable instead of losing it to the additivity assumption;
 * the squared term mirrors the reward's own convex wear-penalty shape
 * (`WEAR_PENALTY_SCALE × maxWearFraction²` in reward.ts).
 *
 * Falls back to 0 for both interaction terms when `maxWearFraction` isn't in
 * the state yet (batch mode, or the very first pre-wear-data decision of an
 * interactive episode) — consistent with `stateToVector` itself omitting the
 * dimension entirely in that case.
 */
export function stateActionToVector(s: State, a: Action): number[] {
  const stateFeatures = stateToVector(s);
  const actionFeatures = actionToFeatures(a);
  const maintainNow = a.maintainNow ? 1 : 0;
  const wear = s.maxWearFraction ?? 0;
  const interaction = [maintainNow * wear, maintainNow * wear * wear];
  return [...stateFeatures, ...actionFeatures, ...interaction];
}
