/**
 * PlantVisualExperiment.tsx
 * ─────────────────────────────────────────────────────────────────
 * Wrapper around PlantVisualPanel for the experiments tab.
 * Lets the user pick an agent + episode (best/worst/first/last)
 * and shows the animated plant floor for that episode's KPI steps.
 */

import { useEffect, useState } from "react";
import {
  fetchExperiment,
  fetchEpisodes,
  fetchKpiSteps,
  kpiStepsToSimSteps,
  hasFullKpiData,
} from "../api";
import type { Run, Episode, SimKpiStep } from "../api";
import { PlantVisualPanel } from "./PlantVisualPanel";

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

interface Props {
  experimentId: number;
}

export function PlantVisualExperiment({ experimentId }: Props) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<number | null>(null);
  const [kpiData, setKpiData] = useState<SimKpiStep[] | null>(null);
  const [incompleteData, setIncompleteData] = useState(false);
  const [loading, setLoading] = useState(true);

  const selectedRun = runs.find((r) => r.id === selectedRunId);

  // Load runs
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const exp = await fetchExperiment(experimentId);
      if (cancelled) return;
      setRuns(exp.runs ?? []);
      if (exp.runs?.length > 0) {
        setSelectedRunId(exp.runs[0].id);
      } else {
        setSelectedRunId(null);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [experimentId]);

  // Load episodes when run changes
  useEffect(() => {
    if (!selectedRunId) {
      setEpisodes([]);
      setSelectedEpisodeId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const eps = await fetchEpisodes(selectedRunId);
      if (cancelled) return;
      setEpisodes(eps);
      // Auto-select best episode
      if (eps.length > 0) {
        const best = eps.reduce((a, b) => (a.reward >= b.reward ? a : b));
        setSelectedEpisodeId(best.id);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedRunId]);

  // Load KPI steps when episode changes
  useEffect(() => {
    if (!selectedEpisodeId) {
      setKpiData(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const steps = await fetchKpiSteps(selectedEpisodeId);
      if (cancelled) return;
      if (steps.length > 0) {
        setIncompleteData(!hasFullKpiData(steps));
        setKpiData(kpiStepsToSimSteps(steps));
      } else {
        setIncompleteData(false);
        setKpiData(null);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedEpisodeId]);

  if (loading) {
    return (
      <section className="rounded-2xl bg-gray-900 p-6">
        <h2 className="text-lg font-semibold text-gray-100">Plant Visual</h2>
        <p className="mt-4 text-sm text-gray-400">Loading...</p>
      </section>
    );
  }

  if (runs.length === 0) return null;

  const selectedEpisode = episodes.find((e) => e.id === selectedEpisodeId);

  return (
    <section className="rounded-2xl bg-gray-900 p-6">
      <h2 className="mb-4 text-lg font-semibold text-gray-100">
        Plant Visual{" "}
        <span className="text-sm font-normal text-gray-400">
          (episode playback)
        </span>
      </h2>

      {/* Controls: agent + episode selector */}
      <div className="mb-4 flex flex-wrap items-end gap-4">
        {/* Agent selector */}
        <div>
          <label className="mb-1 block text-xs text-gray-400">Agent</label>
          <div className="flex gap-2">
            {runs.map((run) => (
              <button
                key={run.id}
                onClick={() => setSelectedRunId(run.id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  selectedRunId === run.id
                    ? "text-white"
                    : "bg-gray-800 text-gray-400 hover:text-gray-200"
                }`}
                style={
                  selectedRunId === run.id
                    ? { backgroundColor: AGENT_COLORS[run.agent_type] ?? "#888" }
                    : undefined
                }
              >
                {AGENT_LABELS[run.agent_type] ?? run.agent_type}
              </button>
            ))}
          </div>
        </div>

        {/* Episode selector */}
        {episodes.length > 0 && (
          <div>
            <label className="mb-1 block text-xs text-gray-400">Episode</label>
            <select
              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 focus:border-teal-500 focus:outline-none"
              value={selectedEpisodeId ?? ""}
              onChange={(e) => setSelectedEpisodeId(Number(e.target.value))}
            >
              {episodes.map((ep) => {
                const best = episodes.reduce((a, b) => (a.reward >= b.reward ? a : b));
                const worst = episodes.reduce((a, b) => (a.reward <= b.reward ? a : b));
                let tag = "";
                if (ep.id === best.id) tag = " (best)";
                else if (ep.id === worst.id) tag = " (worst)";
                else if (ep.episode_num === 0) tag = " (first)";
                else if (ep.episode_num === episodes.length - 1) tag = " (last)";
                return (
                  <option key={ep.id} value={ep.id}>
                    Ep {ep.episode_num} — R:{ep.reward.toFixed(2)} {ep.action_name}{tag}
                  </option>
                );
              })}
            </select>
          </div>
        )}

        {/* Episode info */}
        {selectedEpisode && (
          <div className="flex gap-4 text-xs text-gray-500">
            <span>
              Reward:{" "}
              <span className="text-gray-300">
                {selectedEpisode.reward.toFixed(3)}
              </span>
            </span>
            <span>
              Action:{" "}
              <span className="text-gray-300">
                {selectedEpisode.action_name}
              </span>
            </span>
            <span>
              Accidents:{" "}
              <span className="text-gray-300">
                {selectedEpisode.total_accidents}
              </span>
            </span>
          </div>
        )}
      </div>

      {/* Incomplete data warning */}
      {incompleteData && (
        <div className="mb-3 rounded-lg border border-amber-800 bg-amber-900/20 px-4 py-2 text-sm text-amber-300">
          This experiment was run before the plant visual was added. Production, energy, power, temperature, and clock data are unavailable.
          Re-run the experiment to get full plant visual data.
        </div>
      )}

      {/* Plant visual */}
      {kpiData && kpiData.length > 0 ? (
        <PlantVisualPanel
          kpiData={kpiData}
          agentName={selectedRun?.agent_type}
          episode={selectedEpisode?.episode_num}
        />
      ) : (
        <div className="rounded-xl bg-gray-800/50 p-8 text-center">
          <p className="text-sm text-gray-400">
            No KPI step data available for this episode.
            {" "}KPI steps are stored for first, last, best, and worst episodes only.
          </p>
        </div>
      )}
    </section>
  );
}
