import type { Agent } from "./types.js";
import type { State } from "../types.js";
import { ACTIONS } from "../actions.js";

/**
 * LinUCB Contextual Bandit.
 * Uses a linear model per action with upper confidence bound exploration.
 * Automatically adapts to 5-dim or 6-dim state vectors.
 */
export class LinUCBAgent implements Agent {
  private readonly alpha: number;
  private d: number;
  private A: number[][][];
  private b: number[][];
  private episodeCount = 0;

  constructor(alpha = 2.5) {
    this.alpha = alpha;
    this.d = 5;
    const k = ACTIONS.length;
    this.A = [];
    this.b = [];
    for (let a = 0; a < k; a++) {
      this.A.push(identity(this.d));
      this.b.push(new Array(this.d).fill(0));
    }
  }

  selectAction(state: State): number {
    // Round-robin: force each action once during the first K episodes
    if (this.episodeCount < ACTIONS.length) {
      return this.episodeCount;
    }

    const x = stateToVector(state);
    this.ensureDim(x.length);

    let bestAction = 0;
    let bestUCB = -Infinity;
    const diag: { a: number; name: string; exploit: number; explore: number; ucb: number }[] = [];

    for (let a = 0; a < ACTIONS.length; a++) {
      const Ainv = invertMatrix(this.A[a]);
      const theta = matVecMul(Ainv, this.b[a]);
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
    const x = stateToVector(prevState);  // decision-time context: x at the moment action was chosen
    this.ensureDim(x.length);

    // A_a = A_a + x * x^T
    for (let i = 0; i < this.d; i++) {
      for (let j = 0; j < this.d; j++) {
        this.A[action][i][j] += x[i] * x[j];
      }
    }
    // b_a = b_a + r * x
    for (let i = 0; i < this.d; i++) {
      this.b[action][i] += reward * x[i];
    }
  }

  /** Grow A and b matrices if state vector gained a dimension (5 → 6) */
  private ensureDim(newD: number): void {
    if (newD <= this.d) return;
    for (let a = 0; a < ACTIONS.length; a++) {
      // Expand each row, then add new rows
      for (let i = 0; i < this.d; i++) {
        for (let j = this.d; j < newD; j++) {
          this.A[a][i].push(0);
        }
      }
      for (let i = this.d; i < newD; i++) {
        const row = new Array(newD).fill(0);
        row[i] = 1; // identity diagonal
        this.A[a].push(row);
      }
      // Expand b vector
      for (let i = this.d; i < newD; i++) {
        this.b[a].push(0);
      }
    }
    this.d = newD;
  }
}

// Fixed normalization ranges (anchored to Java constants in Const.java):
//   ambTemperature:    [10, 30]  ← Const.TEMP_MIN / TEMP_MAX
//   rawMaterialQuality:[0,  1]   ← Const.RAW_MAT_MIN_SPEC / RAW_MAT_MAX_SPEC
//   stepNorm:          [0,  1]   ← already normalised by extractState
//   shiftPhaseNorm:    [0,  1]   ← already in {0, 0.5, 1.0} ⊂ [0,1]
//   numberAccidents:   [0, 10]   ← soft cap; episode max at very_high rate ≈ 6–48 cumulative
//   maxWearFraction:   [0,  1]   ← already normalised by extractState (÷ WEAR_THRESHOLD)
//
// All constants are FIXED (not adaptive) — adaptive normalisation would break
// the stationarity assumption of the linear bandit and reintroduce context drift.
const TEMP_NORM_MIN = 10;
const TEMP_NORM_MAX = 30;
const ACC_NORM_MAX  = 10;  // cumulative accident cap; clipped, not wrapped

function stateToVector(s: State): number[] {
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
