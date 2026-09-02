const BASE = "/api";

/* ── Types ── */

export interface Experiment {
  id: number;
  created_at: string;
  config_json: string;
  status: "pending" | "running" | "completed" | "failed";
}

export interface Run {
  id: number;
  experiment_id: number;
  agent_type: "mab" | "linucb" | "qlearning";
  hyperparams_json: string;
  total_episodes: number;
  final_reward: number | null;
}

export interface ExperimentDetail extends Experiment {
  runs: Run[];
}

export interface Episode {
  id: number;
  run_id: number;
  episode_num: number;
  action: number;
  action_name: string;
  reward: number;
  avg_production_rate: number;
  total_accidents: number;
  avg_product_cost: number;
  energy_per_part: number | null;
  epsilon: number | null;
  q_table_size: number | null;
  max_wear_at_maint: number | null;
}

export interface KpiStep {
  step: number;
  total_rate: number;
  product_cost: number;
  num_accidents: number;
  amb_temperature: number | null;
  raw_material_quality: number | null;
  cum_production: number | null;
  cum_energy: number | null;
  cum_cost: number | null;
  curr_power: number | null;
  setpoint_rate: number | null;
  clock: string | null;
  wear_by_workarea: string | null;  // JSON array of 16 doubles (interactive mode)
}

export interface ProgressEvent {
  agentType: string;
  episode: number;
  totalEpisodes: number;
  reward: number;
  status: "progress";
}

/** Live KPI step streamed during interactive experiments */
export interface StepEvent {
  agentType: string;
  episode: number;
  stepIndex: number;
  kpiStep: SimKpiStep;
}

/* ── Fetchers ── */

export async function fetchExperiments(): Promise<Experiment[]> {
  const res = await fetch(`${BASE}/experiments`);
  return res.json();
}

export async function fetchExperiment(id: number): Promise<ExperimentDetail> {
  const res = await fetch(`${BASE}/experiments/${id}`);
  return res.json();
}

export async function fetchEpisodes(runId: number): Promise<Episode[]> {
  const res = await fetch(`${BASE}/experiments/runs/${runId}/episodes`);
  return res.json();
}

export async function fetchKpiSteps(episodeId: number): Promise<KpiStep[]> {
  const res = await fetch(`${BASE}/experiments/episodes/${episodeId}/kpi`);
  return res.json();
}

export async function deleteExperiment(id: number): Promise<void> {
  await fetch(`${BASE}/experiments/${id}`, { method: "DELETE" });
}

export async function createExperiment(config: {
  simSteps: number;
  simSeed: number;
  totalEpisodes: number;
  interactive?: boolean;
  wearRateSpread?: number;
  allowDegenerateWear?: boolean;
  agents: { type: string; hyperparams: Record<string, number> }[];
}): Promise<{ id: number }> {
  const res = await fetch(`${BASE}/experiments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  return res.json();
}

export function startExperimentSSE(
  id: number,
  onProgress: (data: ProgressEvent) => void,
  onDone: () => void,
  onStep?: (data: StepEvent) => void,
): EventSource {
  const es = new EventSource(`${BASE}/experiments/${id}/start`);

  es.addEventListener("progress", (e) => {
    onProgress(JSON.parse(e.data));
  });

  if (onStep) {
    es.addEventListener("step", (e) => {
      onStep(JSON.parse(e.data));
    });
  }

  es.addEventListener("done", () => {
    onDone();
    es.close();
  });

  es.onerror = () => {
    es.close();
  };

  return es;
}

export function exportCsvUrl(experimentId: number): string {
  return `${BASE}/export/${experimentId}/csv`;
}

/** Check whether DB KpiStep rows have the extended columns (v3 migration) */
export function hasFullKpiData(rows: KpiStep[]): boolean {
  if (rows.length === 0) return false;
  const sample = rows[rows.length - 1];
  return sample.cum_production != null && sample.clock != null;
}

/** Convert DB KpiStep rows to SimKpiStep format for the plant visual */
export function kpiStepsToSimSteps(rows: KpiStep[]): SimKpiStep[] {
  return rows.map((r) => {
    let wearByWorkarea: number[] | undefined;
    if (r.wear_by_workarea) {
      try { wearByWorkarea = JSON.parse(r.wear_by_workarea); } catch { /* ignore */ }
    }
    return {
      step: r.step,
      auditDay: 0,
      weekDay: 0,
      clock: r.clock ?? "00:00",
      ambTemperature: r.amb_temperature ?? 20,
      rawMaterialQuality: r.raw_material_quality ?? 0.5,
      currPower: r.curr_power ?? 0,
      totalRate: r.total_rate,
      setpointRate: r.setpoint_rate ?? 0.5,
      cumProduction: r.cum_production ?? 0,
      cumEnergy: r.cum_energy ?? 0,
      cumCost: r.cum_cost ?? 0,
      productEnergy: 0,
      productCost: r.product_cost,
      numberAccidents: r.num_accidents,
      wearByWorkarea,
    };
  });
}

/* ── Headless Simulation ── */

export interface SimKpiStep {
  step: number;
  auditDay: number;
  weekDay: number;
  clock: string;
  ambTemperature: number;
  rawMaterialQuality: number;
  currPower: number;
  totalRate: number;
  setpointRate: number;
  cumProduction: number;
  cumEnergy: number;
  cumCost: number;
  productEnergy: number;
  productCost: number;
  numberAccidents: number;
  wearByWorkarea?: number[];  // 16 values per workarea (interactive mode)
}

export async function runHeadlessSimulation(params: {
  steps: number;
  seed: number;
  setpointRate: number;
}): Promise<SimKpiStep[]> {
  const res = await fetch(`${BASE}/simulations/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? "Simulation failed");
  }
  const data = await res.json();
  return data.kpiSteps;
}
