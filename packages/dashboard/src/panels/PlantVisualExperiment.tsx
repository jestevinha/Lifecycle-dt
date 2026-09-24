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
  runLabel,
} from "../api";
import type { Run, Episode, SimKpiStep } from "../api";
import { PlantVisualPanel } from "./PlantVisualPanel";
import { Card, CardMessage, selectSmClass } from "../ui";

interface Props {
  experimentId: number;
  className?: string;
}

export function PlantVisualExperiment({ experimentId, className }: Props) {
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

  const selectedEpisode = episodes.find((e) => e.id === selectedEpisodeId);
  const best = episodes.length > 0 ? episodes.reduce((a, b) => (a.reward >= b.reward ? a : b)) : undefined;
  const worst = episodes.length > 0 ? episodes.reduce((a, b) => (a.reward <= b.reward ? a : b)) : undefined;

  return (
    <Card
      className={className}
      title="Plant floor"
      subtitle="episode playback"
      actions={
        runs.length > 0 && (
          <>
            <select
              aria-label="Run shown on plant floor"
              className={selectSmClass}
              value={selectedRunId ?? ""}
              onChange={(e) => setSelectedRunId(Number(e.target.value))}
            >
              {runs.map((run) => (
                <option key={run.id} value={run.id}>{runLabel(run)}</option>
              ))}
            </select>
            {episodes.length > 0 && (
              <select
                aria-label="Episode"
                className={`${selectSmClass} max-w-[190px]`}
                value={selectedEpisodeId ?? ""}
                onChange={(e) => setSelectedEpisodeId(Number(e.target.value))}
              >
                {episodes.map((ep) => {
                  let tag = "";
                  if (ep.id === best?.id) tag = " (best)";
                  else if (ep.id === worst?.id) tag = " (worst)";
                  else if (ep.episode_num === 0) tag = " (first)";
                  else if (ep.episode_num === episodes.length - 1) tag = " (last)";
                  return (
                    <option key={ep.id} value={ep.id}>
                      Ep {ep.episode_num}{tag} — R {ep.reward.toFixed(1)}
                    </option>
                  );
                })}
              </select>
            )}
          </>
        )
      }
    >
      {loading ? (
        <CardMessage>Loading…</CardMessage>
      ) : runs.length === 0 ? (
        <CardMessage>No runs in this experiment.</CardMessage>
      ) : (
        <>
          {selectedEpisode && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
              <span>Reward <b className="tabular font-mono text-ink">{selectedEpisode.reward.toFixed(2)}</b></span>
              <span>Action <b className="font-mono text-ink">{selectedEpisode.action_name}</b></span>
              <span>Accidents <b className="tabular font-mono text-ink">{selectedEpisode.total_accidents}</b></span>
            </div>
          )}

          {incompleteData && (
            <div className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn">
              This experiment predates the plant visual: production, energy, power, temperature and clock
              data are unavailable. Re-run it to get full plant data.
            </div>
          )}

          {kpiData && kpiData.length > 0 ? (
            <PlantVisualPanel
              kpiData={kpiData}
              agentName={selectedRun?.agent_type}
              episode={selectedEpisode?.episode_num}
              compact
            />
          ) : (
            <CardMessage>
              No step data for this episode. KPI steps are stored for the first, last, best and worst
              episodes only.
            </CardMessage>
          )}
        </>
      )}
    </Card>
  );
}
