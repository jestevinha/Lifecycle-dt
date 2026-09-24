import { useCallback, useEffect, useRef, useState } from "react";
import { LearningCurves } from "./panels/LearningCurves";
import { KpiTimeline } from "./panels/KpiTimeline";
import { PolicyChart } from "./panels/PolicyChart";
import { MaintenanceWearChart } from "./panels/MaintenanceWearChart";
import { HeadlessSimulation } from "./panels/HeadlessSimulation";
import { PlantVisualExperiment } from "./panels/PlantVisualExperiment";
import { RunComparison } from "./panels/RunComparison";
import { LiveRun } from "./panels/LiveRun";
import type { RunProgress } from "./panels/LiveRun";
import {
  fetchExperiments,
  fetchExperiment,
  createExperiment,
  deleteExperiment,
  startExperimentSSE,
  exportCsvUrl,
  AGENT_LABELS,
} from "./api";
import type { Experiment, ExperimentDetail, ProgressEvent, SimKpiStep, StepEvent, RewardProfile } from "./api";
import { Chip, SectionLabel, StatusPill, btnDanger, btnPrimary, btnSecondary, inputClass } from "./ui";

const AGENT_TYPES = ["mab", "linucb", "qlearning"] as const;

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

type Tab = "experiments" | "live" | "simulation";

const TABS: { id: Tab; label: string }[] = [
  { id: "experiments", label: "Experiments" },
  { id: "live", label: "Live run" },
  { id: "simulation", label: "Headless simulation" },
];

const PROFILE_NAMES: Record<RewardProfile, string> = {
  balanced: "balanced",
  production: "production",
  efficiency: "efficiency",
};

/** Human-readable config chips for the experiment title row. Tolerates old/partial config_json. */
function configChips(detail: ExperimentDetail): string[] {
  let cfg: Record<string, unknown> = {};
  try { cfg = JSON.parse(detail.config_json) ?? {}; } catch { /* old rows may be malformed */ }
  const chips: string[] = [];
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const episodes = num(cfg.totalEpisodes);
  const steps = num(cfg.simSteps);
  const seed = num(cfg.simSeed);
  const spread = num(cfg.wearRateSpread);
  if (episodes != null) chips.push(`${episodes.toLocaleString()} episodes`);
  if (steps != null) chips.push(`${steps.toLocaleString()} steps / episode`);
  if (seed != null) chips.push(`Seed ${seed}`);
  chips.push(cfg.interactive ? "Interactive" : "Batch");
  if (cfg.perWorkareaMode) chips.push("Per-workarea mode");
  if (spread != null) chips.push(`Wear spread ${spread}`);
  return chips;
}

function formatDate(iso: string): string {
  const d = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <rect x="1" y="1" width="26" height="26" rx="6" fill="#0B4F5C" />
      <rect x="7" y="7" width="6" height="6" rx="1" fill="#fff" />
      <rect x="15" y="7" width="6" height="6" rx="1" fill="#fff" opacity="0.55" />
      <rect x="7" y="15" width="6" height="6" rx="1" fill="#fff" opacity="0.55" />
      <rect x="15" y="15" width="6" height="6" rx="1" fill="#fff" />
    </svg>
  );
}

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
    setTab("live");
    setProgress({});
    setLiveSteps([]);
    setLiveAgent("");
    setLiveEpisode(0);
    liveEpisodeRef.current = { agent: "", episode: -1 };
    loadExperiments();

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
        setTab((t) => (t === "live" ? "experiments" : t));
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

  const profiles = detail
    ? [...new Set(detail.runs.map((r) => PROFILE_NAMES[r.reward_profile ?? "balanced"]))]
    : [];

  return (
    <div className="min-h-screen">
      {/* ── Header ── */}
      <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-10 gap-y-2 px-4 py-2 sm:px-8 lg:h-16 lg:py-0">
          <div className="flex items-center gap-2.5">
            <Logo />
            <div className="flex flex-col leading-tight">
              <span className="text-[15px] font-bold tracking-tight text-ink">Lifecycle DT</span>
              <span className="text-xs text-ink-3">Plant supervision · RL maintenance</span>
            </div>
          </div>

          <nav aria-label="Sections" className="order-last flex w-full gap-6 lg:order-none lg:w-auto lg:flex-1 lg:gap-7">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-current={tab === t.id ? "page" : undefined}
                onClick={() => setTab(t.id)}
                className={`relative flex h-11 items-center gap-2 border-b-2 text-sm transition-colors lg:h-16 ${
                  tab === t.id
                    ? "border-accent font-semibold text-ink"
                    : "border-transparent font-medium text-ink-3 hover:text-ink"
                }`}
              >
                {t.label}
                {t.id === "live" && running && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warn" aria-label="running" />}
              </button>
            ))}
          </nav>

          <div className="flex w-full items-center gap-2.5 sm:ml-auto sm:w-auto">
            {tab !== "simulation" && (
              <>
                <label htmlFor="experiment-select" className="hidden text-xs text-ink-3 md:block">Experiment</label>
                <select
                  id="experiment-select"
                  className={`${inputClass} min-w-0 flex-1 sm:w-[240px] sm:flex-none`}
                  value={experimentId ?? ""}
                  disabled={running}
                  onChange={(e) => {
                    const v = e.target.value;
                    setExperimentId(v ? Number(v) : null);
                    setRefreshKey((k) => k + 1);
                    setTab("experiments");
                  }}
                >
                  <option value="">Select experiment…</option>
                  {experiments.map((exp) => (
                    <option key={exp.id} value={exp.id}>
                      #{exp.id} · {exp.status} · {exp.created_at.slice(0, 16)}
                    </option>
                  ))}
                </select>
              </>
            )}
            <button type="button" className={`${btnPrimary} shrink-0`} onClick={() => setShowModal(true)} disabled={running}>
              Run experiment
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-6 sm:px-8">
        {/* ── Experiments ── */}
        {tab === "experiments" && (
          <>
            {running && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn/30 bg-warn-soft px-5 py-3 text-sm text-ink-2">
                <span>
                  <b className="text-ink">Experiment #{experimentId}</b> is running — results appear here when it finishes.
                </span>
                <button type="button" className={btnSecondary} onClick={() => setTab("live")}>View live run</button>
              </div>
            )}

            {detail && !running && (
              <>
                <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-3">
                      <h1 className="text-[26px] font-bold tracking-tight text-ink">Experiment #{detail.id}</h1>
                      <StatusPill status={detail.status} />
                    </div>
                    <span className="text-[13px] text-ink-2">
                      Started {formatDate(detail.created_at)} · {detail.runs.length} run{detail.runs.length === 1 ? "" : "s"}
                      {profiles.length > 0 && ` · ${profiles.join(" + ")} reward`}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={exportCsvUrl(detail.id)} download className={btnSecondary}>Export CSV</a>
                    <button type="button" className={btnDanger} onClick={() => handleDelete(detail.id)}>Delete</button>
                  </div>
                </div>
                <div className="-mt-1 flex flex-wrap gap-2">
                  {configChips(detail).map((c) => <Chip key={c}>{c}</Chip>)}
                </div>

                {/* 12-column dashboard grid: panels sit side by side on wide screens, stack on narrow ones */}
                <div className="grid grid-cols-12 gap-5" key={refreshKey}>
                  <RunComparison runs={detail.runs} className="col-span-12 xl:col-span-5" />
                  <LearningCurves experimentId={detail.id} className="col-span-12 xl:col-span-7" />

                  <KpiTimeline experimentId={detail.id} />

                  <SectionLabel title="Plant & policy" detail="what the agents chose and how the floor responded" />
                  <PlantVisualExperiment experimentId={detail.id} className="col-span-12 lg:col-span-7" />
                  <div className="col-span-12 flex min-w-0 flex-col gap-5 lg:col-span-5">
                    <PolicyChart experimentId={detail.id} />
                    <MaintenanceWearChart experimentId={detail.id} className="flex-1" />
                  </div>
                </div>
              </>
            )}

            {!detail && !running && (
              <div className="flex flex-col items-center gap-4 rounded-xl border border-line bg-surface px-6 py-16 text-center">
                <p className="text-sm text-ink-2">Select an experiment or run a new one to see results.</p>
                <button type="button" className={btnPrimary} onClick={() => setShowModal(true)}>Run experiment</button>
              </div>
            )}
          </>
        )}

        {/* ── Live run ── */}
        {tab === "live" && (
          running ? (
            <>
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-[26px] font-bold tracking-tight text-ink">Experiment #{experimentId}</h1>
                  <StatusPill status="running" />
                </div>
                <span className="text-[13px] text-ink-2">
                  {liveAgent
                    ? <>Now streaming: <b className="text-ink">{AGENT_LABELS[liveAgent] ?? liveAgent}</b> · episode {liveEpisode + 1}</>
                    : "Starting…"}
                </span>
              </div>
              <LiveRun steps={liveSteps} agent={liveAgent} episode={liveEpisode} progress={progress} />
            </>
          ) : (
            <div className="flex flex-col items-center gap-4 rounded-xl border border-line bg-surface px-6 py-16 text-center">
              <p className="text-sm text-ink-2">No experiment is running. Start one to watch the plant floor live.</p>
              <button type="button" className={btnPrimary} onClick={() => setShowModal(true)}>Run experiment</button>
            </div>
          )
        )}

        {/* ── Headless Simulation ── */}
        {tab === "simulation" && <HeadlessSimulation />}
      </main>

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="run-modal-title"
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2 id="run-modal-title" className="mb-5 text-lg font-semibold text-ink">New experiment</h2>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Sim steps" value={simSteps} onChange={setSimSteps} />
            <Field label="Sim seed" value={simSeed} onChange={setSimSeed} />
            <Field label="Total episodes" value={totalEpisodes} onChange={setTotalEpisodes} />
            <Field
              label="Wear rate spread (0–1, nonzero)"
              value={wearRateSpread}
              onChange={setWearRateSpread}
              step={0.05}
            />
          </div>

          <label className="flex items-center gap-3 text-sm text-ink">
            <input
              type="checkbox"
              checked={interactive}
              onChange={(e) => setInteractive(e.target.checked)}
              className="h-4 w-4 accent-[#0B4F5C]"
            />
            <span>
              Interactive mode
              <span className="ml-1 text-xs text-ink-3">(step-level agent control)</span>
            </span>
          </label>

          <label className={`flex items-center gap-3 text-sm ${interactive ? "text-ink" : "text-ink-3"}`}>
            <input
              type="checkbox"
              checked={perWorkareaMode}
              disabled={!interactive}
              onChange={(e) => setPerWorkareaMode(e.target.checked)}
              className="h-4 w-4 accent-[#0B4F5C] disabled:opacity-50"
            />
            <span>
              Per-workarea rate control
              <span className="ml-1 text-xs text-ink-3">
                (16 decisions/shift, one per workarea{!interactive ? " — requires interactive mode" : ""})
              </span>
            </span>
          </label>

          <div>
            <label htmlFor="reward-goal" className="mb-1.5 block text-sm font-medium text-ink-2">Reward goal</label>
            <select
              id="reward-goal"
              className={`${inputClass} w-full`}
              value={rewardMode}
              onChange={(e) => setRewardMode(e.target.value as RewardMode)}
            >
              <option value="balanced">Balanced (reference weights)</option>
              <option value="production">Production-focused (favor throughput)</option>
              <option value="efficiency">Efficiency-focused (favor low cost/wear)</option>
              <option value="compare">Compare production vs. efficiency (2 runs per agent)</option>
            </select>
            <p className="mt-1.5 text-xs text-ink-3">
              {rewardMode === "compare"
                ? "Each selected agent runs twice — once optimizing for throughput, once for cost/wear — so you can compare how it adapts its goal."
                : "Reweights the same reward terms (throughput, cost, wear) toward this goal; accident/failure penalties stay fixed."}
            </p>
          </div>

          <fieldset>
            <legend className="mb-2 block text-sm font-medium text-ink-2">Agents</legend>
            <div className="flex flex-wrap gap-2">
              {AGENT_TYPES.map((agent) => (
                <label
                  key={agent}
                  className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-line-strong px-3 text-sm text-ink has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
                >
                  <input
                    type="checkbox"
                    checked={selectedAgents.has(agent)}
                    onChange={() => toggle(agent)}
                    className="h-4 w-4 accent-[#0B4F5C]"
                  />
                  {AGENT_LABELS[agent]}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={selectedAgents.size === 0}>
            Start experiment
          </button>
        </div>
      </form>
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
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <input
        type="number"
        step={step}
        className={`${inputClass} tabular w-full font-mono`}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
