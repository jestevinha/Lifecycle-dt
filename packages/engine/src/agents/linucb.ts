import type { Agent } from "./types.js";
import type { State } from "../types.js";
import { ACTIONS } from "../actions.js";
import { stateActionToVector } from "../featurize.js";

/**
 * LinUCB Contextual Bandit, SHARED across actions (2026-09-20 — parameter
 * sharing, see Known-Bugs-Fixed / the vault note this motivated).
 *
 * `A`/`b` are now ONE shared ridge-regression fit over a joint state-action
 * feature vector (`stateActionToVector`, featurize.ts), not one independent
 * `(A[a], b[a])` per action id (that was the previous design, 2026-09-19).
 * The previous per-action design was actually the *disjoint* special case of
 * LinUCB — the original algorithm (Li et al. 2010) already supports a
 * "hybrid" shared component alongside per-arm features for exactly this
 * reason; this collapses fully to the shared/hybrid form since every
 * discrete action here is really a point in a small continuous (rate,
 * maintainNow) space, not an unrelated arm like a news article. One shared
 * fit means the confidence bound and the point estimate both benefit from
 * every episode's data regardless of which action was taken, instead of only
 * updating the one row for the action actually chosen.
 */
export class LinUCBAgent implements Agent {
  private readonly alpha: number;
  private d: number;
  private A: number[][];
  private b: number[];
  private episodeCount = 0;

  // alpha=5.0 tested 2026-09-20 against the PREVIOUS per-action design,
  // reverted — exp 63 showed it made the medium_maint_now lock-in MORE
  // consistent, not less. Worth re-testing once this shared design has a
  // baseline run of its own; the mechanism that made alpha ineffective
  // (round-robin already giving a confident, not just uncertain, estimate)
  // may or may not still apply once uncertainty is shared across actions
  // too. See Known-Bugs-Fixed / Reward-Function-Evolution.md in the vault.
  constructor(alpha = 2.5) {
    this.alpha = alpha;
    // 10 (5 state + 3 action + 2 interaction) grows to 11 once
    // maxWearFraction appears (interactive mode) — see ensureDim.
    this.d = 10;
    this.A = identity(this.d);
    this.b = new Array(this.d).fill(0);
  }

  selectAction(state: State): number {
    // Round-robin: force each action once during the first K episodes.
    // Kept unchanged from the disjoint design for now — with a shared fit,
    // every round-robin episode's data already informs every action's
    // estimate via A/b, so this may be more coverage than strictly needed,
    // but it's a safe, well-understood starting point (see the rollout plan
    // in Reward-Function-Evolution.md / the vault note for this redesign).
    if (this.episodeCount < ACTIONS.length) {
      return this.episodeCount;
    }

    const featuresByAction = ACTIONS.map(a => stateActionToVector(state, a));
    for (const x of featuresByAction) this.ensureDim(x.length);

    // theta = A⁻¹b computed ONCE per decision now (shared), not once per
    // action — cheaper than the disjoint design, not just structurally
    // different.
    const Ainv = invertMatrix(this.A);
    const theta = matVecMul(Ainv, this.b);

    let bestAction = 0;
    let bestUCB = -Infinity;
    const diag: { a: number; name: string; exploit: number; explore: number; ucb: number }[] = [];

    for (let a = 0; a < ACTIONS.length; a++) {
      const x = featuresByAction[a];
      const exploit = dotProduct(theta, x);
      const explore = this.alpha * Math.sqrt(dotProduct(x, matVecMul(Ainv, x)));
      const ucb = exploit + explore;
      diag.push({ a, name: ACTIONS[a].name, exploit, explore, ucb });
      if (ucb > bestUCB) {
        bestUCB = ucb;
        bestAction = a;
      }
    }
    // Log at first post-RR episode and every 25th to track convergence
    if (this.episodeCount === ACTIONS.length || this.episodeCount % 25 === 0) {
      const top3 = [...diag].sort((a, b) => b.ucb - a.ucb).slice(0, 3)
        .map(d => `${d.name}(${d.exploit.toFixed(1)}+${d.explore.toFixed(1)})`).join(" ");
      console.log(`[LinUCB] ep=${this.episodeCount} top3: ${top3}`);
    }
    return bestAction;
  }

  /** Call once per episode to advance the round-robin counter. */
  advanceEpisode(): void {
    this.episodeCount++;
  }

  update(action: number, reward: number, prevState: State, _nextState: State): void {
    // decision-time context: x at the moment action was chosen
    const x = stateActionToVector(prevState, ACTIONS[action]);
    this.ensureDim(x.length);

    // A = A + x·xᵀ  (shared — every action's update informs the same fit)
    for (let i = 0; i < this.d; i++) {
      for (let j = 0; j < this.d; j++) {
        this.A[i][j] += x[i] * x[j];
      }
    }
    // b = b + r·x
    for (let i = 0; i < this.d; i++) {
      this.b[i] += reward * x[i];
    }
  }

  /**
   * Grow A/b if the joint feature vector gained a dimension (10 → 11, once
   * maxWearFraction first appears) — the shared-model equivalent of the
   * previous per-action padding.
   */
  private ensureDim(newD: number): void {
    if (newD <= this.d) return;
    for (let i = 0; i < this.d; i++) {
      for (let j = this.d; j < newD; j++) {
        this.A[i].push(0);
      }
    }
    for (let i = this.d; i < newD; i++) {
      const row = new Array(newD).fill(0);
      row[i] = 1; // identity diagonal
      this.A.push(row);
    }
    for (let i = this.d; i < newD; i++) {
      this.b.push(0);
    }
    this.d = newD;
  }
}

// stateActionToVector moved to ../featurize.js (2026-09-19, extended
// 2026-09-20 for shared parameters) — shared with Q-Learning's linear
// function approximation so both agents see the same joint features.

function identity(n: number): number[][] {
  const m: number[][] = [];
  for (let i = 0; i < n; i++) {
    m.push(new Array(n).fill(0));
    m[i][i] = 1;
  }
  return m;
}

function dotProduct(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function matVecMul(M: number[][], v: number[]): number[] {
  return M.map(row => dotProduct(row, v));
}

/** Simple matrix inversion via Gauss-Jordan (for small d) */
function invertMatrix(M: number[][]): number[][] {
  const n = M.length;
  const aug: number[][] = M.map((row, i) => {
    const r = [...row];
    for (let j = 0; j < n; j++) r.push(i === j ? 1 : 0);
    return r;
  });
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-12) continue;
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivot;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = 0; j < 2 * n; j++) aug[row][j] -= factor * aug[col][j];
    }
  }
  return aug.map(row => row.slice(n));
}
