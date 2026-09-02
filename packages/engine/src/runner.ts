import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { KpiStep } from "./types.js";

/** Absolute path to the ManuSim project (local copy inside the monorepo) */
const MANUSIM_DIR = path.resolve(__dirname, "../../simulation");

export interface RunSimOptions {
  steps: number;
  seed: number;
  outputDir: string;
  setpointRate?: number;
}

/**
 * Runs the HeadlessMain Java simulation in batch mode and returns parsed KPI steps.
 */
export function runSimulation(opts: RunSimOptions): KpiStep[] {
  const classpath = [
    path.join(MANUSIM_DIR, "out", "production", "ManuSim"),
    path.join(MANUSIM_DIR, "ManuSim","lib", "mysql-connector-java-5.1.47.jar"),
  ].join(process.platform === "win32" ? ";" : ":");

  const outDir = path.resolve(opts.outputDir);
  fs.mkdirSync(outDir, { recursive: true });

  const javaArgs = [
    "-cp", classpath,
    "com.inknow.manusim.control.HeadlessMain",
    "--steps", String(opts.steps),
    "--seed", String(opts.seed),
    "--outputDir", outDir,
  ];
  if (opts.setpointRate !== undefined) {
    javaArgs.push("--setpointRate", String(opts.setpointRate));
  }

  execFileSync("java", javaArgs, {
  cwd: path.join(MANUSIM_DIR, "ManuSim"),  // ← changed
  timeout: 60_000,
  stdio: "pipe",
  });

  // Find the KPI JSONL (not events) in the output directory
  const subdirs = fs.readdirSync(outDir);
  const latestDir = subdirs.sort().pop();
  if (!latestDir) throw new Error("No simulation output found");

  const outputPath = path.join(outDir, latestDir);
  const files = fs.readdirSync(outputPath);
  const kpiFile = files.find(f => f.endsWith(".jsonl") && !f.includes("events"));
  if (!kpiFile) throw new Error("No KPI JSONL file found");

  const lines = fs.readFileSync(path.join(outputPath, kpiFile), "utf-8")
    .split("\n")
    .filter(l => l.trim());

  return lines.map(l => JSON.parse(l) as KpiStep);
}

// ── Interactive mode ──────────────────────────────────────────────────

export interface InteractiveSimOptions {
  steps: number;
  seed: number;
  /** Wear-rate heterogeneity spread S ∈ [0,1]. Each workarea gets m_i = 1+U(-S,+S)
   *  seeded from (seed, workareaIndex). Default 0 = lockstep (all m_i = 1). */
  wearRateSpread?: number;
}

/** Command sent to Java each step — either a plain rate or rate + maintenance target */
export interface StepCommand {
  rate: number;
  maintainWorkarea?: number;  // 0-15: workarea index to trigger preventive maintenance on
}

export interface StepCallback {
  /**
   * Called with the parsed KPI step; must return the command for the NEXT step.
   * Return a number for backward compat (plain rate) or a StepCommand.
   */
  (step: KpiStep, stepIndex: number): number | StepCommand;
}

/** Serialize a StepCommand to the Java stdin protocol line */
function formatCommand(cmd: number | StepCommand): string {
  if (typeof cmd === "number") return cmd.toFixed(4);
  const base = cmd.rate.toFixed(4);
  if (cmd.maintainWorkarea != null && cmd.maintainWorkarea >= 0) {
    return `${base} MAINT ${cmd.maintainWorkarea}`;
  }
  return base;
}

/**
 * Runs HeadlessMain in --interactive mode with step-level IPC.
 *
 * For each of the N steps:
 *   1. Writes the command (rate, optionally MAINT) to Java's stdin
 *   2. Reads one JSONL line from Java's stdout
 *   3. Calls `onStep` which returns the command for the next step
 *
 * The first command (for step 0) is provided via `initialCommand`.
 */
export async function runInteractiveSimulation(
  opts: InteractiveSimOptions,
  initialCommand: number | StepCommand,
  onStep: StepCallback,
): Promise<KpiStep[]> {
  const classpath = [
    path.join(MANUSIM_DIR, "out", "production", "ManuSim"),
    path.join(MANUSIM_DIR, "ManuSim", "lib", "mysql-connector-java-5.1.47.jar"),
  ].join(process.platform === "win32" ? ";" : ":");

  const javaArgs = [
    "-cp", classpath,
    "com.inknow.manusim.control.HeadlessMain",
    "--interactive",
    "--steps", String(opts.steps),
    "--seed", String(opts.seed),
  ];
  if (opts.wearRateSpread && opts.wearRateSpread > 0) {
    javaArgs.push("--wearRateSpread", String(opts.wearRateSpread));
  }

  const proc = spawn("java", javaArgs, {
    cwd: path.join(MANUSIM_DIR, "ManuSim"),
    stdio: ["pipe", "pipe", "pipe"],
  });

  const steps: KpiStep[] = [];
  let stderrBuf = "";

  proc.stderr?.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString();
  });

  const rl = readline.createInterface({ input: proc.stdout!, crlfDelay: Infinity });
  const lineIterator = rl[Symbol.asyncIterator]();

  const STEP_TIMEOUT_MS = 5_000;

  try {
    let nextCmd: number | StepCommand = initialCommand;

    for (let i = 0; i < opts.steps; i++) {
      // 1. Write command to Java's stdin
      const cmdStr = formatCommand(nextCmd);
      const writeOk = proc.stdin!.write(cmdStr + "\n");
      if (!writeOk) {
        await new Promise<void>(resolve => proc.stdin!.once("drain", resolve));
      }

      // 2. Read one JSONL line from stdout with timeout
      const lineResult = await Promise.race([
        lineIterator.next(),
        new Promise<{ done: true; value: undefined }>((_, reject) =>
          setTimeout(() => reject(new Error(`Step ${i}: Java did not respond within ${STEP_TIMEOUT_MS}ms`)), STEP_TIMEOUT_MS)
        ),
      ]);

      if (lineResult.done) {
        throw new Error(`Java process ended early at step ${i}`);
      }

      const line = lineResult.value as string;
      const kpiStep = JSON.parse(line) as KpiStep;
      steps.push(kpiStep);

      // 3. Get the command for the next step from the callback
      nextCmd = onStep(kpiStep, i);
    }
  } catch (err) {
    if (stderrBuf.trim()) {
      console.debug("[ManuSim stderr]", stderrBuf.trim());
    }
    // Close stdin to signal Java to exit
    proc.stdin?.end();
    proc.kill();
    if (steps.length === 0) {
      throw err; // no data recovered
    }
    console.warn(`[runner] Interactive episode aborted at step ${steps.length}: ${err instanceof Error ? err.message : err}`);
  } finally {
    rl.close();
    proc.stdin?.end();
    // Wait for process to exit (best-effort)
    await new Promise<void>(resolve => {
      proc.on("close", resolve);
      setTimeout(() => { proc.kill(); resolve(); }, 2_000);
    });
  }

  if (stderrBuf.trim()) {
    console.debug("[ManuSim stderr]", stderrBuf.trim());
  }

  return steps;
}
