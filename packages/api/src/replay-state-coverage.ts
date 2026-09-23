/**
 * One-off replay probe: reconstruct the exact set of Q-Learning state keys
 * visited in experiment 36 (run 108, epsilonMin=0.01, 1000 episodes) and
 * experiment 53 (run 136, epsilonMin=0.05, 2000 episodes), then compare set
 * overlap. dt.sqlite only stores the scalar q_table_size per episode, not
 * the actual key membership, so this replays both configs against a scratch
 * copy of the DB (via the real, unmodified runExperiment()) with
 * QLearningAgent.prototype patched to record every key it ever creates.
 *
 * Both configs share simSeed=42 and the same per-episode seed formula, so
 * this is a deterministic, faithful replay of the original runs, not a
 * fresh/different rollout.
 *
 * Run: npx tsx packages/api/src/replay-state-coverage.ts
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getDb, QLearningAgent } from "@dt/engine";
import type { ExperimentConfig } from "@dt/engine";
import { runExperiment } from "./routes/experiments.js";

const SCRATCH_DB = path.join(
  "C:/Users/Joaom/AppData/Local/Temp/claude/c--Users-Joaom-Documents-Learn-Tese-dt-monorepo/b8a121d4-ee92-41f6-80fa-71e28dd001c9/scratchpad",
  "replay-scratch.sqlite",
);

// ── Monkeypatch: capture every key QLearningAgent ever creates an entry for ──
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

// ── Minimal stub Express Response (SSE writes are no-ops here) ──────────────
function makeStubRes() {
  return {
    writeHead: () => {},
    write: () => {},
    end: () => {},
    status: () => ({ json: () => {} }),
    json: () => {},
  } as unknown as import("express").Response;
}

async function replay(label: string, config: ExperimentConfig) {
  capturedKeys.set(label, new Set());
  activeLabel = label;

  const db = getDb(SCRATCH_DB);
  const insertResult = db
    .prepare("INSERT INTO experiments (config_json, status) VALUES (?, 'pending')")
    .run(JSON.stringify(config));
  const expId = Number(insertResult.lastInsertRowid);

  console.log(`\n── Replaying ${label} (experiment id ${expId} in scratch DB) ──`);
  await runExperiment(db, expId, config, true, makeStubRes());

  const qRun = db
    .prepare("SELECT id FROM runs WHERE experiment_id = ? AND agent_type = 'qlearning'")
    .get(expId) as { id: number };
  const lastEpisode = db
    .prepare("SELECT episode_num, q_table_size, epsilon FROM episodes WHERE run_id = ? ORDER BY episode_num DESC LIMIT 1")
    .get(qRun.id) as { episode_num: number; q_table_size: number; epsilon: number };

  console.log(
    `  DB-reported final q_table_size=${lastEpisode.q_table_size} at episode ${lastEpisode.episode_num} (epsilon=${lastEpisode.epsilon})`,
  );
  console.log(`  Captured key-set size=${capturedKeys.get(label)!.size}`);

  if (lastEpisode.q_table_size !== capturedKeys.get(label)!.size) {
    console.warn(
      `  ⚠ MISMATCH between DB q_table_size and captured key-set size — replay is NOT faithful, stop here.`,
    );
  } else {
    console.log(`  ✓ Replay confirmed faithful (captured set size matches original run's stored q_table_size).`);
  }
}

async function main() {
  // Full original agent lineup, in the original order (mab, linucb, qlearning) —
  // a qlearning-only replay diverged from the real DB starting ~episode 200
  // (596 vs 614 final keys), so whatever the interactive sim's cross-agent
  // state is, it must be reproduced faithfully, not just the qlearning config.
  const exp36Config: ExperimentConfig = {
    simSteps: 800,
    simSeed: 42,
    totalEpisodes: 1000,
    interactive: true,
    wearRateSpread: 0.2,
    agents: [
      { type: "mab", hyperparams: { epsilon: 1, epsilonDecay: 0.91201, epsilonMin: 0.01, useConstantAlpha: 1, alpha: 0.1 } },
      { type: "linucb", hyperparams: { alpha: 2.5 } },
      { type: "qlearning", hyperparams: { alpha: 0.1, gamma: 0.95, epsilon: 1, epsilonDecay: 0.99, epsilonMin: 0.01 } },
    ],
  };

  const exp53Config: ExperimentConfig = {
    simSteps: 800,
    simSeed: 42,
    totalEpisodes: 2000,
    interactive: true,
    wearRateSpread: 0.2,
    agents: [
      { type: "mab", hyperparams: { epsilon: 1, epsilonDecay: 0.91201, epsilonMin: 0.01, useConstantAlpha: 1, alpha: 0.1 } },
      { type: "linucb", hyperparams: { alpha: 2.5 } },
      { type: "qlearning", hyperparams: { alpha: 0.1, gamma: 0.95, epsilon: 1, epsilonDecay: 0.99, epsilonMin: 0.05 } },
    ],
  };

  await replay("exp36", exp36Config);
  await replay("exp53", exp53Config);

  const set36 = capturedKeys.get("exp36")!;
  const set53 = capturedKeys.get("exp53")!;

  const intersection = new Set([...set36].filter((k) => set53.has(k)));
  const only36 = new Set([...set36].filter((k) => !set53.has(k)));
  const only53 = new Set([...set53].filter((k) => !set36.has(k)));

  console.log(`\n${"─".repeat(70)}`);
  console.log(`OVERLAP REPORT`);
  console.log(`${"─".repeat(70)}`);
  console.log(`  |exp36| = ${set36.size}`);
  console.log(`  |exp53| = ${set53.size}`);
  console.log(`  |intersection| = ${intersection.size}`);
  console.log(`  exp36-only (not reached by exp53) = ${only36.size}`);
  console.log(`  exp53-only (new, beyond exp36)    = ${only53.size}`);
  console.log(`  exp36 ⊆ exp53 (superset)?  ${only36.size === 0}`);
  console.log(`  Fraction of exp36's states also in exp53: ${(intersection.size / set36.size * 100).toFixed(1)}%`);
  console.log(`  Theoretical max: 1458`);

  if (only36.size > 0) {
    console.log(`\n  exp36-only keys (dropped/unreached in exp53's replay):`);
    console.log(`    ${[...only36].join("  ")}`);
  }
}

main().catch((err) => {
  console.error("Replay failed:", err);
  process.exit(1);
});
