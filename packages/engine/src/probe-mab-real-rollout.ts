/**
 * Probe — MAB F-sweep via REAL Java rollouts (ground truth, shift-level).
 *
 * Replicates the production experiments.ts interactive loop EXACTLY (minus DB/SSE):
 * the UNMODIFIED MABAgent selects an action + gets a reward + updates once per SHIFT
 * (~60/episode), driving the real ManuSim; epsilon decays once per episode. This is
 * the faithful ground truth — no reward-pool abstraction, real wear dynamics, real
 * per-shift reward correlations.
 *
 * Per F candidate × seed: run REAL_EPISODES full 60-shift Java episodes, then report
 * converged action (greedy argmax), per-arm visit counts, and the lock episode.
 *
 * Because real rollouts are ~0.18 s/episode, use a modest seed count (REAL_SEEDS) —
 * enough to locate the knee and calibrate the two bootstrap models against truth.
 *
 * CONSTRAINT: measurement only — MABAgent/reward.ts/experiments.ts untouched. The
 * command-resolution + shift-reward + update sequence below is copied verbatim from
 * experiments.ts:259-377 / :451.
 *
 * Run: F_CANDIDATES=50,100,200 REAL_SEEDS=15 npx tsx src/probe-mab-real-rollout.ts
 */

import fs from "node:fs";
import { runInteractiveSimulation, type StepCommand } from "./runner.js";
import { ACTIONS, STEPS_PER_SHIFT } from "./actions.js";
import {
  WEAR_THRESHOLD, computeStepReward, aggregateShiftReward, maintenancePenalty, extractState,
  type StepRewardComponents,
} from "./reward.js";
import { MABAgent } from "./agents/mab.js";
import type { KpiStep, State } from "./types.js";

const F_CANDIDATES = (process.env.F_CANDIDATES ?? "50,100,200,300").split(",").map(Number);
const REAL_SEEDS   = Number(process.env.REAL_SEEDS ?? 15);
const REAL_EPISODES = Number(process.env.REAL_EPISODES ?? 500);
const SHIFTS_PER_EP = Number(process.env.SWEEP_SHIFTS ?? 60);
const SIM_STEPS     = SHIFTS_PER_EP * STEPS_PER_SHIFT;
const BASE_SEED     = Number(process.env.BASE_SEED ?? 5000);
const EPS_START = 1.0, EPS_FLOOR = 0.01;
const TRUE_OPT = 11, RUNNER_UP = 15, NA = ACTIONS.length;
const OUT_PATH = process.env.REAL_OUT
  ?? "C:/Users/Joaom/AppData/Local/Temp/claude/c--Users-Joaom-Documents-Learn-Tese-dt-monorepo/13141a31-5cc3-48a0-b34a-5333c804b4ca/scratchpad/real_rollout_result.json";

const decayFor = (F: number) => Math.pow(EPS_FLOOR / EPS_START, 1 / F);

/** One real episode driven by the live agent. Returns per-arm visit counts this episode. */
async function realEpisode(agent: MABAgent, seed: number, prevState: State): Promise<{ visits: Map<number, number>; endState: State }> {
  const visits = new Map<number, number>();
  let decisionState: State = prevState;
  let currentActionId = agent.selectAction(prevState);
  let prevAccidents = 0;
  let prevWear: number[] = new Array(16).fill(0);
  let subStep = 0;
  let shiftRate = ACTIONS[currentActionId].setpointRate;
  let maintTarget = -1;
  let preMaintWearFrac = 0;
  let shiftStepRewards: StepRewardComponents[] = [];

  // Command resolution — verbatim from experiments.ts:259-285
  function resolveCommand(): number | StepCommand {
    shiftRate = ACTIONS[currentActionId].setpointRate;
    const firstEligible = prevWear.findIndex(w => w < WEAR_THRESHOLD);
    const maxIdx = firstEligible < 0
      ? 0
      : prevWear.reduce((best, w, idx) => (w < WEAR_THRESHOLD && w > prevWear[best] ? idx : best), firstEligible);
    const maxWearFrac = prevWear.length > 0 && firstEligible >= 0 ? prevWear[maxIdx] / WEAR_THRESHOLD : 0;
    if (firstEligible >= 0 && prevWear[maxIdx] > 0 && ACTIONS[currentActionId].maintainNow) {
      maintTarget = maxIdx; preMaintWearFrac = maxWearFrac;
      return { rate: shiftRate, maintainWorkarea: maintTarget };
    }
    maintTarget = -1; preMaintWearFrac = 0;
    return shiftRate;
  }

  let initialCmd = resolveCommand();
  let lastStep: KpiStep | null = null;

  await runInteractiveSimulation(
    { steps: SIM_STEPS, seed },
    initialCmd,
    (kpiStep: KpiStep, stepIndex: number) => {
      subStep++;
      lastStep = kpiStep;
      const accidentDelta = kpiStep.numberAccidents - prevAccidents;
      prevAccidents = kpiStep.numberAccidents;
      const reward = computeStepReward(kpiStep, accidentDelta, prevWear);
      shiftStepRewards.push(reward);
      prevWear = kpiStep.wearByWorkarea ? [...kpiStep.wearByWorkarea] : prevWear;

      if (subStep >= STEPS_PER_SHIFT || stepIndex === SIM_STEPS - 1) {
        // One agent decision = one shift pull: count the action that was active this shift.
        visits.set(currentActionId, (visits.get(currentActionId) ?? 0) + 1);
        let shiftReward = aggregateShiftReward(shiftStepRewards);
        if (maintTarget >= 0) shiftReward -= maintenancePenalty(preMaintWearFrac);
        const shiftState = extractState(kpiStep, SIM_STEPS);
        const done = stepIndex === SIM_STEPS - 1;
        agent.update(currentActionId, shiftReward, decisionState, shiftState, done);
        decisionState = shiftState;
        currentActionId = agent.selectAction(shiftState);
        subStep = 0;
        shiftStepRewards = [];
        return resolveCommand();
      }
      return shiftRate;
    },
  );
  const endState = lastStep ? extractState(lastStep, SIM_STEPS) : prevState;
  return { visits, endState };
}

function argmax(values: number[]): number {
  let am = 0, best = -Infinity;
  for (let a = 0; a < NA; a++) if (values[a] > best) { best = values[a]; am = a; }
  return am;
}

async function runSeed(F: number, decay: number, seed: number): Promise<{ converged: number; visits: number[]; lockEp: number }> {
  const agent = new MABAgent(EPS_START, decay, EPS_FLOOR, false);
  const values = (agent as unknown as { values: number[] }).values;
  const visits = new Array(NA).fill(0);
  const argmaxHist: number[] = [];
  let prevState: State = { ambTemperature: 20, rawMaterialQuality: 0.5, stepNorm: 0, shiftPhaseNorm: 0, numberAccidents: 0 };
  for (let ep = 0; ep < REAL_EPISODES; ep++) {
    const { visits: epVisits, endState } = await realEpisode(agent, seed + ep, prevState);
    for (const [a, c] of epVisits) visits[a] += c;
    prevState = endState;
    agent.decayEpsilon();
    argmaxHist.push(argmax(values));
  }
  const converged = argmaxHist[argmaxHist.length - 1];
  let lockEp = 0;
  for (let e = 0; e < argmaxHist.length; e++) if (argmaxHist[e] !== converged) lockEp = e + 1;
  return { converged, visits, lockEp };
}

function mode(xs: number[]) {
  const m = new Map<number, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  let value = xs[0], count = 0;
  for (const [v, c] of m) if (c > count) { value = v; count = c; }
  return { value, count };
}

async function main() {
  console.log("═".repeat(88));
  console.log(`MAB F-SWEEP — REAL Java rollouts (ground truth, shift-level pull structure)`);
  console.log(`Sweep: F ∈ {${F_CANDIDATES.join(", ")}} × ${REAL_SEEDS} seeds × ${REAL_EPISODES} ep × ${SHIFTS_PER_EP} shifts`);
  console.log(`True opt: medium_t60 (id ${TRUE_OPT})   runner-up: high_t60 (id ${RUNNER_UP})`);
  console.log("═".repeat(88));

  const results: Record<string, unknown> = { F_CANDIDATES, REAL_SEEDS, REAL_EPISODES, rows: [] as unknown[] };
  const rows: string[] = [];
  const t0 = Date.now();
  for (const F of F_CANDIDATES) {
    const decay = decayFor(F);
    const converged: number[] = [];
    const visitAcc = new Array(NA).fill(0);
    let optWins = 0, runnerWins = 0, lockSum = 0;
    for (let s = 0; s < REAL_SEEDS; s++) {
      const r = await runSeed(F, decay, BASE_SEED + s * REAL_EPISODES);
      converged.push(r.converged);
      for (let a = 0; a < NA; a++) visitAcc[a] += r.visits[a];
      if (r.converged === TRUE_OPT) optWins++;
      if (r.converged === RUNNER_UP) runnerWins++;
      lockSum += r.lockEp;
      process.stdout.write(`  F=${F} seed ${s + 1}/${REAL_SEEDS} → ${ACTIONS[r.converged].name} (lock ep ${r.lockEp})    \r`);
    }
    const m = mode(converged);
    const meanVisits = visitAcc.map(v => v / REAL_SEEDS);
    const optPct = 100 * optWins / REAL_SEEDS;
    const meanLock = lockSum / REAL_SEEDS;
    console.log(`\n── F=${F} (decay=${decay.toFixed(5)}) ${"─".repeat(52)}`);
    console.log(`  (a) modal action : ${ACTIONS[m.value].name} (id ${m.value}) [${m.count}/${REAL_SEEDS}]`);
    console.log(`  (b) → medium_t60 : ${optWins}/${REAL_SEEDS} (${optPct.toFixed(1)}%)   → high_t60 : ${runnerWins}/${REAL_SEEDS}   → other : ${REAL_SEEDS - optWins - runnerWins}`);
    console.log(`  (c) winner visits : medium_t60=${meanVisits[TRUE_OPT].toFixed(0)}  high_t60=${meanVisits[RUNNER_UP].toFixed(0)}  (of ${REAL_EPISODES * SHIFTS_PER_EP} pulls)`);
    console.log(`  (d) lock episode : mean=${meanLock.toFixed(1)}  (floor at ep ${F})`);
    rows.push(`${String(F).padStart(3)} │ ${decay.toFixed(5)} │ ${ACTIONS[m.value].name.padEnd(15)} │ ${optPct.toFixed(1).padStart(5)}% │ ${String(runnerWins).padStart(2)}/${REAL_SEEDS} │ ${meanVisits[TRUE_OPT].toFixed(0).padStart(6)} │ ${meanLock.toFixed(0).padStart(4)}`);
    (results.rows as unknown[]).push({ F, decay, modal: ACTIONS[m.value].name, optPct, optWins, runnerWins, converged, meanVisits, meanLock });
    fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
  }
  console.log(`\nElapsed: ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log("\n" + "═".repeat(88));
  console.log("REAL-ROLLOUT F-SWEEP SUMMARY");
  console.log("  F │ decay   │ modal action    │ →med11 │ →hi15 │ winner │ lock");
  console.log("─".repeat(88));
  for (const r of rows) console.log(r);
  console.log(`Result JSON → ${OUT_PATH}`);
}

main().catch(err => { console.error("Probe failed:", err); process.exit(1); });
