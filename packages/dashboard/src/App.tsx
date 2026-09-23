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
  fetchEpisodes,
  createExperiment,
  deleteExperiment,
  startExperimentSSE,
  exportCsvUrl,
  runLabel,
  runColor,
} from "./api";
import type { Experiment, ExperimentDetail, ProgressEvent, SimKpiStep, StepEvent, RewardProfile } from "./api";

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

/**
 * Reward mode picked in the run modal. "balanced"/"production"/"efficiency" run
 * every selected agent once, under that single reward profile. "compare" runs
 * every selected agent TWICE — once under "production", once under
 * "efficiency" — in the same experiment, so the resulting runs can be
 * compared side by side across all 3 agents × 2 goals.
 */
type RewardMode = "balanced" | "production" | "efficiency" | "compare";

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
  // alpha=5.0 tested 2026-09-20 (see Reward-Function-Evolution.md /
  // Known-Bugs-Fixed) to check whether LinUCB's medium_maint_now lock-in was
  // caused by too-narrow UCB confidence bounds — REFUTED by exp 63 (4000
  // episodes): LinUCB was if anything MORE locked in (400/400 every window)
  // at alpha=5 than at alpha=2.5, so the gap isn't an alpha problem. Reverted.
  linucb: { alpha: 2.5 },
  // qlearning.epsilonMin reverted 0.05→0.01 (2026-09-15). The 0.05 re-test
  // (see prior comment in git history / Experiment-36 vs -53) was motivated
  // by #36's coverage flatlining at 614/1458 states — the hypothesis being
  // that epsilon hit its floor too early to keep discovering states. A
  // controlled same-code, same-seed A/B (epsilonMin 0.01 vs 0.05, 2000
  // episodes each, otherwise identical) falsified that: coverage moved only
  // 616→622 states (+1.0%), with 0.01-only and 0.05-only visiting
  // near-disjoint single-digit extra states — i.e. both floors plateau at
  // essentially the same ceiling. Meanwhile last-100-episode reward was
  // WORSE at 0.05 (-253.5) than 0.01 (-246.8): the extra floor buys almost
  // no new coverage but taxes exploitation once mostly converged. Root
  // cause of the coverage ceiling is the discretization itself (only 2 of
  // 6 dimensions — wear, accidents — are action-influenced; the other 4
  // get sampled "for free" every shift regardless of epsilon), not the
  // exploration rate — see state-space fixes under consideration.
  // qlearning.useConstantAlpha=0 (2026-09-17): switched the default update rule
  // from constant-α=0.1 to decaying α_t=α_0/(1+visitCount(s,a)), mirroring MAB's
  // useConstantAlpha convention. Motivated by the exp-54 metric-corrected
  // comparison (mean of last 500 episodes, not max-over-run): Q-learning trailed
  // LinUCB only because "Best Reward" rewards variance, and Q-learning's own
  // trajectory showed it never settling (reward dipped to -257.6 at ep~999 then
  // recovered to -143.8 by ep~1999, well after the table saturated at 109 states
  // around ep~500) — a symptom of constant-α never converging to a fixed point.
  // Set to 1 to revert to constant-α for comparison.
  //
  // "state-space fixes under consideration" (line 59 above) resolved 2026-09-19:
  // exp 55/56 showed the table-based discretization itself (not epsilon, not the
  // learning rate) was the ceiling — disjoint cells can't share experience, so
  // even a converged table kept oscillating shift-to-shift on state changes with
  // no real predictive difference (49 rate changes in its own best episode vs.
  // LinUCB's 3), eating a disproportionate share of the reward's summed accident
  // penalty. qlearning.ts now uses linear function approximation (shared weights
  // per action, same features as LinUCB) instead of a discretized table — see
  // 04-Experiments/Qlearning-Linear-Approximation.md in the vault.
  //
  // useConstantAlpha reverted to 1 (2026-09-19, later still — exp 57): the ported
  // decaying-α scheme divides by a PER-ACTION update count, which made sense when
  // that count was split across 540 disjoint table cells (each cell could only
  // accumulate a small share of total updates). With only 10 shared actions, one
  // action can absorb thousands of updates within the first few dozen episodes —
  // exp 57 confirmed `very_low_no_maint` was already dominant by episode 60,
  // freezing its learning rate to ~0.00002 while epsilon was still ~0.55. Because
  // argmax reinforces whichever action currently looks best, and being selected
  // more shrinks that SAME action's own learning rate fastest, the model locked
  // onto an early, bad, undertrained estimate ("never maintain") and could never
  // correct it — reward plateaued at -290 to -380 for the entire back 700 episodes,
  // far worse than the tabular version. Constant-α avoids this: the weights keep
  // responding to evidence regardless of how often an action is picked, same
  // reasoning already established for MAB's own useConstantAlpha=1 choice. See
  // 04-Experiments/Qlearning-Linear-Approximation.md for the full diagnosis.
  // alpha lowered 0.1→0.02 (2026-09-20, exp 65): with parameter sharing across
  // actions (see Parameter-Sharing-Across-Actions.md), the maintainNow×wear
  // interaction is now a SINGLE shared coefficient controlling maintenance
  // timing for every action at once, instead of being buried separately in
  // each action's own row. Constant-α=0.1 never decays, so it kept nudging
  // that one coefficient by noisy TD errors well past convergence — exp 65
  // showed wear-at-maintenance genuinely drop and reward genuinely improve
  // together for episodes 0-500 (78.6%→35.2% wear, -249.9→-102.5 reward),
  // plateau correctly for 500-1000, then keep drifting (35%-43%, both
  // directions) for the rest of a 2000-episode run with reward getting
  // WORSE, not better — noise, not further learning. A smaller constant-α
  // should still move fast early (still constant, not decaying-by-count,
  // which bug #17/#57 already ruled out) but perturb the converged shared
  // coefficient less once it's found a good answer.
  // alpha lowered again 0.02→0.002 (2026-09-21, exp 71, per-workarea mode):
  // per-workarea mode makes 16 selectAction/update decisions per shift into
  // the SAME shared model, instead of 1 — the effective perturbation rate
  // per shift is ~16× what α=0.02 was stabilized against. Exp 71 showed
  // Q-Learning converge correctly and track LinUCB closely for episodes
  // 0-600 (reward -179→-102.7 together, failures→0), then diverge — not
  // oscillate, actively worsen — from episode 800 onward (reward -139.7→
  // -221.7, failures 3.87→12.35, stdev 20→97), with very_high_maint_now (a
  // high-accident action) creeping in more each window. Likely compounded by
  // per-workarea mode's shared-reward credit assignment: all 16 workareas'
  // decisions this shift are trained on the same pooled reward regardless of
  // whether each one's own maintainNow request actually won the 1-per-shift
  // arbitration, so the maintainNow×wear coefficient gets noisier as more
  // workareas compete for that slot — worse as training progresses, matching
  // the escalating (not flat) shape of the divergence. See
  // Per-Workarea-Rate-Control.md in the vault. Not yet verified.
  qlearning: { alpha: 0.002, gamma: 0.95, epsilon: 1.0, epsilonDecay: 0.99, epsilonMin: 0.01, useConstantAlpha: 1 },
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
  const [meanRewardLastHalf, setMeanRewardLastHalf] = useState<Record<number, number>>({});
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

  // Compute mean reward over the last 50% of episodes, per run
  useEffect(() => {
    if (!detail) { setMeanRewardLastHalf({}); return; }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        detail.runs.map(async (run) => {
          const episodes = await fetchEpisodes(run.id);
          const start = Math.floor(episodes.length / 2);
          const lastHalf = episodes.slice(start);
          const mean = lastHalf.length > 0
            ? lastHalf.reduce((sum, e) => sum + e.reward, 0) / lastHalf.length
            : NaN;
          return [run.id, mean] as const;
        }),
      );
      if (!cancelled) setMeanRewardLastHalf(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [detail]);

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
    perWorkareaMode: boolean;
    agents: string[];
    rewardMode: RewardMode;
  }) => {
    setShowModal(false);

    // "compare" fans each selected agent out into two runs (production +
    // efficiency) so all 3 agents' behavior under both goals shows up in one
    // experiment; the other modes run each agent once under a single profile.
    const profiles: (RewardProfile | undefined)[] =
      config.rewardMode === "compare"
        ? ["production", "efficiency"]
        : [config.rewardMode === "balanced" ? undefined : config.rewardMode];

    const agentConfigs = config.agents.flatMap((type) =>
      profiles.map((rewardProfile) => ({
        type,
        hyperparams: { ...(AGENT_DEFAULTS[type] ?? {}) },
        rewardProfile,
      })),
    );

    const { id } = await createExperiment({
      simSteps: config.simSteps,
      simSeed: config.simSeed,
      totalEpisodes: config.totalEpisodes,
      interactive: config.interactive || undefined,
      wearRateSpread: config.wearRateSpread,
      perWorkareaMode: config.perWorkareaMode || undefined,
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
            <>
              <div className="mb-4 grid grid-cols-3 gap-4">
                <StatCard label="Experiment" value={`#${detail.id}`} />
                <StatCard label="Date" value={detail.created_at.slice(0, 10)} />
                <StatCard
                  label="Total Episodes"
                  value={String(Math.max(...detail.runs.map((r) => r.total_episodes), 0))}
                />
              </div>

              {/* Per-run reward table — a grid of StatCards doesn't scale once
                  an experiment has more than a couple of runs (e.g. 3 agents ×
                  2 reward profiles = 6 runs, 12 reward cards): labels wrap and
                  cards overflow their grid cell. A table scales to any number
                  of runs without wrapping. */}
              <div className="mb-6 overflow-x-auto rounded-2xl bg-gray-900 p-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400">
                      <th className="pb-2 pr-4 font-medium">Run</th>
                      <th className="pb-2 pr-4 font-medium">Best Reward</th>
                      <th className="pb-2 font-medium">Mean Reward (last 50%)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.runs.map((run) => {
                      const mean = meanRewardLastHalf[run.id];
                      return (
                        <tr key={run.id} className="border-t border-gray-800">
                          <td className="py-2 pr-4">
                            <span className="flex items-center gap-2">
                              <span
                                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: runColor(run) }}
                              />
                              <span className="text-gray-200">{runLabel(run)}</span>
                            </span>
                          </td>
                          <td className="py-2 pr-4 font-medium" style={{ color: runColor(run) }}>
                            {run.final_reward != null ? run.final_reward.toFixed(2) : "—"}
                          </td>
                          <td className="py-2 font-medium" style={{ color: runColor(run) }}>
                            {mean != null && !Number.isNaN(mean) ? mean.toFixed(2) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
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
    perWorkareaMode: boolean;
    agents: string[];
    rewardMode: RewardMode;
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
  // Per-workarea rate control (2026-09-20, selectable so the current
  // plant-wide-rate mode stays available for comparison — see
  // Parameter-Sharing-Across-Actions.md in the vault). Off by default: it's
  // the new, less-tested mode, and requires interactive mode.
  const [perWorkareaMode, setPerWorkareaMode] = useState(false);
  const [rewardMode, setRewardMode] = useState<RewardMode>("balanced");
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
      perWorkareaMode: interactive && perWorkareaMode,
      agents: [...selectedAgents],
      rewardMode,
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

          <label className={`flex items-center gap-3 text-sm ${interactive ? "text-gray-200" : "text-gray-500"}`}>
            <input
              type="checkbox"
              checked={perWorkareaMode}
              disabled={!interactive}
              onChange={(e) => setPerWorkareaMode(e.target.checked)}
              className="rounded border-gray-600 bg-gray-800 accent-teal-500 disabled:opacity-50"
            />
            <span>
              Per-workarea rate control
              <span className="ml-1 text-xs text-gray-400">
                (16 decisions/shift, one per workarea{!interactive ? " — requires interactive mode" : ""})
              </span>
            </span>
          </label>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-300">Reward Goal</label>
            <select
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-teal-500 focus:outline-none"
              value={rewardMode}
              onChange={(e) => setRewardMode(e.target.value as RewardMode)}
            >
              <option value="balanced">Balanced (reference weights)</option>
              <option value="production">Production-focused (favor throughput)</option>
              <option value="efficiency">Efficiency-focused (favor low cost/wear)</option>
              <option value="compare">Compare production vs. efficiency (2 runs per agent)</option>
            </select>
            <p className="mt-1 text-xs text-gray-400">
              {rewardMode === "compare"
                ? "Each selected agent runs twice — once optimizing for throughput, once for cost/wear — so you can compare how it adapts its goal."
                : "Reweights the same reward terms (throughput, cost, wear) toward this goal; accident/failure penalties stay fixed."}
            </p>
          </div>

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
