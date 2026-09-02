import os from "node:os";
import path from "node:path";
import { Router } from "express";
import { runSimulation } from "@dt/engine";
import type { KpiStep } from "@dt/engine";
import { initSSE, sendSSE, endSSE } from "../sse.js";

export const simulationsRouter = Router();

/**
 * Run a single headless simulation with custom parameters.
 * POST /api/simulations/run
 * Body: { steps: number, seed: number, setpointRate: number }
 * Returns KPI steps as JSON.
 */
simulationsRouter.post("/run", (req, res) => {
  const { steps, seed, setpointRate } = req.body as {
    steps: number;
    seed: number;
    setpointRate: number;
  };

  if (steps == null || seed == null || setpointRate == null) {
    return res.status(400).json({ error: "steps, seed, and setpointRate are required" });
  }

  if (setpointRate < 0 || setpointRate > 1) {
    return res.status(400).json({ error: "setpointRate must be between 0 and 1" });
  }

  try {
    const outputDir = path.join(os.tmpdir(), "dt-sim", "headless", `${Date.now()}`);

    const kpiSteps: KpiStep[] = runSimulation({
      steps,
      seed,
      setpointRate,
      outputDir,
    });

    res.json({ kpiSteps });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
