/**
 * Probe — MAB epsilon-floor F-sweep (in-memory, episode-level bandit).
 *
 * Drives the UNMODIFIED MABAgent class (production epsilon/update logic) as a
 * 20-arm stochastic bandit whose per-arm reward distribution is the EMPIRICAL
 * episode-reward pool measured by probe-mab-epsilon-floor.ts at W=8.
 *
 * One pull = one episode. Reward for arm a is bootstrap-drawn (with replacement)
 * from pool[a] — this preserves the real per-action mean AND variance/shape.
 * Epsilon decays once per episode (matches production experiments.ts).
 *
 * For each floor-episode candidate F we set decay = 0.01^(1/F) so epsilon reaches
 * its floor (0.01) exactly at episode F, then sweep 10 seeds × 500 episodes and
 * report per F:
 *   (a) modal converged action across seeds
 *   (b) whether it == medium_t60 (true optimum, id 11)
 *   (c) stability: #seeds converging to the modal action
 *   (d) mean per-action visit counts by episode 500
 *
 * CONSTRAINT: does not touch MABAgent / reward.ts. Reads the pool JSON only.
 *
 * Run: npx tsx src/probe-mab-fsweep.ts
 */

import fs from "node:fs";
import { MABAgent } from "./agents/mab.js";
import { ACTIONS } from "./actions.js";
import type { State } from "./types.js";

const POOL_PATH = process.env.POOL_OUT
  ?? "C:/Users/Joaom/AppData/Local/Temp/claude/c--Users-Joaom-Documents-Learn-Tese-dt-monorepo/13141a31-5cc3-48a0-b34a-5333c804b4ca/scratchpad/reward_pool_w8.json";

const F_CANDIDATES = (process.env.F_CANDIDATES ?? "100,150,200,250,300").split(",").map(Number);
const N_SEEDS      = Number(process.env.N_SEEDS ?? 10);
const N_EPISODES   = Number(process.env.N_EPISODES ?? 500);
const EPS_START    = 1.0;
const EPS_FLOOR    = 0.01;
const TRUE_OPT     = 11;                      // medium_t60
const RUNNER_UP    = 15;                      // high_t60
const NA           = ACTIONS.length;          // 20

const DUMMY: State = {
  ambTemperature: 20, rawMaterialQuality: 0.5, stepNorm: 0.5, shiftPhaseNorm: 0.5, numberAccidents: 0,
};

// ── seeded PRNG (mulberry32) — installed as global Math.random per seed-run ──
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── load empirical pool ──────────────────────────────────────────────────────
interface PoolAction { name: string; rate: number; mean: number; std: number; rewards: number[]; }
const raw = JSON.parse(fs.readFileSync(POOL_PATH, "utf-8")) as {
  W: number; N_POOL: number; actions: Record<string, PoolAction>;
};
const pool: number[][] = [];
for (let a = 0; a < NA; a++) {
  const entry = raw.actions[String(a)];
  if (!entry) throw new Error(`pool missing action ${a} — build the full 20-action pool first`);
  pool[a] = entry.rewards;
}
const poolMean = (a: number) => raw.actions[String(a)].mean;

/** decay so that eps_start·decay^F == eps_floor  ⇒  decay = (floor/start)^(1/F). */
function decayFor(F: number): number {
  return Math.pow(EPS_FLOOR / EPS_START, 1 / F);
}

/** Expected exploratory samples per action during the decay phase (episodes 0..F-1). */
function expectedExploreSamplesDecayPhase(F: number, decay: number): number {
  // Σ_{e=0}^{F-1} eps_e  with eps_e = start·decay^e  (still > floor over 0..F-1)
  let sumEps = 0;
  let eps = EPS_START;
  for (let e = 0; e < F; e++) { sumEps += eps; eps = Math.max(EPS_FLOOR, eps * decay); }
  return sumEps / NA;      // uniform over 20 arms
}
/** Expected exploratory samples per action over the FULL 500-episode run. */
function expectedExploreSamplesFullRun(F: number, decay: number): number {
  let sumEps = 0, eps = EPS_START;
  for (let e = 0; e < N_EPISODES; e++) { sumEps += eps; eps = Math.max(EPS_FLOOR, eps * decay); }
  return sumEps / NA;
}

interface SeedResult { converged: number; visits: number[]; valOpt: number; valRun: number; }

function runOneSeed(F: number, decay: number, seed: number): SeedResult {
  const origRandom = Math.random;
  const rng = mulberry32(seed);
  Math.random = rng;                                   // controls agent AND reward draw
  try {
    const agent = new MABAgent(EPS_START, decay, EPS_FLOOR, false);   // sample-average (production default)
    const visits = new Array(NA).fill(0);
    for (let ep = 0; ep < N_EPISODES; ep++) {
      const a = agent.selectAction(DUMMY);
      visits[a]++;
      const samples = pool[a];
      const r = samples[Math.floor(rng() * samples.length)];          // bootstrap draw
      agent.update(a, r, DUMMY, DUMMY, false);
      agent.decayEpsilon?.();
    }
    const values = (agent as unknown as { values: number[] }).values;
    // Converged action = greedy argmax of learned values (what exploitation would pick).
    let converged = 0, best = -Infinity;
    for (let a = 0; a < NA; a++) if (values[a] > best) { best = values[a]; converged = a; }
    return { converged, visits, valOpt: values[TRUE_OPT], valRun: values[RUNNER_UP] };
  } finally {
    Math.random = origRandom;
  }
}

function mode(xs: number[]): { value: number; count: number } {
  const m = new Map<number, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  let value = xs[0], count = 0;
  for (const [v, c] of m) if (c > count) { value = v; count = c; }
  return { value, count };
}

function main() {
  console.log("═".repeat(92));
  console.log(`MAB EPSILON-FLOOR F-SWEEP — in-memory 20-arm bandit on empirical W=${raw.W} pool`);
  console.log(`Pool      : ${raw.N_POOL} episodes/action  (bootstrap-drawn per pull)`);
  console.log(`Sweep     : F ∈ {${F_CANDIDATES.join(", ")}}  ×  ${N_SEEDS} seeds  ×  ${N_EPISODES} episodes`);
  console.log(`True opt  : medium_t60 (id ${TRUE_OPT}, mean=${poolMean(TRUE_OPT).toFixed(2)})   ` +
              `runner-up: high_t60 (id ${RUNNER_UP}, mean=${poolMean(RUNNER_UP).toFixed(2)})`);
  // rank the pool means so we see the true landscape optimum
  const ranked = ACTIONS.map((_, a) => ({ a, m: poolMean(a) })).sort((x, y) => y.m - x.m);
  console.log(`Pool top-4: ${ranked.slice(0, 4).map(r => `${ACTIONS[r.a].name}(${r.m.toFixed(1)})`).join("  ")}`);
  console.log("═".repeat(92));

  const rows: string[] = [];
  for (const F of F_CANDIDATES) {
    const decay = decayFor(F);
    const expDecay = expectedExploreSamplesDecayPhase(F, decay);
    const expFull  = expectedExploreSamplesFullRun(F, decay);

    const converged: number[] = [];
    const visitAcc = new Array(NA).fill(0);
    let optWins = 0, runnerWins = 0;
    for (let s = 0; s < N_SEEDS; s++) {
      const res = runOneSeed(F, decay, 1000 + s);   // fixed seed base for reproducibility
      converged.push(res.converged);
      for (let a = 0; a < NA; a++) visitAcc[a] += res.visits[a];
      if (res.converged === TRUE_OPT) optWins++;
      if (res.converged === RUNNER_UP) runnerWins++;
    }
    const m = mode(converged);
    const meanVisits = visitAcc.map(v => v / N_SEEDS);

    console.log(`\n── F=${F}  (decay=${decay.toFixed(5)}) ${"─".repeat(58)}`);
    console.log(`  Expected exploratory samples/action:  decay-phase=${expDecay.toFixed(2)}   full-run=${expFull.toFixed(2)}`);
    console.log(`  Converged actions across ${N_SEEDS} seeds: ` +
      converged.map(c => ACTIONS[c].name).join(", "));
    console.log(`  (a) Modal converged action : ${ACTIONS[m.value].name} (id ${m.value})  [${m.count}/${N_SEEDS} seeds]`);
    console.log(`  (b) Matches true optimum medium_t60? : ${m.value === TRUE_OPT ? "YES" : "NO"}`);
    console.log(`  (c) Stability: → medium_t60=${optWins}/${N_SEEDS}   → high_t60=${runnerWins}/${N_SEEDS}   ` +
      `→ other=${N_SEEDS - optWins - runnerWins}/${N_SEEDS}`);
    console.log(`  (d) Mean visits by ep ${N_EPISODES}:  medium_t60=${meanVisits[TRUE_OPT].toFixed(1)}   ` +
      `high_t60=${meanVisits[RUNNER_UP].toFixed(1)}   ` +
      `min-arm=${Math.min(...meanVisits).toFixed(1)}   max-arm=${Math.max(...meanVisits).toFixed(1)}`);
    // exploration-phase check: avg visits on the 18 non-dominant arms ≈ exploratory share
    const nonWinnerVisits = meanVisits.filter((_, a) => a !== m.value);
    const avgNonWinner = nonWinnerVisits.reduce((s, v) => s + v, 0) / nonWinnerVisits.length;
    console.log(`      avg visits on the other 19 arms = ${avgNonWinner.toFixed(1)}  ` +
      `(predicted exploratory ≈ ${expFull.toFixed(1)})`);

    rows.push(
      `${String(F).padStart(4)} │ ${decay.toFixed(5)} │ ${ACTIONS[m.value].name.padEnd(15)} │ ` +
      `${(m.value === TRUE_OPT ? "YES" : "NO ").padEnd(3)} │ ` +
      `${String(optWins).padStart(2)}/${N_SEEDS}      │ ${String(runnerWins).padStart(2)}/${N_SEEDS}     │ ` +
      `${meanVisits[TRUE_OPT].toFixed(1).padStart(6)} │ ${meanVisits[RUNNER_UP].toFixed(1).padStart(6)} │ ` +
      `${expFull.toFixed(2).padStart(5)}`
    );
  }

  console.log("\n" + "═".repeat(92));
  console.log("F-SWEEP SUMMARY");
  console.log("─".repeat(92));
  console.log("   F │ decay   │ modal action    │ opt │ →med_t60  │ →high_t60 │ visits │ visits │ exp/arm");
  console.log("     │         │                 │  ?  │ (stability)│          │ med11  │ high15 │ (full)");
  console.log("─".repeat(92));
  for (const row of rows) console.log(row);
  console.log("─".repeat(92));
}

main();
