import { useCallback, useEffect, useRef, useState } from "react";
import { LearningCurves } from "./panels/LearningCurves";
import { KpiTimeline } from "./panels/KpiTimeline";
import { PolicyChart } from "./panels/PolicyChart";
import { MaintenanceWearChart } from "./panels/MaintenanceWearChart";
import { HeadlessSimulation } from "./panels/HeadlessSimulation";
import { PlantVisualExperiment } from "./panels/PlantVisualExperiment";
import { PlantVisualPanel } from "./panels/PlantVisualPanel";
import {
  fetchExperiments,
  fetchExperiment,
  createExperiment,
  deleteExperiment,
  startExperimentSSE,
  exportCsvUrl,
} from "./api";
import type { Experiment, ExperimentDetail, ProgressEvent, SimKpiStep, StepEvent } from "./api";

const AGENT_TYPES = ["mab", "linucb", "qlearning"] as const;
const AGENT_LABELS: Record<string, string> = {
  mab: "MAB",
  linucb: "LinUCB",
  qlearning: "Q-Learning",
};
const AGENT_COLORS: Record<string, string> = {
  mab: "#0D9488",
  linucb: "#7C3AED",
  qlearning: "#E11D48",
};

// Explicit per-agent hyperparams. Sent on every run so the API-layer
// validateExperimentConfig gate never sees an empty MAB hyperparams object, and so
// no agent silently falls back to a constructor default. MAB values are the confirmed
// F=50 schedule (epsilonDecay=0.01^(1/50)=0.91201, NOT the 0.91 constructor default);
// LinUCB/Q-Learning mirror their current constructor defaults.
// MAB: useConstantAlpha=1 (true) + alpha=0.1 decided 2026-09-05 for the final reference
// run — a deliberate, config-only choice over the sample-average default (analysis
// recommended sample-average; João chose constant-alpha anyway). See
// 04-Experiments/MAB-Update-Rule-Decision.md and 03-Agents/MAB-Agent.md. Encoded as
// numeric 1 rather than boolean true to keep this object's Record<string, number> type.
const AGENT_DEFAULTS: Record<string, Record<string, number>> = {
  mab: { epsilon: 1.0, epsilonDecay: 0.91201, epsilonMin: 0.01, useConstantAlpha: 1, alpha: 0.1 },
  linucb: { alpha: 2.5 },
  // qlearning.epsilonMin raised 0.01→0.05 (2026-09-12, Known-Bugs-Fixed #16-followup /
  // Experiment-36-Results.md): with epsilonDecay=0.99, epsilon hits its floor around
  // episode 458 of 1000, after which exploration is only ~1% of shift-decisions —
  // far too sparse to keep discovering new states in the 1,458-state (3^5×6) table.
  // #36's own q_table_size growth curve shows coverage essentially flatlining by
  // episode ~900 (614/1458, ~42%). A floor of 0.05 was tried and reverted once before
  // ("prevented convergence" — see project history), but that was under the OLD
  // 243-state/10-action table (2,430 values); the table is now 1,458×20=29,160 values,
  // 12× larger, so revisiting the same floor value is an informed re-test given the
  // redesign, not a blind repeat of a already-rejected setting. Decay left at 0.99
  // (same shape, higher floor) so this is a single, isolated, testable change.
  qlearning: { alpha: 0.1, gamma: 0.95, epsilon: 1.0, epsilonDecay: 0.99, epsilonMin: 0.05 },
};

// Default per-workarea wear-rate spread. Must be nonzero (in (0,1]) or the gate rejects
// the run as lockstep-wear degenerate; 0.2 matches the seed-diagnostic probes.
const DEFAULT_WEAR_RATE_SPREAD = 0.2;

interface RunProgress {
  episode: number;
  totalEpisodes: number;
}

type Tab = "experiments" | "simulation";

export function App() {
  const [tab, setTab] = useState<Tab>("experiments");
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [experimentId, setExperimentId] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Record<string, RunProgress>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [detail, setDetail] = useState<ExperimentDetail | null>(null);
  const esRef = useRef<EventSource | null>(null);

  // Live plant visual state
  const [liveSteps, setLiveSteps] = useState<SimKpiStep[]>([]);
  const [liveAgent, setLiveAgent] = useState<string>("");
  const [liveEpisode, setLiveEpisode] = useState<number>(0);
  const liveEpisodeRef = useRef<{ agent: string; episode: number }>({ agent: "", episode: -1 });

  // Load experiments list
  const loadExperiments = useCallback(async () => {
    const list = await fetchExperiments();
    setExperiments(list);
  }, []);

  useEffect(() => {
    loadExperiments();
  }, [loadExperiments]);

  // Load experiment detail when selection changes
  useEffect(() => {
    if (experimentId == null) { setDetail(null); return; }
    let cancelled = false;
    fetchExperiment(experimentId).then((d) => { if (!cancelled) setDetail(d); });
    return () => { cancelled = true; };
  }, [experimentId, refreshKey]);

  // Clean up SSE on unmount
  useEffect(() => {
    return () => esRef.current?.close();
  }, []);

  const handleDelete = async (id: number) => {
    const ok = window.confirm(
      `Delete experiment #${id} and all its runs, episodes, and KPI steps?\n\nThis cannot be undone.`,
    );
    if (!ok) return;
    await deleteExperiment(id);
    if (experimentId === id) {
      setExperimentId(null);
      setDetail(null);
    }
    loadExperiments();
  };

  const handleRun = async (config: {
    simSteps: number;
    simSeed: number;
    totalEpisodes: number;
    interactive: boolean;
    wearRateSpread: number;
    agents: string[];
  }) => {
    setShowModal(false);

    const agentConfigs = config.agents.map((type) => ({
      type,
      hyperparams: { ...(AGENT_DEFAULTS[type] ?? {}) },
    }));

    const { id } = await createExperiment({
      simSteps: config.simSteps,
      simSeed: config.simSeed,
      totalEpisodes: config.totalEpisodes,
      interactive: config.interactive || undefined,
      wearRateSpread: config.wearRateSpread,
      agents: agentConfigs,
    });

    setExperimentId(id);
    setRunning(true);
    setProgress({});
    setLiveSteps([]);
    setLiveAgent("");
    setLiveEpisode(0);
    liveEpisodeRef.current = { agent: "", episode: -1 };

    esRef.current?.close();
    esRef.current = startExperimentSSE(
      id,
      (data: ProgressEvent) => {
        setProgress((prev) => ({
          ...prev,
          [data.agentType]: {
            episode: data.episode,
            totalEpisodes: data.totalEpisodes,
          },
        }));
      },
      () => {
        setRunning(false);
        setRefreshKey((k) => k + 1);
        loadExperiments();
      },
      (data: StepEvent) => {
        const ref = liveEpisodeRef.current;
        // New episode or agent — reset accumulated steps
        if (data.agentType !== ref.agent || data.episode !== ref.episode) {
          liveEpisodeRef.current = { agent: data.agentType, episode: data.episode };
          setLiveSteps([data.kpiStep]);
          setLiveAgent(data.agentType);
          setLiveEpisode(data.episode);
        } else {
          setLiveSteps((prev) => [...prev, data.kpiStep]);
        }
      },
    );
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 font-sans">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-white">
          Digital Twin &mdash; RL Dashboard
        </h1>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex items-center gap-6 border-b border-gray-700">
        <button
          className={`pb-2 text-sm font-medium transition-colors ${
            tab === "experiments"
              ? "border-b-2 border-teal-500 text-teal-400"
              : "text-gray-400 hover:text-gray-200"
          }`}
          onClick={() => setTab("experiments")}
        >
          RL Experiments
        </button>
        <button
          className={`pb-2 text-sm font-medium transition-colors ${
            tab === "simulation"
              ? "border-b-2 border-teal-500 text-teal-400"
              : "text-gray-400 hover:text-gray-200"
          }`}
          onClick={() => setTab("simulation")}
        >
          Headless Simulation
        </button>
      </div>

      {tab === "experiments" && (
        <div className="mb-8 flex flex-wrap items-center gap-3">
          {/* Experiment Selector */}
          <select
            className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-teal-500 focus:outline-none"
            value={experimentId ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setExperimentId(v ? Number(v) : null);
              setRefreshKey((k) => k + 1);
            }}
          >
            <option value="">Select experiment...</option>
            {experiments.map((exp) => (
              <option key={exp.id} value={exp.id}>
                #{exp.id} &mdash; {exp.status} ({exp.created_at.slice(0, 16)})
              </option>
            ))}
          </select>

          {/* Run New Experiment */}
          <button
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
            onClick={() => setShowModal(true)}
            disabled={running}
          >
            Run New Experiment
          </button>

          {/* Export CSV */}
          {experimentId && !running && (
            <a
              href={exportCsvUrl(experimentId)}
              download
              className="rounded-lg border border-gray-600 px-4 py-2 text-sm text-gray-300 hover:border-gray-400 hover:text-white"
            >
              Export CSV
            </a>
          )}

          {/* Delete Experiment */}
          {experimentId && !running && (
            <button
              className="rounded-lg border border-red-800 px-4 py-2 text-sm text-red-400 hover:border-red-600 hover:bg-red-900/30 hover:text-red-300"
              onClick={() => handleDelete(experimentId)}
            >
              Delete
            </button>
          )}
        </div>
      )}

      {/* ── Experiments Tab ── */}
      {tab === "experiments" && (
        <>
          {/* Live Plant Visual + Progress */}
          {running && (
            <div className="mb-8 space-y-4">
              {/* Live plant floor */}
              {liveSteps.length > 0 && (
                <PlantVisualPanel
                  kpiData={liveSteps}
                  agentName={liveAgent}
                  episode={liveEpisode}
                  live
                />
              )}

              {/* Compact progress bars */}
              <div className="rounded-2xl bg-gray-900 p-4">
                <div className="mb-2 flex items-center gap-3">
                  <h2 className="text-sm font-semibold text-gray-100">Progress</h2>
                  {liveAgent && (
                    <span className="text-xs text-gray-400">
                      {AGENT_LABELS[liveAgent] ?? liveAgent} &middot; Episode {liveEpisode + 1} &middot; Step {liveSteps.length}
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  {Object.entries(progress).map(([agent, p]) => {
                    const pct = p.totalEpisodes > 0 ? (p.episode / p.totalEpisodes) * 100 : 0;
                    return (
                      <div key={agent}>
                        <div className="mb-1 flex justify-between text-xs">
                          <span className="font-medium" style={{ color: AGENT_COLORS[agent] }}>
                            {AGENT_LABELS[agent] ?? agent}
                          </span>
                          <span className="text-gray-400">
                            {p.episode}/{p.totalEpisodes}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-gray-700">
                          <div
                            className="h-full rounded-full transition-all duration-200"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: AGENT_COLORS[agent] ?? "#888",
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {Object.keys(progress).length === 0 && (
                    <p className="text-xs text-gray-400">Waiting for first progress event...</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Summary Stats */}
          {detail && !running && (
            <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
              <StatCard
                label="Experiment"
                value={`#${detail.id}`}
              />
              <StatCard
                label="Date"
                value={detail.created_at.slice(0, 10)}
              />
              <StatCard
                label="Total Episodes"
                value={String(Math.max(...detail.runs.map((r) => r.total_episodes), 0))}
              />
              {detail.runs.map((run) => (
                <StatCard
                  key={run.id}
                  label={`Best Reward (${AGENT_LABELS[run.agent_type] ?? run.agent_type})`}
                  value={run.final_reward != null ? run.final_reward.toFixed(2) : "—"}
                  color={AGENT_COLORS[run.agent_type]}
                />
              ))}
            </div>
          )}

          {/* Panels */}
          {experimentId != null && !running ? (
            <div className="grid gap-6" key={refreshKey}>
              <PlantVisualExperiment experimentId={experimentId} />
              <LearningCurves experimentId={experimentId} />
              <KpiTimeline experimentId={experimentId} />
              <PolicyChart experimentId={experimentId} />
              <MaintenanceWearChart experimentId={experimentId} />
            </div>
          ) : (
            !running && (
              <div className="rounded-2xl bg-gray-900 p-12 text-center">
                <p className="text-gray-400">
                  Select an experiment or run a new one to see results.
                </p>
              </div>
            )
          )}
        </>
      )}

      {/* ── Headless Simulation Tab ── */}
      {tab === "simulation" && <HeadlessSimulation />}

      {/* Modal */}
      {showModal && <RunModal onClose={() => setShowModal(false)} onSubmit={handleRun} />}
    </div>
  );
}

/* ── Run Modal ── */

function RunModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (config: {
    simSteps: number;
    simSeed: number;
    totalEpisodes: number;
    interactive: boolean;
    wearRateSpread: number;
    agents: string[];
  }) => void;
}) {
  // Reference config, decided 2026-09-06: simSteps=800 (100 shifts) so an episode
  // spans multiple full wear/maintenance cycles, matching the thesis's actual
  // "lifecycle management" framing rather than ~1 cycle per episode. See
  // 04-Experiments/SimSteps-Horizon-Decision.md in the vault. totalEpisodes=1000
  // and wearRateSpread match #30/#31/#33; interactive defaults on since batch mode
  // is not valid for the thesis comparison (see Known-Bugs-Fixed bug #10).
  const [simSteps, setSimSteps] = useState(800);
  const [simSeed, setSimSeed] = useState(42);
  const [totalEpisodes, setTotalEpisodes] = useState(1000);
  const [interactive, setInteractive] = useState(true);
  const [wearRateSpread, setWearRateSpread] = useState(DEFAULT_WEAR_RATE_SPREAD);
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(
    new Set(AGENT_TYPES),
  );

  const toggle = (agent: string) => {
    setSelectedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agent)) next.delete(agent);
      else next.add(agent);
      return next;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedAgents.size === 0) return;
    onSubmit({
      simSteps,
      simSeed,
      totalEpisodes,
      interactive,
      wearRateSpread,
      agents: [...selectedAgents],
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <form
        className="w-full max-w-md rounded-2xl bg-gray-900 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2 className="mb-5 text-lg font-semibold text-white">New Experiment</h2>

        <div className="space-y-4">
          <Field label="Sim Steps" value={simSteps} onChange={setSimSteps} />
          <Field label="Sim Seed" value={simSeed} onChange={setSimSeed} />
          <Field label="Total Episodes" value={totalEpisodes} onChange={setTotalEpisodes} />
          <Field
            label="Wear Rate Spread (0–1, nonzero)"
            value={wearRateSpread}
            onChange={setWearRateSpread}
            step={0.05}
          />

          <label className="flex items-center gap-3 text-sm text-gray-200">
            <input
              type="checkbox"
              checked={interactive}
              onChange={(e) => setInteractive(e.target.checked)}
              className="rounded border-gray-600 bg-gray-800 accent-teal-500"
            />
            <span>
              Interactive mode
              <span className="ml-1 text-xs text-gray-400">(step-level agent control)</span>
            </span>
          </label>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-300">Agents</label>
            <div className="flex gap-4">
              {AGENT_TYPES.map((agent) => (
                <label key={agent} className="flex items-center gap-2 text-sm text-gray-200">
                  <input
                    type="checkbox"
                    checked={selectedAgents.has(agent)}
                    onChange={() => toggle(agent)}
                    className="rounded border-gray-600 bg-gray-800 accent-teal-500"
                  />
                  {AGENT_LABELS[agent]}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            className="rounded-lg border border-gray-600 px-4 py-2 text-sm text-gray-300 hover:border-gray-400"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
            disabled={selectedAgents.size === 0}
          >
            Start
          </button>
        </div>
      </form>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl bg-gray-900 px-4 py-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="mt-1 text-lg font-semibold" style={color ? { color } : { color: "#F3F4F6" }}>
        {value}
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-300">{label}</label>
      <input
        type="number"
        step={step}
        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-teal-500 focus:outline-none"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
