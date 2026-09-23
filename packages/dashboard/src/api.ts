const BASE = "/api";

/* ── Types ── */

export interface Experiment {
  id: number;
  created_at: string;
  config_json: string;
  status: "pending" | "running" | "completed" | "failed";
}

export type RewardProfile = "balanced" | "production" | "efficiency";

export interface Run {
  id: number;
  experiment_id: number;
  agent_type: "mab" | "linucb" | "qlearning";
  hyperparams_json: string;
  total_episodes: number;
  final_reward: number | null;
  /** NULL on rows written before this column existed — treat as "balanced". */
  reward_profile: RewardProfile | null;
}

const AGENT_LABELS: Record<string, string> = {
  mab: "MAB",
  linucb: "LinUCB",
  qlearning: "Q-Learning",
};

const PROFILE_LABELS: Record<RewardProfile, string> = {
  balanced: "Balanced",
  production: "Prod",
  efficiency: "Eff",
};

/**
 * Stable per-run dictionary key. An experiment can now hold more than one run
 * for the same agent_type (e.g. mab/production + mab/efficiency, from the
 * "compare" reward mode) — panels that used to key their per-agent data by
 * bare agent_type would silently overwrite one run's data with another's.
 * Always key by this instead of `run.agent_type`.
 */
export function runKey(run: Run): string {
  return `${run.agent_type}:${run.reward_profile ?? "balanced"}`;
}

/** Human-readable legend/label for a run — includes the profile only when it's non-default. */
export function runLabel(run: Run): string {
  const agent = AGENT_LABELS[run.agent_type] ?? run.agent_type;
  const profile = run.reward_profile ?? "balanced";
  return profile === "balanced" ? agent : `${agent} (${PROFILE_LABELS[profile]})`;
}

/**
 * Color per run, keyed the same way as runKey(). Same base hue per agent
 * (matches the historical AGENT_COLORS), shaded lighter for "production" and
 * darker for "efficiency" so agent×profile combos stay visually distinct
 * without agents losing their established identity color.
 */
export const RUN_COLORS: Record<string, string> = {
  "mab:balanced": "#0D9488",
  "mab:production": "#2DD4BF",
  "mab:efficiency": "#065F46",
  "linucb:balanced": "#7C3AED",
  "linucb:production": "#C4B5FD",
  "linucb:efficiency": "#4C1D95",
  "qlearning:balanced": "#E11D48",
  "qlearning:production": "#FB7185",
  "qlearning:efficiency": "#881337",
};

export function runColor(run: Run): string {
  return RUN_COLORS[runKey(run)] ?? "#888";
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
  perWorkareaMode?: boolean;
  agents: { type: string; hyperparams: Record<string, number>; rewardProfile?: RewardProfile }[];
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
