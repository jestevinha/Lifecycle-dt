/**
 * Probe — MAB epsilon-floor F-sweep, CORRECTED shift-level pull structure.
 *
 * Unlike probe-mab-fsweep.ts (1 pull = 1 episode), this drives the UNMODIFIED
 * MABAgent exactly as production experiments.ts does:
 *   • per EPISODE: ~60 shifts, each a separate agent.selectAction + agent.update
 *     at that episode's FIXED epsilon  (experiments.ts:356/:360)
 *   • epsilon decays ONCE per episode  (experiments.ts:451)
 *
 * Per-shift rewards are bootstrap-drawn from the empirical per-SHIFT pool
 * (reward_pool_shift_w8.json), which preserves the real per-shift mean/variance.
 *
 * decay = 0.01^(1/F) so epsilon floors at episode F. Sweep F candidates × seeds ×
 * 500 episodes, and per F report:
 *   (a) modal converged action        (greedy argmax of learned values)
 *   (b) % of seeds converging to medium_t60 (true optimum, id 11)
 *   (c) winner visit count (pulls, out of ~30000) — over/under-exploration check
 *   (d) lock episode: first episode after which the greedy argmax never changes,
 *       averaged across seeds
 *
 * CONSTRAINT: measurement only — MABAgent/reward.ts/experiments.ts untouched.
 * Run: npx tsx src/probe-mab-fsweep-shift.ts
 */

import fs from "node:fs";
import { MABAgent } from "./agents/mab.js";
import { ACTIONS } from "./actions.js";
import type { State } from "./types.js";

const POOL_PATH = process.env.SHIFT_POOL_OUT
  ?? "C:/Users/Joaom/AppData/Local/Temp/claude/c--Users-Joaom-Documents-Learn-Tese-dt-monorepo/13141a31-5cc3-48a0-b34a-5333c804b4ca/scratchpad/reward_pool_shift_w8.json";

const F_CANDIDATES  = (process.env.F_CANDIDATES ?? "50,75,100,150,200,300").split(",").map(Number);
const N_SEEDS       = Number(process.env.N_SEEDS ?? 1000);
const N_EPISODES    = Number(process.env.N_EPISODES ?? 500);
const SHIFTS_PER_EP = Number(process.env.SHIFTS_PER_EP ?? 60);
const EPS_START = 1.0, EPS_FLOOR = 0.01;
const TRUE_OPT = 11, RUNNER_UP = 15, NA = ACTIONS.length;

const DUMMY: State = { ambTemperature: 20, rawMaterialQuality: 0.5, stepNorm: 0.5, shiftPhaseNorm: 0.5, numberAccidents: 0 };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PoolAction { name: string; mean: number; std: number; rewards: number[]; }
const raw = JSON.parse(fs.readFileSync(POOL_PATH, "utf-8")) as {
  W: number; N_POOL: number; level: string; actions: Record<string, PoolAction>;
};
if (raw.level !== "shift") throw new Error(`pool level=${raw.level}; need the per-SHIFT pool`);
const pool: number[][] = [];
for (let a = 0; a < NA; a++) {
  const e = raw.actions[String(a)];
  if (!e) throw new Error(`shift pool missing action ${a}`);
  pool[a] = e.rewards;
}
const poolMean = (a: number) => raw.actions[String(a)].mean;

const decayFor = (F: number) => Math.pow(EPS_FLOOR / EPS_START, 1 / F);

interface SeedResult { converged: number; visits: number[]; lockEp: number; }

function runOneSeed(decay: number, seed: number): SeedResult {
  const orig = Math.random;
  const rng = mulberry32(seed);
  Math.random = rng;
  try {
    const agent = new MABAgent(EPS_START, decay, EPS_FLOOR, false);   // sample-average
    const visits = new Array(NA).fill(0);
    const argmaxHist: number[] = [];
    const values = (agent as unknown as { values: number[] }).values;
    for (let ep = 0; ep < N_EPISODES; ep++) {
      // ── 60 shift-level pulls at this episode's fixed epsilon ──
      for (let sh = 0; sh < SHIFTS_PER_EP; sh++) {
        const a = agent.selectAction(DUMMY);
        visits[a]++;
        const s = pool[a];
        agent.update(a, s[Math.floor(rng() * s.length)], DUMMY, DUMMY, false);
      }
      agent.decayEpsilon?.();                                          // once per episode
      // greedy argmax after this episode
      let am = 0, best = -Infinity;
      for (let a = 0; a < NA; a++) if (values[a] > best) { best = values[a]; am = a; }
      argmaxHist.push(am);
    }
    const converged = argmaxHist[argmaxHist.length - 1];
    // lock episode = 1 + last episode whose argmax differs from the final argmax
    let lockEp = 0;
    for (let e = 0; e < argmaxHist.length; e++) if (argmaxHist[e] !== converged) lockEp = e + 1;
    return { converged, visits, lockEp };
  } finally {
    Math.random = orig;
  }
}

function mode(xs: number[]) {
  const m = new Map<number, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  let value = xs[0], count = 0;
  for (const [v, c] of m) if (c > count) { value = v; count = c; }
  return { value, count };
}

function main() {
  console.log("═".repeat(92));
  console.log(`MAB F-SWEEP — CORRECTED shift-level structure (${SHIFTS_PER_EP} pulls/episode, ε decays/episode)`);
  console.log(`Pool      : per-SHIFT, ${raw.N_POOL} episodes/action → ${pool[0].length} samples/arm  (W=${raw.W})`);
  console.log(`Sweep     : F ∈ {${F_CANDIDATES.join(", ")}} × ${N_SEEDS} seeds × ${N_EPISODES} ep × ${SHIFTS_PER_EP} shifts`);
  console.log(`True opt  : medium_t60 (id ${TRUE_OPT}, perShiftMean=${poolMean(TRUE_OPT).toFixed(3)})  ` +
              `runner-up high_t60 (id ${RUNNER_UP}, ${poolMean(RUNNER_UP).toFixed(3)})`);
  const ranked = ACTIONS.map((_, a) => ({ a, m: poolMean(a) })).sort((x, y) => y.m - x.m);
  console.log(`Pool top-4: ${ranked.slice(0, 4).map(r => `${ACTIONS[r.a].name}(${r.m.toFixed(2)})`).join("  ")}`);
  console.log("═".repeat(92));

  const rows: string[] = [];
  for (const F of F_CANDIDATES) {
    const decay = decayFor(F);
    const converged: number[] = [];
    const visitAcc = new Array(NA).fill(0);
    let optWins = 0, runnerWins = 0, lockSum = 0;
    for (let s = 0; s < N_SEEDS; s++) {
      const res = runOneSeed(decay, 2000 + s);
      converged.push(res.converged);
      for (let a = 0; a < NA; a++) visitAcc[a] += res.visits[a];
      if (res.converged === TRUE_OPT) optWins++;
      if (res.converged === RUNNER_UP) runnerWins++;
      lockSum += res.lockEp;
    }
    const m = mode(converged);
    const meanVisits = visitAcc.map(v => v / N_SEEDS);
    const optPct = 100 * optWins / N_SEEDS;
    const meanLock = lockSum / N_SEEDS;

    console.log(`\n── F=${F}  (decay=${decay.toFixed(5)}) ${"─".repeat(56)}`);
    console.log(`  (a) modal converged action : ${ACTIONS[m.value].name} (id ${m.value})  [${m.count}/${N_SEEDS}]`);
    console.log(`  (b) → medium_t60 : ${optWins}/${N_SEEDS} (${optPct.toFixed(1)}%)   ` +
      `→ high_t60 : ${runnerWins}/${N_SEEDS}   → other : ${N_SEEDS - optWins - runnerWins}/${N_SEEDS}`);
    console.log(`  (c) winner visits (pulls) : medium_t60=${meanVisits[TRUE_OPT].toFixed(0)}  ` +
      `high_t60=${meanVisits[RUNNER_UP].toFixed(0)}  ` +
      `(total pulls/run = ${N_EPISODES * SHIFTS_PER_EP})  avg other-19-arm=${
        (meanVisits.reduce((s, v, a) => a === m.value ? s : s + v, 0) / (NA - 1)).toFixed(0)}`);
    console.log(`  (d) lock episode (argmax stops changing) : mean=${meanLock.toFixed(1)}  ` +
      `(floor reached at ep ${F})`);

    rows.push(
      `${String(F).padStart(3)} │ ${decay.toFixed(5)} │ ${ACTIONS[m.value].name.padEnd(15)} │ ` +
      `${optPct.toFixed(1).padStart(5)}% │ ${String(runnerWins).padStart(3)}/${N_SEEDS} │ ` +
      `${meanVisits[TRUE_OPT].toFixed(0).padStart(6)} │ ${meanLock.toFixed(0).padStart(4)}`
    );
  }

  console.log("\n" + "═".repeat(92));
  console.log("SHIFT-LEVEL F-SWEEP SUMMARY");
  console.log("─".repeat(92));
  console.log("  F │ decay   │ modal action    │ →med11 │ →high15 │ winner │ lock");
  console.log("    │         │                 │  (b)   │         │ visits │  ep (d)");
  console.log("─".repeat(92));
  for (const r of rows) console.log(r);
  console.log("─".repeat(92));
}

main();
