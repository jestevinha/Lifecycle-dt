import type { Agent } from "./types.js";
import type { State } from "../types.js";
import { ACTIONS } from "../actions.js";
import { createRng, argmaxTieBreak } from "../utils.js";
import { stateActionToVector } from "../featurize.js";

/**
 * Q-Learning with linear function approximation (semi-gradient TD),
 * SHARED across actions (2026-09-20 — parameter sharing, see Known-Bugs-Fixed
 * / the vault note this motivated).
 *
 * Q(s,a) is now `theta · x(s,a)`, ONE shared weight vector over a joint
 * state-action feature vector (`stateActionToVector`, featurize.ts) — not one
 * row per action id (that was the previous design, 2026-09-19). The previous
 * per-action design couldn't generalize across actions at all (each of the
 * 10 rate×maintenance combinations was learned from scratch, independently,
 * exactly like a non-contextual bandit would per arm), which made widening
 * the action grid for finer control directly costly in sample count. Folding
 * the action's own parameters (rate, maintainNow) into the feature vector
 * lets one shared fit cover the whole grid, including rates rarely sampled
 * directly — the actual point of function approximation. See
 * `stateActionToVector`'s own comment for why the maintainNow×wear
 * interaction terms are load-bearing, not optional: a plain concatenation of
 * state and action features can only represent their SUM, which cannot
 * express "maintaining matters more when wear is high."
 *
 * LinUCB fits the same joint features as a single-shot linear bandit (no
 * bootstrap); this agent still does genuine γ-discounted TD bootstrapping
 * (`target = r + γ·max_a' theta·x(s',a')`) — Q-Learning's defining trait,
 * preserved across this redesign same as the previous one.
 */
export class QLearningAgent implements Agent {
  /** theta = ONE shared weight vector over joint (state, action) features. */
  private readonly theta: number[];
  private d: number;
  /** Global update count, used only when `useConstantAlpha` is false. */
  private updateCount = 0;
  private epsilon: number;
  private readonly epsilonDecay: number;
  private readonly epsilonMin: number;
  private readonly alpha: number;
  private readonly gamma: number;
  /**
   * Update rule selector, mirroring MABAgent's useConstantAlpha convention.
   * - false (default): decaying α_t = α_0 / (1 + updateCount) — now a single
   *   global counter (there is only one shared model left to decay), unlike
   *   the pre-sharing per-action counter this replaces.
   * - true: constant-α, every update nudges theta by up to α_0 regardless of
   *   how many updates have happened; kept for comparison.
   */
  private readonly useConstantAlpha: boolean;
  /** Joint feature vector x(s,a) for the action selectAction actually chose. */
  private lastFeatures: number[] | null = null;
  /**
   * Seeded exploration RNG (Known-Bugs-Fixed #12). Deterministic when `seed`
   * is provided (typically `config.simSeed`), falls back to `Math.random`
   * otherwise — so unseeded callers keep the prior (unreproducible) behavior.
   */
  private readonly rng: () => number;

  // alpha default lowered again 0.02→0.002 (2026-09-21, exp 71, per-workarea
  // mode) — see packages/dashboard/src/App.tsx AGENT_DEFAULTS.qlearning for
  // the full rationale (16 updates/shift into the same shared model in
  // per-workarea mode, ~16× the perturbation rate α=0.02 was tuned against).
  constructor(
    alpha = 0.002,
    gamma = 0.95,
    epsilon = 1.0,
    epsilonDecay = 0.99,
    epsilonMin = 0.01,
    seed?: number,
    useConstantAlpha = false,
  ) {
    this.alpha = alpha;
    this.gamma = gamma;
    this.epsilon = epsilon;
    this.epsilonDecay = epsilonDecay;
    this.epsilonMin = epsilonMin;
    this.useConstantAlpha = useConstantAlpha;
    this.rng = createRng(seed);
    // 10 (5 state + 3 action + 2 interaction) grows to 11 once maxWearFraction
    // appears (interactive mode) — see ensureDim.
    this.d = 10;
    this.theta = new Array(this.d).fill(0);
    console.log(`[QLearningAgent] shared-params linear-approx updateRule=${useConstantAlpha ? `constant-α(${alpha})` : `decaying-α(${alpha}/(1+n))`} seed=${seed ?? "unseeded"}`);
  }

  selectAction(state: State): number {
    const featuresByAction = ACTIONS.map(a => stateActionToVector(state, a));
    for (const x of featuresByAction) this.ensureDim(x.length);

    if (this.rng() < this.epsilon) {
      const action = Math.floor(this.rng() * ACTIONS.length);
      this.lastFeatures = featuresByAction[action];
      return action;
    }

    const qValues = featuresByAction.map(x => dot(this.theta, x));
    const action = argmaxTieBreak(qValues, this.rng);
    this.lastFeatures = featuresByAction[action];
    return action;
  }

  // `action` is unused now: `lastFeatures` already encodes which action was
  // chosen (its joint state-action vector), since there's no per-action
  // `theta[action]` row left to index into. Kept in the signature for
  // `Agent` interface compliance and parity with the other two agents.
  update(_action: number, reward: number, _prevState: State, nextState: State, done = false): void {
    if (!this.lastFeatures) return;
    const x = this.lastFeatures;

    // Canonical Q-Learning TD target with the γ·max_a Q[s′,a] bootstrap, Q
    // now read off the shared linear model instead of a per-action one.
    // `lastFeatures` is x(s,a) for the action selectAction chose — _prevState
    // documents intent but is not re-read, matching the prior convention.
    const nextFeaturesByAction = ACTIONS.map(a => stateActionToVector(nextState, a));
    for (const xNext of nextFeaturesByAction) this.ensureDim(xNext.length);
    const futureValue = done ? 0 : Math.max(...nextFeaturesByAction.map(xNext => dot(this.theta, xNext)));
    const target = reward + this.gamma * futureValue;

    const tdError = target - dot(this.theta, x);
    const alpha = this.useConstantAlpha ? this.alpha : this.nextAlpha();
    for (let i = 0; i < x.length; i++) {
      this.theta[i] += alpha * tdError * x[i];
    }
    // NOTE: epsilon decay moved to decayEpsilon() — call once per episode
  }

  /** Decaying α_t = α_0 / (1 + updateCount); increments the count as a side effect. */
  private nextAlpha(): number {
    const alpha = this.alpha / (1 + this.updateCount);
    this.updateCount++;
    return alpha;
  }

  /**
   * Grow theta (and, if pending, lastFeatures) if the joint feature vector
   * gained a dimension (10 → 11, once `maxWearFraction` first appears in
   * interactive mode) — the shared-model equivalent of the per-row padding
   * this replaced. Keeping `lastFeatures` in sync with `theta`'s length here
   * is what prevents the NaN cascade documented in Known-Bugs-Fixed #21
   * (`dot()` reading `undefined` off a stale shorter array, then `Math.max`
   * broadcasting that single NaN into every future TD target) — same failure
   * mode, now guarded the same way for a flat vector instead of per-row.
   */
  private ensureDim(newD: number): void {
    if (newD <= this.d) return;
    for (let i = this.d; i < newD; i++) this.theta.push(0);
    if (this.lastFeatures) {
      for (let i = this.d; i < newD; i++) this.lastFeatures.push(0);
    }
    this.d = newD;
  }

  /** Decay epsilon once per episode (not per update). */
  decayEpsilon(): void {
    this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay);
  }

  getEpsilon(): number {
    return this.epsilon;
  }

  getEpsilonDecay(): number {
    return this.epsilonDecay;
  }
}

/**
 * Iterates `min(a.length, b.length)`, not `a.length` — a length mismatch
 * (e.g. theta grown by `ensureDim` one call before a stale `x` is) must never
 * read `undefined` off the shorter array: `0 * undefined` is `NaN`, and
 * `Math.max` in `futureValue` propagates a single such NaN to poison every
 * future TD target. `ensureDim` keeps `lastFeatures` in sync too, so this is
 * belt-and-suspenders (see Known-Bugs-Fixed #21).
 */
function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
