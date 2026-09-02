/**
 * Smoke test — pre-flight config validation at the API/creation layer (Task 1 + Task 3).
 *
 * Drives the REAL Express `experimentsRouter` over HTTP (ephemeral port + fetch) so the
 * four cases exercise the actual route handlers, not a re-implementation:
 *
 *   POST /api/experiments            → creation-layer gate (validateExperimentConfig)
 *   GET  /api/experiments/:id/start  → SSE stream + runExperiment (success path)
 *
 * For the two rejection cases we assert: HTTP 4xx, the JSON error body carries the
 * thrown message, ZERO experiment rows were inserted, and the response is plain JSON
 * (NOT an `text/event-stream` SSE connection). This proves the gate fires before any DB
 * write and before any stream is opened.
 *
 * Shares the process-wide in-memory DB with the router: getDb(":memory:") is seeded here
 * FIRST, and the router's own getDb() returns that same singleton.
 *
 * Run:  npx tsx src/smoke-validate-config.ts   (from packages/api)
 */
import express from "express";
import type { AddressInfo } from "node:net";
import { getDb } from "@dt/engine";
import type { ExperimentConfig } from "@dt/engine";
import { experimentsRouter } from "./routes/experiments.js";

// Seed the singleton DB as in-memory BEFORE the router touches it.
const db = getDb(":memory:");
const experimentCount = (): number =>
  (db.prepare("SELECT COUNT(*) AS c FROM experiments").get() as { c: number }).c;
const episodeCount = (): number =>
  (db.prepare("SELECT COUNT(*) AS c FROM episodes").get() as { c: number }).c;

const MAB_FULL = { type: "mab" as const, hyperparams: { epsilon: 1.0, epsilonDecay: 0.91201, epsilonMin: 0.01 } };
const MAB_EMPTY = { type: "mab" as const, hyperparams: {} };

interface Result { name: string; pass: boolean; detail: string }
const results: Result[] = [];

/** POST /api/experiments — returns status, parsed body, and whether the response is SSE. */
async function postExperiment(base: string, config: ExperimentConfig) {
  const res = await fetch(`${base}/api/experiments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  const contentType = res.headers.get("content-type") ?? "";
  const isSSE = contentType.includes("text/event-stream");
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* keep raw */ }
  return { status: res.status, body, contentType, isSSE };
}

/** GET /api/experiments/:id/start — consumes the SSE stream to completion (res.end()). */
async function startExperiment(base: string, id: number) {
  const res = await fetch(`${base}/api/experiments/${id}/start`);
  const contentType = res.headers.get("content-type") ?? "";
  const stream = await res.text(); // resolves when endSSE() calls res.end()
  return { status: res.status, contentType, stream };
}

async function main() {
  const app = express();
  app.use(express.json());
  app.use("/api/experiments", experimentsRouter);
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  console.log("═".repeat(90));
  console.log(`SMOKE TEST — API-layer validateExperimentConfig gate via real HTTP (${base})`);
  console.log("═".repeat(90));

  // ── Case 1: wearRateSpread omitted → 4xx, no row, no SSE ──
  {
    const cfg: ExperimentConfig = { simSteps: 8, simSeed: 42, totalEpisodes: 1, interactive: true, agents: [MAB_FULL] };
    const before = experimentCount();
    const r = await postExperiment(base, cfg);
    const after = experimentCount();
    const msg = typeof r.body === "object" ? String(r.body.error) : String(r.body);
    const is4xx = r.status >= 400 && r.status < 500;
    const zeroRows = after === before;
    const noSSE = !r.isSSE;
    const msgOk = /wearRateSpread=undefined/.test(msg) && /degenerate/.test(msg);
    const pass = is4xx && zeroRows && noSSE && msgOk;
    results.push({
      name: "1. wearRateSpread omitted",
      pass,
      detail: `HTTP ${r.status} (${r.contentType}) rows ${before}→${after} SSE=${r.isSSE}\n     body.error: ${msg}`,
    });
  }

  // ── Case 2: wearRateSpread set, MAB hyperparams {} → 4xx, no row, missing-key msg ──
  {
    const cfg: ExperimentConfig = { simSteps: 8, simSeed: 42, totalEpisodes: 1, interactive: true, wearRateSpread: 0.5, agents: [MAB_EMPTY] };
    const before = experimentCount();
    const r = await postExperiment(base, cfg);
    const after = experimentCount();
    const msg = typeof r.body === "object" ? String(r.body.error) : String(r.body);
    const is4xx = r.status >= 400 && r.status < 500;
    const zeroRows = after === before;
    const noSSE = !r.isSSE;
    const msgOk = /epsilon\b/.test(msg) && /epsilonDecay/.test(msg) && /under-specified/.test(msg);
    const pass = is4xx && zeroRows && noSSE && msgOk;
    results.push({
      name: "2. wearRateSpread ok, MAB {}",
      pass,
      detail: `HTTP ${r.status} (${r.contentType}) rows ${before}→${after} SSE=${r.isSSE}\n     body.error: ${msg}`,
    });
  }

  // ── Case 3: fully valid config → 201 create, then GET /start opens SSE, ≥1 episode ──
  {
    const cfg: ExperimentConfig = { simSteps: 8, simSeed: 42, totalEpisodes: 1, interactive: true, wearRateSpread: 0.5, agents: [MAB_FULL] };
    const post = await postExperiment(base, cfg);
    const created = post.status === 201 && typeof post.body?.id === "number";
    let startInfo = "(not started — create failed)";
    let pass = false;
    if (created) {
      const epsBefore = episodeCount();
      const s = await startExperiment(base, post.body.id);
      const epsAfter = episodeCount();
      const sse200 = s.status === 200 && s.contentType.includes("text/event-stream");
      const ranEpisode = epsAfter > epsBefore;
      const completed = /event:\s*done/.test(s.stream) || /"status":"completed"/.test(s.stream);
      pass = created && sse200 && ranEpisode && completed;
      startInfo = `start HTTP ${s.status} (${s.contentType}) episodesRan=${epsAfter - epsBefore} sseCompleted=${completed}`;
    }
    results.push({
      name: "3. fully valid config",
      pass,
      detail: `POST HTTP ${post.status} created=${created} id=${post.body?.id}\n     ${startInfo}`,
    });
  }

  // ── Case 4: wearRateSpread=0 + allowDegenerateWear:true → escape hatch, 201 + SSE run ──
  {
    const cfg: ExperimentConfig = { simSteps: 8, simSeed: 42, totalEpisodes: 1, interactive: true, wearRateSpread: 0, allowDegenerateWear: true, agents: [MAB_FULL] };
    const post = await postExperiment(base, cfg);
    const created = post.status === 201 && typeof post.body?.id === "number";
    let startInfo = "(not started — create failed)";
    let pass = false;
    if (created) {
      const epsBefore = episodeCount();
      const s = await startExperiment(base, post.body.id);
      const epsAfter = episodeCount();
      const sse200 = s.status === 200 && s.contentType.includes("text/event-stream");
      const ranEpisode = epsAfter > epsBefore;
      pass = created && sse200 && ranEpisode;
      startInfo = `start HTTP ${s.status} (${s.contentType}) episodesRan=${epsAfter - epsBefore}`;
    }
    results.push({
      name: "4. wearRateSpread=0 + allowDegenerateWear",
      pass,
      detail: `POST HTTP ${post.status} created=${created} id=${post.body?.id}\n     ${startInfo}`,
    });
  }

  console.log();
  for (const r of results) {
    console.log(`[${r.pass ? "PASS" : "FAIL"}] ${r.name}`);
    console.log(`     ${r.detail}`);
  }
  const allPass = results.every((r) => r.pass);
  console.log("\n" + "═".repeat(90));
  console.log(allPass ? "ALL 4 CASES PASS ✓" : "SOME CASES FAILED ✗");
  server.close();
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error("Smoke harness crashed:", e); process.exit(2); });
