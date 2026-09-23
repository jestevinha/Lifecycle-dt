/**
 * Controlled A/B: epsilonMin=0.01 vs epsilonMin=0.05 for Q-Learning, both
 * generated FRESH under current (HEAD) code, same simSeed=42, same
 * totalEpisodes=2000, same alpha/gamma/epsilonDecay — only epsilonMin
 * differs. This sidesteps the exp36-vs-exp53 git-provenance confound
 * (those two ran on different, unpinned code states) by construction: both
 * arms here are produced in the same process, from the same source tree.
 *
 * Agent lineup: qlearning only. A prior check (replay-state-coverage.ts)
 * confirmed that running qlearning alone vs the full original
 * mab+linucb+qlearning lineup produces an IDENTICAL qlearning state-key
 * count (596 both ways) for the same config, so lineup doesn't confound
 * the qlearning-specific result and dropping mab/linucb here is safe and
 * ~3x faster.
 *
 * Reports, per arm: final q_table_size (cross-checked against captured key
 * set for internal consistency), reward trajectory (first/last 100
 * episodes), and epsilon-floor episode. Then: state-key set overlap
 * between the two arms.
 *
 * Run: npx tsx packages/api/src/ab-epsilonmin.ts
 */
import path from "node:path";
import { getDb, QLearningAgent } from "@dt/engine";
import type { ExperimentConfig } from "@dt/engine";
import { runExperiment } from "./routes/experiments.js";

const SCRATCH_DB = path.join(
  "C:/Users/Joaom/AppData/Local/Temp/claude/c--Users-Joaom-Documents-Learn-Tese-dt-monorepo/b8a121d4-ee92-41f6-80fa-71e28dd001c9/scratchpad",
  "ab-epsilonmin-scratch.sqlite",
);

const capturedKeys = new Map<string, Set<string>>();
let activeLabel = "";

const origGetQ = (QLearningAgent.prototype as unknown as { getQ: (key: string) => number[] }).getQ;
(QLearningAgent.prototype as unknown as { getQ: (key: string) => number[] }).getQ = function (
  this: unknown,
  key: string,
) {
  capturedKeys.get(activeLabel)?.add(key);
  return origGetQ.call(this, key);
};

function makeStubRes() {
  return {
    writeHead: () => {},
    write: () => {},
    end: () => {},
    status: () => ({ json: () => {} }),
    json: () => {},
  } as unknown as import("express").Response;
}

/**
 * runInteractiveSimulation spawns one JVM per episode with a hardcoded 5s
 * step-0 startup timeout (runner.ts) and no retry — occasionally (observed
 * ~episode 1280-1430 of 2000, twice, in this environment) a JVM cold-start
 * exceeds that window and the whole experiment throws. That's a pre-existing
 * infra fragility, not specific to this A/B, so retry the whole arm from
 * scratch (fresh experiment row) rather than trying to resume mid-run.
 */
async function runArmWithRetry(label: string, epsilonMin: number, maxAttempts = 6) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await runArm(label, epsilonMin, attempt);
    } catch (err) {
      console.warn(`  ⚠ ${label} attempt ${attempt}/${maxAttempts} failed: ${err instanceof Error ? err.message : err}`);
      if (attempt === maxAttempts) throw err;
    }
  }
  throw new Error("unreachable");
}

async function runArm(label: string, epsilonMin: number, attempt: number) {
  capturedKeys.set(label, new Set());
  activeLabel = label;

  const config: ExperimentConfig = {
    simSteps: 800,
    simSeed: 42,
    totalEpisodes: 2000,
    interactive: true,
    wearRateSpread: 0.2,
    agents: [
      { type: "qlearning", hyperparams: { alpha: 0.1, gamma: 0.95, epsilon: 1, epsilonDecay: 0.99, epsilonMin } },
    ],
  };

  const db = getDb(SCRATCH_DB);
  const insertResult = db
    .prepare("INSERT INTO experiments (config_json, status) VALUES (?, 'pending')")
    .run(JSON.stringify(config));
  const expId = Number(insertResult.lastInsertRowid);

  console.log(`\n── Running ${label} (epsilonMin=${epsilonMin}, experiment id ${expId}, attempt ${attempt}) ──`);
  await runExperiment(db, expId, config, true, makeStubRes());

  const run = db
    .prepare("SELECT id FROM runs WHERE experiment_id = ? AND agent_type = 'qlearning'")
    .get(expId) as { id: number };
  const episodes = db
    .prepare("SELECT episode_num, reward, epsilon, q_table_size FROM episodes WHERE run_id = ? ORDER BY episode_num")
    .all(run.id) as { episode_num: number; reward: number; epsilon: number; q_table_size: number }[];

  const first100 = episodes.slice(0, 100);
  const last100 = episodes.slice(-100);
  const avgFirst100 = first100.reduce((s, e) => s + e.reward, 0) / first100.length;
  const avgLast100 = last100.reduce((s, e) => s + e.reward, 0) / last100.length;
  const finalQSize = episodes[episodes.length - 1].q_table_size;
  const floorEp = episodes.find((e) => e.epsilon <= epsilonMin + 1e-6)?.episode_num ?? -1;

  console.log(`  avg reward ep[0,100)    = ${avgFirst100.toFixed(2)}`);
  console.log(`  avg reward ep[1900,2000) = ${avgLast100.toFixed(2)}`);
  console.log(`  final q_table_size (DB)  = ${finalQSize}`);
  console.log(`  captured key-set size    = ${capturedKeys.get(label)!.size}`);
  console.log(`  epsilon reaches floor at episode ${floorEp}`);
  if (finalQSize !== capturedKeys.get(label)!.size) {
    console.warn(`  ⚠ MISMATCH — captured set doesn't match DB q_table_size, results below are unreliable`);
  } else {
    console.log(`  ✓ internally consistent`);
  }

  return { avgFirst100, avgLast100, finalQSize };
}

async function main() {
  const resA = await runArmWithRetry("epsMin0.01", 0.01);
  const resB = await runArmWithRetry("epsMin0.05", 0.05);

  const setA = capturedKeys.get("epsMin0.01")!;
  const setB = capturedKeys.get("epsMin0.05")!;
  const intersection = new Set([...setA].filter((k) => setB.has(k)));
  const onlyA = new Set([...setA].filter((k) => !setB.has(k)));
  const onlyB = new Set([...setB].filter((k) => !setA.has(k)));

  console.log(`\n${"─".repeat(70)}`);
  console.log(`CLEAN A/B REPORT (same seed=42, same 2000 episodes, same code)`);
  console.log(`${"─".repeat(70)}`);
  console.log(`  epsilonMin=0.01: |states|=${setA.size}  avgR[first100]=${resA.avgFirst100.toFixed(2)}  avgR[last100]=${resA.avgLast100.toFixed(2)}`);
  console.log(`  epsilonMin=0.05: |states|=${setB.size}  avgR[first100]=${resB.avgFirst100.toFixed(2)}  avgR[last100]=${resB.avgLast100.toFixed(2)}`);
  console.log(`  |intersection| = ${intersection.size}`);
  console.log(`  0.01-only (states 0.05 never reached) = ${onlyA.size}`);
  console.log(`  0.05-only (states 0.01 never reached) = ${onlyB.size}`);
  console.log(`  0.01 ⊆ 0.05?  ${onlyA.size === 0}`);
  console.log(`  Fraction of 0.01's states also in 0.05: ${(intersection.size / setA.size * 100).toFixed(1)}%`);
  console.log(`  Theoretical max: 1458`);
  console.log(`  Delta in coverage from raising floor 0.01→0.05: ${setB.size - setA.size} states (${((setB.size - setA.size) / setA.size * 100).toFixed(1)}%)`);
}

main().catch((err) => {
  console.error("A/B failed:", err);
  process.exit(1);
});
