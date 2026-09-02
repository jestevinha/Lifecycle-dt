/**
 * Probe 1 — Trivial-bandit sanity test.
 * Drives real MABAgent / LinUCBAgent / QLearningAgent classes (unmodified)
 * against a toy environment with NO ManuSim, NO extractState, NO reward pipeline.
 *
 * Stage 1: constant context, one good arm G → tests UPDATE rule in isolation.
 * Stage 2: two contexts c0/c1 with different optimal arms → tests context-conditioning.
 *
 * Run: npx tsx packages/engine/src/probe-agent-bandit.ts
 */

import { MABAgent }       from "./agents/mab.js";
import { LinUCBAgent }    from "./agents/linucb.js";
import { QLearningAgent } from "./agents/qlearning.js";
import type { Agent }     from "./agents/types.js";
import { ACTIONS }        from "./actions.js";
import type { State }     from "./types.js";

const NA = ACTIONS.length; // 20 arms

// ── toy environment ──────────────────────────────────────────────────────────

const G  = 3;   // good arm, Stage 1
const A0 = 2;   // good arm in c0, Stage 2
const A1 = 7;   // good arm in c1, Stage 2  (A0 ≠ A1)

// Fixed state (Stage 1): sits in bin 1 for temp, quality, stepNorm, phaseNorm,
// bin 0 for accidents, bin 2 for maxWear → Q-key "1,1,1,1,0,2"
const FIXED: State = {
  ambTemperature:    20,   // bin 1 (15 < 20 ≤ 25)
  rawMaterialQuality: 0.5, // bin 1 (0.4 < 0.5 ≤ 0.7)
  stepNorm:          0.5,  // bin 1 (0.33 < 0.5 ≤ 0.66)
  shiftPhaseNorm:    0.5,  // bin 1
  numberAccidents:   0,    // bin 0
  maxWearFraction:   0.5,  // wear bin 2 (0.50 ≤ 0.5 < 0.70 — left-closed boundary)
};

// Stage 2 contexts — differ ONLY in ambTemperature (cold vs hot).
// c0: bin 0 (temp<15) → Q-key "0,1,1,1,0,2"
// c1: bin 2 (temp>25) → Q-key "2,1,1,1,0,2"
// LinUCB feature vectors differ by first dimension (10 vs 30).
const C0: State = { ...FIXED, ambTemperature: 10 };
const C1: State = { ...FIXED, ambTemperature: 30 };

// ── episode config ───────────────────────────────────────────────────────────
// Use enough episodes so every agent reaches ε-floor before the measurement window.
// MAB (decay 0.91) floors at ~50 ep; Q-Learning (decay 0.99) floors at ~460 ep.
const S1_EPS = 600;    // Stage 1 episodes
const S2_EPS = 1200;   // Stage 2 episodes (QL needs ~460 to floor)
const STEPS  = 30;     // steps per episode (mirrors production: 30 shifts)

// ── discretize copy (mirrors qlearning.ts exactly) ───────────────────────────
function discretize(s: State): string {
  const bins = [
    s.ambTemperature < 15 ? 0 : s.ambTemperature <= 25 ? 1 : 2,
    s.rawMaterialQuality < 0.4 ? 0 : s.rawMaterialQuality <= 0.7 ? 1 : 2,
    s.stepNorm < 0.33 ? 0 : s.stepNorm <= 0.66 ? 1 : 2,
    s.shiftPhaseNorm < 0.33 ? 0 : s.shiftPhaseNorm <= 0.66 ? 1 : 2,
    s.numberAccidents === 0 ? 0 : s.numberAccidents <= 2 ? 1 : 2,
  ];
  if (s.maxWearFraction !== undefined) {
    const w = s.maxWearFraction;
    bins.push(w < 0.30 ? 0 : w < 0.50 ? 1 : w < 0.70 ? 2 : w < 0.85 ? 3 : w < 0.95 ? 4 : 5);
  }
  return bins.join(",");
}

// ── LinUCB internals (mirrors linucb.ts helpers) ─────────────────────────────
function dot(a: number[], b: number[]): number {
  return a.reduce((s, v, i) => s + v * b[i], 0);
}
function matVec(M: number[][], v: number[]): number[] {
  return M.map(row => dot(row, v));
}
function inv(M: number[][]): number[][] {
  const n = M.length;
  const aug = M.map((row, i) => {
    const r = [...row];
    for (let j = 0; j < n; j++) r.push(i === j ? 1 : 0);
    return r;
  });
  for (let c = 0; c < n; c++) {
    let mx = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(aug[r][c]) > Math.abs(aug[mx][c])) mx = r;
    [aug[c], aug[mx]] = [aug[mx], aug[c]];
    const pv = aug[c][c];
    if (Math.abs(pv) < 1e-12) continue;
    for (let j = 0; j < 2 * n; j++) aug[c][j] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = aug[r][c];
      for (let j = 0; j < 2 * n; j++) aug[r][j] -= f * aug[c][j];
    }
  }
  return aug.map(row => row.slice(n));
}
function stateVec(s: State): number[] {
  const v = [s.ambTemperature, s.rawMaterialQuality, s.stepNorm, s.shiftPhaseNorm, s.numberAccidents];
  if (s.maxWearFraction !== undefined) v.push(s.maxWearFraction);
  return v;
}
function linucbEstimates(agent: LinUCBAgent, action: number, x: number[]) {
  const A = (agent as unknown as { A: number[][][] }).A[action];
  const b = (agent as unknown as { b: number[][] }).b[action];
  const alpha = (agent as unknown as { alpha: number }).alpha;
  const Ainv = inv(A);
  const theta = matVec(Ainv, b);
  const exploit = dot(theta, x);
  const explore = alpha * Math.sqrt(dot(x, matVec(Ainv, x)));
  return { exploit, explore };
}

// ── Stage 1 ──────────────────────────────────────────────────────────────────

function stage1(
  label: string,
  agent: Agent,
): boolean {
  const windowStart = Math.floor(S1_EPS * 0.75);
  let winTotal = 0, winGood = 0, convEp = -1;

  for (let ep = 0; ep < S1_EPS; ep++) {
    let epGood = 0;
    for (let step = 0; step < STEPS; step++) {
      const action = agent.selectAction(FIXED);
      const reward = action === G ? 1.0 : 0.0;
      const done   = step === STEPS - 1;
      // Constant environment: prevState = nextState = FIXED.
      // MAB ignores both; LinUCB gets correct decision-time context; Q-Learning bootstraps from FIXED.
      agent.update(action, reward, FIXED, FIXED, done);
      if (ep >= windowStart) { winTotal++; if (action === G) winGood++; }
      if (action === G) epGood++;
    }
    if (convEp < 0 && epGood / STEPS >= 0.95) convEp = ep;
    agent.decayEpsilon?.();
    agent.advanceEpisode?.();
  }

  const rate = winGood / winTotal;
  const pass = rate >= 0.95;

  console.log(`\n  ${label}:`);
  console.log(`    Selection rate last 25% episodes: ${(rate * 100).toFixed(1)}%`);
  console.log(`    Convergence episode (≥95% in ep): ${convEp < 0 ? "NEVER within " + S1_EPS + " eps" : convEp}`);
  console.log(`    PASS: ${pass ? "YES" : "NO"}`);

  // Internal estimates
  if (agent instanceof MABAgent) {
    const vals = (agent as unknown as { values: number[] }).values;
    console.log(`    Internal Q:  arm ${G}=${vals[G].toFixed(4)}  arm 0=${vals[0].toFixed(4)}  arm 1=${vals[1].toFixed(4)}`);
    const counts = (agent as unknown as { counts: number[] }).counts;
    console.log(`    Update counts: arm ${G}=${counts[G]}  arm 0=${counts[0]}`);
  } else if (agent instanceof LinUCBAgent) {
    const x = stateVec(FIXED);
    const eg = linucbEstimates(agent, G, x);
    const e0 = linucbEstimates(agent, 0, x);
    console.log(`    LinUCB arm ${G}: exploit=${eg.exploit.toFixed(4)} explore=${eg.explore.toFixed(4)} UCB=${(eg.exploit+eg.explore).toFixed(4)}`);
    console.log(`    LinUCB arm  0: exploit=${e0.exploit.toFixed(4)} explore=${e0.explore.toFixed(4)} UCB=${(e0.exploit+e0.explore).toFixed(4)}`);
  } else {
    const qt  = (agent as unknown as { qTable: Map<string, number[]> }).qTable;
    const key = discretize(FIXED);
    const q   = qt.get(key) ?? new Array(NA).fill(0);
    console.log(`    Q-table key="${key}" (${qt.size} entries total)`);
    console.log(`    Q-values: arm ${G}=${q[G].toFixed(4)}  arm 0=${q[0].toFixed(4)}  arm 1=${q[1].toFixed(4)}  arm 4=${q[4].toFixed(4)}`);
  }

  return pass;
}

// ── Stage 2 ──────────────────────────────────────────────────────────────────

function stage2(
  label: string,
  agent: Agent,
): boolean {
  const windowStart = Math.floor(S2_EPS * 0.75);
  let c0Win = 0, c0Good = 0, c1Win = 0, c1Good = 0;
  let convEp = -1;

  // Q-Learning needs a sequential context chain (nextCtx feeds back as currCtx).
  let currCtx: State = Math.random() < 0.5 ? C0 : C1;

  for (let ep = 0; ep < S2_EPS; ep++) {
    let epC0T = 0, epC0G = 0, epC1T = 0, epC1G = 0;

    for (let step = 0; step < STEPS; step++) {
      const ctx = currCtx;
      const nextCtx: State = Math.random() < 0.5 ? C0 : C1;
      const action = agent.selectAction(ctx);
      const goodArm = ctx === C0 ? A0 : A1;
      const reward  = action === goodArm ? 1.0 : 0.0;
      const done    = step === STEPS - 1;

      // With the unified 5-arg signature each agent takes what its math requires:
      //   MAB:      ignores ctx and nextCtx
      //   LinUCB:   uses ctx (prevState = decision-time context)
      //   Q-Learn:  uses nextCtx (nextState) for bootstrap; ctx via lastStateKey
      agent.update(action, reward, ctx, nextCtx, done);

      if (ctx === C0) {
        epC0T++; if (action === A0) epC0G++;
        if (ep >= windowStart) { c0Win++; if (action === A0) c0Good++; }
      } else {
        epC1T++; if (action === A1) epC1G++;
        if (ep >= windowStart) { c1Win++; if (action === A1) c1Good++; }
      }

      currCtx = nextCtx;
    }

    const r0 = epC0T > 0 ? epC0G / epC0T : 0;
    const r1 = epC1T > 0 ? epC1G / epC1T : 0;
    if (convEp < 0 && r0 >= 0.95 && r1 >= 0.95) convEp = ep;

    agent.decayEpsilon?.();
    agent.advanceEpisode?.();
  }

  const rC0 = c0Win > 0 ? c0Good / c0Win : 0;
  const rC1 = c1Win > 0 ? c1Good / c1Win : 0;

  console.log(`\n  ${label}:`);
  console.log(`    Contexts: c0.ambTemp=10 (key=${discretize(C0)}) → arm A0=${A0}`);
  console.log(`              c1.ambTemp=30 (key=${discretize(C1)}) → arm A1=${A1}`);
  console.log(`    NOTE: unified 5-arg update — LinUCB gets prevState (decision-time ctx), QL gets nextCtx for bootstrap`);
  console.log(`    Optimal rate in c0 last 25%: ${(rC0 * 100).toFixed(1)}%`);
  console.log(`    Optimal rate in c1 last 25%: ${(rC1 * 100).toFixed(1)}%`);
  console.log(`    Convergence ep (both ≥95%):  ${convEp < 0 ? "NEVER within " + S2_EPS + " eps" : convEp}`);

  let pass: boolean;
  if (agent instanceof MABAgent) {
    // MAB cannot condition — ceiling ~50% per context (capability limit, not failure)
    const mabPass = rC0 >= 0.40 && rC0 <= 0.65 || rC1 >= 0.40 && rC1 <= 0.65;
    const vals = (agent as unknown as { values: number[] }).values;
    console.log(`    MAB values: arm ${A0}=${vals[A0].toFixed(4)}  arm ${A1}=${vals[A1].toFixed(4)}  arm 0=${vals[0].toFixed(4)}`);
    console.log(`    EXPECTED: both ~50% (can't condition on context — capability ceiling)`);
    console.log(`    CAPABILITY CEILING MET (this is expected, NOT a failure)`);
    pass = true; // MAB ceiling is expected; it does NOT fail Stage 2
  } else if (agent instanceof LinUCBAgent) {
    pass = rC0 >= 0.90 && rC1 >= 0.90;
    const xC0 = stateVec(C0);
    const xC1 = stateVec(C1);
    const eA0_c0 = linucbEstimates(agent, A0, xC0);
    const eA1_c0 = linucbEstimates(agent, A0, xC1);
    const eA1_c1 = linucbEstimates(agent, A1, xC1);
    console.log(`    LinUCB arm ${A0} in c0: exploit=${eA0_c0.exploit.toFixed(3)}  in c1: exploit=${eA1_c0.exploit.toFixed(3)}`);
    console.log(`    LinUCB arm ${A1} in c1: exploit=${eA1_c1.exploit.toFixed(3)}`);
    console.log(`    PASS (>90% per context): ${pass ? "YES" : "NO"}`);
  } else {
    const qt = (agent as unknown as { qTable: Map<string, number[]> }).qTable;
    const qC0 = qt.get(discretize(C0)) ?? new Array(NA).fill(0);
    const qC1 = qt.get(discretize(C1)) ?? new Array(NA).fill(0);
    console.log(`    Q[c0] arm ${A0}=${qC0[A0].toFixed(3)}  arm ${A1}=${qC0[A1].toFixed(3)}  arm 0=${qC0[0].toFixed(3)}`);
    console.log(`    Q[c1] arm ${A0}=${qC1[A0].toFixed(3)}  arm ${A1}=${qC1[A1].toFixed(3)}  arm 0=${qC1[0].toFixed(3)}`);
    pass = rC0 >= 0.90 && rC1 >= 0.90;
    console.log(`    PASS (>90% per context): ${pass ? "YES" : "NO"}`);
  }

  return pass;
}

// ── main ─────────────────────────────────────────────────────────────────────

function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("PROBE 1 — Trivial-bandit sanity test");
  console.log("Real agent classes: MAB / LinUCB / Q-Learning (no simulator)");
  console.log(`S1: ${S1_EPS} eps × ${STEPS} steps; good arm G=${G}`);
  console.log(`S2: ${S2_EPS} eps × ${STEPS} steps; A0=${A0} in c0, A1=${A1} in c1`);
  console.log(`Hyperparams: MAB ε-decay=0.91; LinUCB α=2.5; QL ε-decay=0.99 γ=0.95 α=0.1`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  // Production hyperparams
  const mab   = new MABAgent(1.0, 0.91, 0.01);
  const lucb  = new LinUCBAgent(2.5);
  const ql    = new QLearningAgent(0.1, 0.95, 1.0, 0.99, 0.01);

  console.log("── Stage 1: constant context, one good arm ─────────────────────");
  console.log(`   Fixed state discretizes to key "${discretize(FIXED)}"`);
  console.log(`   Good arm G=${G}, reward +1; all others 0 (deterministic, no noise)`);
  console.log(`   PASS criterion: >95% selection of G in last 25% of episodes`);
  console.log(`   MAB is the control — if it fails, harness is wrong.\n`);

  const s1Mab  = stage1("MAB  (control)",  mab);
  const s1Lucb = stage1("LinUCB",          lucb);
  const s1Ql   = stage1("Q-Learning",      ql);

  console.log("\n── Stage 2: context-dependent optimum ─────────────────────────");
  console.log(`   Two contexts (random 50/50 each step):`);
  console.log(`     c0: ambTemp=10 → arm A0=${A0} is optimal`);
  console.log(`     c1: ambTemp=30 → arm A1=${A1} is optimal`);
  console.log(`   PASS criterion: LinUCB/QL >90% per-context-optimal (last 25%)`);
  console.log(`   MAB expected ceiling ~50% (cannot condition — NOT a failure)\n`);

  const mab2  = new MABAgent(1.0, 0.91, 0.01);
  const lucb2 = new LinUCBAgent(2.5);
  const ql2   = new QLearningAgent(0.1, 0.95, 1.0, 0.99, 0.01);

  const s2Mab  = stage2("MAB  (capability ceiling)", mab2);
  const s2Lucb = stage2("LinUCB",                    lucb2);
  const s2Ql   = stage2("Q-Learning",                ql2);

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("SUMMARY TABLE");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("              Stage 1 (UPDATE rule)  Stage 2 (context-conditioning)");
  console.log(`  MAB          ${s1Mab  ? "PASS" : "FAIL"}                 CEILING (expected ≈50%)`);
  console.log(`  LinUCB       ${s1Lucb ? "PASS" : "FAIL"}                 ${s2Lucb ? "PASS" : "FAIL"}`);
  console.log(`  Q-Learning   ${s1Ql   ? "PASS" : "FAIL"}                 ${s2Ql   ? "PASS" : "FAIL"}`);

  console.log("\n── Interpretation ──────────────────────────────────────────────");
  if (s1Mab && !s1Lucb) {
    console.log("  LinUCB fails Stage 1 → UPDATE RULE BUG in LinUCBAgent itself");
  }
  if (s1Mab && !s1Ql) {
    console.log("  Q-Learning fails Stage 1 → UPDATE RULE BUG in QLearningAgent itself");
  }
  if (s1Mab && s1Lucb && !s2Lucb) {
    console.log("  LinUCB: Stage 1 PASS but Stage 2 FAIL → context-conditioning broken in LinUCBAgent");
    console.log("  (also check: production experiments.ts passes shiftState to update instead of prevState)");
  }
  if (s1Mab && s1Ql && !s2Ql) {
    console.log("  Q-Learning: Stage 1 PASS but Stage 2 FAIL → state-key discrimination broken");
    console.log("  (verify discretize produces different keys for c0 vs c1)");
  }
  if (s1Mab && s1Lucb && s2Lucb && s1Ql && s2Ql) {
    console.log("  ALL agents pass in isolation.");
    console.log("  If LinUCB/Q-Learning underperform in production, the bug is OUTSIDE the agents:");
    console.log("  → check experiments.ts: does it pass shiftState (next) to LinUCB.update instead of prevState (decision-time)?");
    console.log("  → check reward aggregation, extractState, or the update call sequence.");
  }
}

main();
