import type { Agent } from "./types.js";
import type { State } from "../types.js";
import { ACTIONS } from "../actions.js";
import { createRng, argmaxTieBreak } from "../utils.js";

/**
 * Multi-Armed Bandit with ε-greedy exploration.
 */
export class MABAgent implements Agent {
  private counts: number[];
  private values: number[];
  private epsilon: number;
  private readonly epsilonDecay: number;
  private readonly epsilonMin: number;
  /**
   * Update rule selector.
   * - false (default): sample-average, effective α = 1/n — stationary-optimal.
   * - true: constant-α as written in the thesis ("Q[a] += α(r−Q[a])") — tracks drift.
   * Set via hyperparams.useConstantAlpha=1 in the experiment config; default OFF.
   */
  private readonly useConstantAlpha: boolean;
  private readonly alpha: number;
  /**
   * Seeded exploration RNG (Known-Bugs-Fixed #12). Deterministic when `seed`
   * is provided (typically `config.simSeed`), falls back to `Math.random`
   * otherwise — so unseeded callers keep the prior (unreproducible) behavior.
   */
  private readonly rng: () => number;

  constructor(
    epsilon = 1.0,
    epsilonDecay = 0.91,
    epsilonMin = 0.01,
    useConstantAlpha = false,
    alpha = 0.1,
    seed?: number,
  ) {
    this.epsilon = epsilon;
    this.epsilonDecay = epsilonDecay;
    this.epsilonMin = epsilonMin;
    this.useConstantAlpha = useConstantAlpha;
    this.alpha = alpha;
    this.rng = createRng(seed);
    this.counts = new Array(ACTIONS.length).fill(0);
    this.values = new Array(ACTIONS.length).fill(0);
    console.log(`[MABAgent] updateRule=${useConstantAlpha ? `constant-α(${alpha})` : "sample-average(1/n)"} seed=${seed ?? "unseeded"}`);
  }

  selectAction(_state: State): number {
    if (this.rng() < this.epsilon) {
      return Math.floor(this.rng() * ACTIONS.length);
    }
    // Known-Bugs-Fixed #17 (fixed 2026-09-12): random tie-break instead of
    // always favoring the lowest action id among tied Q-values.
    return argmaxTieBreak(this.values, this.rng);
  }

  update(action: number, reward: number, _prevState: State, _nextState: State, _done = false): void {
    this.counts[action]++;
    if (this.useConstantAlpha) {
      // Constant-α: matches thesis text "Q[a] += α(r−Q[a])"; tracks non-stationary drift.
      this.values[action] += this.alpha * (reward - this.values[action]);
    } else {
      // Sample-average (default): effective α = 1/n; optimal for stationary arms.
      this.values[action] += (reward - this.values[action]) / this.counts[action];
    }
    // NOTE: epsilon decay moved to decayEpsilon() — call once per episode
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
