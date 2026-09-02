/** Raw KPI row emitted by HeadlessMain per simulation step */
export interface KpiStep {
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
  wearByWorkarea?: number[];  // 16 values, one per workarea — only in interactive mode
}

/** Simulation event from events.jsonl */
export interface SimEvent {
  type: string;
  timestampMin: number;
  step?: number;
  payload?: Record<string, unknown>;
}

/** Agent types supported */
export type AgentType = "mab" | "linucb" | "qlearning";

/** Action the agent can choose (maps to setpointRate + maintenance threshold) */
export interface Action {
  id: number;
  name: string;
  setpointRate: number;
  /** Wear fraction at/above which maintenance should fire this shift. Infinity = never. */
  maintenanceThreshold: number;
}

/** State vector for contextual agents */
export interface State {
  ambTemperature: number;
  rawMaterialQuality: number;
  stepNorm: number;
  /**
   * Shift-phase-of-day in {0, 0.5, 1.0} for the three 8h blocks
   * (00:00 / 08:00 / 16:00). Unlike the old within-shift `shiftTimeNorm`
   * (which was always 0 at every shift boundary — the only point the agent
   * observes state — and therefore a dead dimension), this varies across
   * boundaries and carries real signal: the daily temperature cosine peaks at
   * 16:00, driving Unit C power and wear, so the phase the chosen action will
   * govern is genuinely informative.
   */
  shiftPhaseNorm: number;
  numberAccidents: number;
  maxWearFraction?: number;  // max(wearByWorkarea) / WEAR_THRESHOLD (4320) — only in interactive mode
}

/** Episode-level summary */
export interface EpisodeSummary {
  episodeNum: number;
  action: number;
  actionName: string;
  reward: number;
  avgProductionRate: number;
  totalAccidents: number;
  avgProductCost: number;
  energyPerPart?: number;
  epsilon?: number;
  qTableSize?: number;
}

/** Experiment configuration */
export interface ExperimentConfig {
  simSteps: number;
  simSeed: number;
  totalEpisodes: number;
  agents: AgentConfig[];
  interactive?: boolean;    // opt-in step-level IPC mode (default false)
  wearRateSpread?: number;  // [0,1] per-workarea wear multiplier spread; 0 = lockstep (default)
  allowDegenerateWear?: boolean;  // deliberate opt-in to lockstep wear (wearRateSpread=0) for ablation; see validateExperimentConfig
}

export interface AgentConfig {
  type: AgentType;
  hyperparams: Record<string, number>;
}

/** Experiment status */
export type ExperimentStatus = "pending" | "running" | "completed" | "failed";
