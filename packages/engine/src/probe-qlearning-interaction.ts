/**
 * Focused unit-style check for the 2026-09-20 shared-parameters redesign:
 * does the maintainNow×wear interaction term in stateActionToVector actually
 * let a SHARED linear model represent "maintaining is good when wear is
 * high, bad when wear is low" — the one thing a plain sum of state and
 * action features structurally cannot do (see featurize.ts's own comment)?
 *
 * Synthetic, not the real simulator: feeds hand-built (state, action,
 * reward, nextState) transitions where the reward function is DESIGNED so
 * the correct action flips with wear —
 *   low wear:  no_maint reward=+1, maint_now reward=-1  (maintaining wastes a shift)
 *   high wear: no_maint reward=-1, maint_now reward=+1  (skipping risks failure)
 * — decoupled from the real reward/environment noise, so a pass/fail here is
 * about the FEATURE DESIGN and update math, not simulator behavior.
 *
 * Run: npx tsx packages/engine/src/probe-qlearning-interaction.ts
 */
import { QLearningAgent } from "./agents/qlearning.js";
import { ACTIONS } from "./actions.js";
import { stateActionToVector } from "./featurize.js";
import type { State } from "./types.js";

const baseState = {
  ambTemperature: 20, rawMaterialQuality: 0.5, stepNorm: 0.5, shiftPhaseNorm: 0.5, numberAccidents: 0,
};
const lowWearState: State = { ...baseState, maxWearFraction: 0.1 };
const highWearState: State = { ...baseState, maxWearFraction: 0.9 };

// Only actions at the SAME rate tier (medium) differ by maintainNow, so any
// Q-gap between them isolates the maintenance decision from the rate decision.
const medNoMaint = ACTIONS.find(a => a.setpointRate === 0.50 && !a.maintainNow)!;
const medMaintNow = ACTIONS.find(a => a.setpointRate === 0.50 && a.maintainNow)!;

function rewardFor(state: State, action: typeof medNoMaint): number {
  const highWear = (state.maxWearFraction ?? 0) > 0.5;
  if (highWear) return action.maintainNow ? 1 : -1;
  return action.maintainNow ? -1 : 1;
}

async function main() {
  const agent = new QLearningAgent(0.2, 0.0 /* gamma=0: pure contextual bandit, no bootstrap noise */, 0.3, 1.0, 0.3, 7, true);

  const N = 4000;
  for (let i = 0; i < N; i++) {
    const state = i % 2 === 0 ? lowWearState : highWearState;
    const action = agent.selectAction(state);
    const chosen = ACTIONS[action];
    // Only meaningful for the two medium-rate actions being tested; other
    // actions get a neutral 0 reward so they don't distort the comparison.
    const reward = (chosen.id === medNoMaint.id || chosen.id === medMaintNow.id)
      ? rewardFor(state, chosen as typeof medNoMaint)
      : 0;
    agent.update(action, reward, state, state, true); // done=true: no bootstrap, isolates the update itself
  }

  const theta = (agent as unknown as { theta: number[] }).theta;
  console.log("theta:", theta.map(v => v.toFixed(3)));

  function q(state: State, action: typeof medNoMaint): number {
    const x = stateActionToVector(state, action);
    let s = 0;
    for (let i = 0; i < Math.min(theta.length, x.length); i++) s += theta[i] * x[i];
    return s;
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
    console.log(`\nVERDICT: PASS — the shared model's maintenance preference genuinely FLIPS with wear.`);
    console.log(`The interaction terms are load-bearing, not decorative.`);
  } else {
    console.log(`\nVERDICT: FAIL — the shared model did not learn a wear-dependent maintenance preference.`);
    console.log(`Either the interaction terms, the feature scale, or the update itself needs revisiting.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Probe failed:", err);
  process.exit(1);
});
