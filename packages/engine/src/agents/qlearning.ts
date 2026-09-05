import type { Agent } from "./types.js";
import type { State } from "../types.js";
import { ACTIONS } from "../actions.js";
import { createRng } from "../utils.js";

/**
 * Tabular Q-Learning agent.
 * Discretizes the continuous state space into bins.
 */
export class QLearningAgent implements Agent {
  private qTable: Map<string, number[]>;
  private epsilon: number;
  private readonly epsilonDecay: number;
  private readonly epsilonMin: number;
  private readonly alpha: number;
  private readonly gamma: number;
  private lastStateKey: string | null = null;
  /**
   * Seeded exploration RNG (Known-Bugs-Fixed #12). Deterministic when `seed`
   * is provided (typically `config.simSeed`), falls back to `Math.random`
   * otherwise — so unseeded callers keep the prior (unreproducible) behavior.
   */
  private readonly rng: () => number;

  constructor(
    alpha = 0.1,
    gamma = 0.95,
    epsilon = 1.0,
    epsilonDecay = 0.99,
    epsilonMin = 0.01,
    seed?: number,
  ) {
    this.alpha = alpha;
    this.gamma = gamma;
    this.epsilon = epsilon;
    this.epsilonDecay = epsilonDecay;
    this.epsilonMin = epsilonMin;
    this.rng = createRng(seed);
    this.qTable = new Map();
  }

  selectAction(state: State): number {
    const key = this.discretize(state);
    this.lastStateKey = key;

    if (this.rng() < this.epsilon) {
      return Math.floor(this.rng() * ACTIONS.length);
    }

    const qValues = this.getQ(key);
    return qValues.indexOf(Math.max(...qValues));
  }

  update(action: number, reward: number, _prevState: State, nextState: State, done = false): void {
    if (!this.lastStateKey) return;

    // Canonical Q-Learning TD update with the γ·max_a Q[s′,a] bootstrap.
    // `lastStateKey` is s (set by the selectAction that chose `action`) — _prevState
    // documents intent but is not re-read; lastStateKey is the authoritative s key.
    // `nextState` is s′ observed at the shift boundary. On the terminal shift
    // there is no successor, so the bootstrap term is dropped (reward only).
    const q = this.getQ(this.lastStateKey);
    const futureValue = done ? 0 : this.peekMaxQ(this.discretize(nextState));
    const target = reward + this.gamma * futureValue;
    q[action] += this.alpha * (target - q[action]);
    this.qTable.set(this.lastStateKey, q);
    // NOTE: epsilon decay moved to decayEpsilon() — call once per episode
  }

  /** Max Q-value of a state, treating an unseen state as 0 WITHOUT creating an
   *  entry (so the bootstrap doesn't inflate the reported Q-table size). */
  private peekMaxQ(key: string): number {
    const q = this.qTable.get(key);
    return q ? Math.max(...q) : 0;
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

  get qTableSize(): number {
    return this.qTable.size;
  }

  getStateSize(): number {
    return this.qTable.size;
  }

  private getQ(key: string): number[] {
    if (!this.qTable.has(key)) {
      this.qTable.set(key, new Array(ACTIONS.length).fill(0));
    }
    return this.qTable.get(key)!;
  }

  private discretize(s: State): string {
    const bins = [
      s.ambTemperature < 15 ? 0 : s.ambTemperature <= 25 ? 1 : 2,
      s.rawMaterialQuality < 0.4 ? 0 : s.rawMaterialQuality <= 0.7 ? 1 : 2,
      s.stepNorm < 0.33 ? 0 : s.stepNorm <= 0.66 ? 1 : 2,
      // shiftPhaseNorm is exactly {0, 0.5, 1.0} → bins {0, 1, 2}
      s.shiftPhaseNorm < 0.33 ? 0 : s.shiftPhaseNorm <= 0.66 ? 1 : 2,
      s.numberAccidents === 0 ? 0 : s.numberAccidents <= 2 ? 1 : 2,
    ];
    if (s.maxWearFraction !== undefined) {
      // Six bins, concentrated in the decision-relevant 0.5–0.95 region so the
      // agent can distinguish "maintain now" from "wait another shift".
      const w = s.maxWearFraction;
      let bin: number;
      if      (w < 0.30) bin = 0;
      else if (w < 0.50) bin = 1;
      else if (w < 0.70) bin = 2;
      else if (w < 0.85) bin = 3;
      else if (w < 0.95) bin = 4;
      else               bin = 5;
      bins.push(bin);
    }
    return bins.join(",");
  }
}
