import { useEffect, useState } from "react";
import { fetchEpisodes, runKey, runLabel, runColor } from "../api";
import type { Episode, Run } from "../api";
import { Card, CardMessage, Swatch } from "../ui";

interface RunStats {
  run: Run;
  meanReward: number;
  meanRate: number;
  meanAccidents: number;
  /** null when no episode in the window recorded energy_per_part */
  meanEnergy: number | null;
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
}

/** Means over the last 50% of episodes — the converged part of training. */
function lastHalfStats(run: Run, episodes: Episode[]): RunStats {
  const tail = episodes.slice(Math.floor(episodes.length / 2));
  const energies = tail.map((e) => e.energy_per_part).filter((v): v is number => v != null);
  return {
    run,
    meanReward: mean(tail.map((e) => e.reward)),
    meanRate: mean(tail.map((e) => e.avg_production_rate)),
    meanAccidents: mean(tail.map((e) => e.total_accidents)),
    meanEnergy: energies.length > 0 ? mean(energies) : null,
  };
}

const fmt = (v: number | null | undefined, digits: number) =>
  v == null || Number.isNaN(v) ? "—" : v.toFixed(digits).replace("-", "−");

type Col = {
  label: string;
  title: string;
  get: (s: RunStats) => number | null;
  digits: number;
  better: "high" | "low";
};

const COLS: Col[] = [
  { label: "Mean reward", title: "Mean reward, last 50% of episodes", get: (s) => s.meanReward, digits: 1, better: "high" },
  { label: "Best", title: "Best single-episode reward", get: (s) => s.run.final_reward, digits: 1, better: "high" },
  { label: "Rate", title: "Mean production rate (units/step, max 16)", get: (s) => s.meanRate, digits: 2, better: "high" },
  { label: "Acc./ep", title: "Mean accidents per episode", get: (s) => s.meanAccidents, digits: 1, better: "low" },
  { label: "kWh/part", title: "Mean energy per part", get: (s) => s.meanEnergy, digits: 2, better: "low" },
];

/** Index of the best run per column, so the table can bold it. */
function bestByCol(stats: RunStats[]): (string | null)[] {
  return COLS.map((col) => {
    let bestKey: string | null = null;
    let bestVal: number | null = null;
    for (const s of stats) {
      const v = col.get(s);
      if (v == null || Number.isNaN(v)) continue;
      if (bestVal == null || (col.better === "high" ? v > bestVal : v < bestVal)) {
        bestVal = v;
        bestKey = runKey(s.run);
      }
    }
    return stats.length > 1 ? bestKey : null;
  });
}

export function RunComparison({ runs, className }: { runs: Run[]; className?: string }) {
  const [stats, setStats] = useState<RunStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const result = await Promise.all(runs.map(async (run) => lastHalfStats(run, await fetchEpisodes(run.id))));
      if (cancelled) return;
      const sortKey = (s: RunStats) => (Number.isNaN(s.meanReward) ? -Infinity : s.meanReward);
      result.sort((a, b) => sortKey(b) - sortKey(a));
      setStats(result);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [runs]);

  const best = bestByCol(stats);
  const leader = stats[0];
  const runnerUp = stats[1];
  const fastest = stats.length > 1
    ? stats.reduce((a, b) => (b.meanRate > a.meanRate ? b : a))
    : undefined;

  return (
    <Card className={className} title="Run comparison" subtitle="last 50% of episodes">
      {loading ? (
        <CardMessage>Loading episodes…</CardMessage>
      ) : stats.length === 0 ? (
        <CardMessage>No runs in this experiment.</CardMessage>
      ) : (
        <>
          {leader && !Number.isNaN(leader.meanReward) && (
            <div className="flex flex-wrap gap-3">
              <div className="flex min-w-[180px] flex-1 flex-col gap-0.5 rounded-lg bg-accent-soft px-4 py-3">
                <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-accent">Best policy</span>
                <span className="text-xl font-bold text-ink">{runLabel(leader.run)}</span>
                <span className="text-xs text-ink-2">
                  Mean reward <b className="tabular font-mono">{fmt(leader.meanReward, 1)}</b>
                  {runnerUp && !Number.isNaN(runnerUp.meanReward) && (
                    <> · next {runLabel(runnerUp.run)} <span className="tabular font-mono">{fmt(runnerUp.meanReward, 1)}</span></>
                  )}
                </span>
              </div>
              {fastest && runKey(fastest.run) !== runKey(leader.run) && (
                <div className="flex min-w-[140px] flex-col gap-0.5 rounded-lg bg-warn-soft px-4 py-3">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-warn">Highest rate</span>
                  <span className="text-xl font-bold text-ink">{runLabel(fastest.run)}</span>
                  <span className="text-xs text-ink-2">
                    <b className="tabular font-mono">{fmt(fastest.meanRate, 2)}</b> / 16 units
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[440px] border-collapse text-sm">
              <thead>
                <tr>
                  <th scope="col" className="pb-2 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-ink-3">Run</th>
                  {COLS.map((c) => (
                    <th key={c.label} scope="col" title={c.title} className="pb-2 pl-3 text-right text-[11px] font-medium uppercase tracking-[0.04em] text-ink-3">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.map((s, i) => (
                  <tr key={runKey(s.run)} className="border-t border-grid">
                    <td className="py-2.5 pr-2">
                      <span className="flex items-center gap-2 font-semibold text-ink">
                        <span className="tabular w-3.5 font-mono text-xs font-normal text-ink-3">{i + 1}</span>
                        <Swatch color={runColor(s.run)} />
                        <span className="truncate">{runLabel(s.run)}</span>
                      </span>
                    </td>
                    {COLS.map((c, ci) => {
                      const isBest = best[ci] === runKey(s.run);
                      return (
                        <td
                          key={c.label}
                          className={`tabular py-2.5 pl-3 text-right font-mono ${isBest ? "font-bold text-ink" : "text-ink-2"}`}
                        >
                          {fmt(c.get(s), c.digits)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-auto text-xs text-ink-3">
            Sorted by mean reward.{stats.length > 1 && " Bold = best in column (lower is better for accidents and kWh/part)."}
          </p>
        </>
      )}
    </Card>
  );
}
