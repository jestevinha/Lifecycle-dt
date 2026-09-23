/**
 * LinUCB counterpart to probe-qlearning-interaction.ts: does the
 * maintainNow×wear interaction term let LinUCB's SHARED ridge-regression fit
 * represent "maintaining is good when wear is high, bad when wear is low" —
 * the same capability check as Q-Learning's, since both agents now read the
 * same joint features (stateActionToVector).
 *
 * Feeds `update()` directly with hand-built (state, action, reward)
 * transitions (bypassing selectAction/round-robin, which isn't what's under
 * test here) where the reward is designed so the correct action flips with
 * wear, then checks whether the fitted θ=A⁻¹b actually flips its preference.
 *
 * Run: npx tsx packages/engine/src/probe-linucb-interaction.ts
 */
import { LinUCBAgent } from "./agents/linucb.js";
import { ACTIONS } from "./actions.js";
import { stateActionToVector } from "./featurize.js";
import type { State } from "./types.js";

const baseState = {
  ambTemperature: 20, rawMaterialQuality: 0.5, stepNorm: 0.5, shiftPhaseNorm: 0.5, numberAccidents: 0,
};
const lowWearState: State = { ...baseState, maxWearFraction: 0.1 };
const highWearState: State = { ...baseState, maxWearFraction: 0.9 };

const medNoMaint = ACTIONS.find(a => a.setpointRate === 0.50 && !a.maintainNow)!;
const medMaintNow = ACTIONS.find(a => a.setpointRate === 0.50 && a.maintainNow)!;

function rewardFor(state: State, action: typeof medNoMaint): number {
  const highWear = (state.maxWearFraction ?? 0) > 0.5;
  if (highWear) return action.maintainNow ? 1 : -1;
  return action.maintainNow ? -1 : 1;
}

async function main() {
  const agent = new LinUCBAgent(2.5);

  const N = 2000;
  for (let i = 0; i < N; i++) {
    const state = i % 2 === 0 ? lowWearState : highWearState;
    const action = i % 4 < 2 ? medNoMaint : medMaintNow; // alternate, don't rely on selectAction
    const reward = rewardFor(state, action);
    agent.update(action.id, reward, state, state);
  }

  const A = (agent as unknown as { A: number[][] }).A;
  const b = (agent as unknown as { b: number[] }).b;
  console.log("A dim:", A.length, "b:", b.map(v => v.toFixed(2)));

  // Reproduce theta = A⁻¹b the same way selectAction does (private
  // invertMatrix isn't exported, so re-derive via Gauss-Jordan here).
  function invert(M: number[][]): number[][] {
    const n = M.length;
    const aug = M.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
    for (let col = 0; col < n; col++) {
      let maxRow = col;
      for (let row = col + 1; row < n; row++) if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
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
  function dot(a: number[], b2: number[]): number {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b2[i];
    return s;
  }

  const Ainv = invert(A);
  const theta = A[0].map((_, i) => dot(Ainv[i], b));
  console.log("theta:", theta.map(v => v.toFixed(3)));

  function q(state: State, action: typeof medNoMaint): number {
    const x = stateActionToVector(state, action);
    return dot(theta, x);
  }

  const qLowNoMaint   = q(lowWearState, medNoMaint);
  const qLowMaintNow  = q(lowWearState, medMaintNow);
  const qHighNoMaint  = q(highWearState, medNoMaint);
  const qHighMaintNow = q(highWearState, medMaintNow);

  console.log(`\nQ(lowWear,  no_maint)  = ${qLowNoMaint.toFixed(3)}`);
  console.log(`Q(lowWear,  maint_now) = ${qLowMaintNow.toFixed(3)}`);
  console.log(`Q(highWear, no_maint)  = ${qHighNoMaint.toFixed(3)}`);
  console.log(`Q(highWear, maint_now) = ${qHighMaintNow.toFixed(3)}`);

  const lowWearPrefersNoMaint = qLowNoMaint > qLowMaintNow;
  const highWearPrefersMaint = qHighMaintNow > qHighNoMaint;

  console.log(`\nlow wear prefers no_maint:   ${lowWearPrefersNoMaint ? "PASS" : "FAIL"} (gap ${(qLowNoMaint - qLowMaintNow).toFixed(3)})`);
  console.log(`high wear prefers maint_now: ${highWearPrefersMaint ? "PASS" : "FAIL"} (gap ${(qHighMaintNow - qHighNoMaint).toFixed(3)})`);

  if (lowWearPrefersNoMaint && highWearPrefersMaint) {
    console.log(`\nVERDICT: PASS — LinUCB's shared fit's maintenance preference genuinely FLIPS with wear.`);
  } else {
    console.log(`\nVERDICT: FAIL.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Probe failed:", err);
  process.exit(1);
});
