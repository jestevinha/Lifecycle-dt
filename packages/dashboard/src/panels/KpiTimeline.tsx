import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { fetchExperiment, fetchEpisodes, fetchKpiSteps, runKey, runLabel, runColor } from "../api";
import type { Run, Episode, KpiStep } from "../api";
import { RunLegend } from "./RunLegend";

const METRICS = [
  { key: "total_rate", label: "Production Rate" },
  { key: "product_cost", label: "Product Cost" },
  { key: "num_accidents", label: "Accidents" },
] as const;

type MetricKey = (typeof METRICS)[number]["key"];

interface ChartPoint {
  step: number;
  [key: string]: number;
}

/**
 * Recharts' XAxis `interval` prop was hardcoded to 19 (show every 20th tick),
 * which is fine for a few hundred steps but produces 40+ crammed, overlapping
 * labels on a long run (simSteps=800+) squeezed into a third-width chart.
 * Pick the skip count dynamically so roughly `targetTicks` labels are shown
 * regardless of how many steps the episode has.
 */
function tickInterval(dataLength: number, targetTicks = 7): number {
  if (dataLength <= targetTicks) return 0;
  return Math.ceil(dataLength / targetTicks) - 1;
}

export function KpiTimeline({ experimentId }: { experimentId: number }) {
  const [dataByMetric, setDataByMetric] = useState<Record<MetricKey, ChartPoint[]>>({
    total_rate: [],
    product_cost: [],
    num_accidents: [],
  });
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const exp = await fetchExperiment(experimentId);
      const expRuns: Run[] = exp.runs ?? [];
      if (expRuns.length === 0) { setLoading(false); return; }

      const runsWithData: Run[] = [];
      const kpiByRun: Record<string, KpiStep[]> = {};

      await Promise.all(
        expRuns.map(async (run) => {
          const episodes: Episode[] = await fetchEpisodes(run.id);
          if (episodes.length === 0) return;

          // Best episode by reward
          const bestEp = episodes.reduce((a, b) => (a.reward >= b.reward ? a : b));
          const kpi = await fetchKpiSteps(bestEp.id);
          if (kpi.length > 0) {
            runsWithData.push(run);
            kpiByRun[runKey(run)] = kpi;
          }
        }),
      );

      if (cancelled) return;

      if (runsWithData.length === 0) { setLoading(false); return; }

      const maxStep = Math.max(
        ...Object.values(kpiByRun).map((k) => k.length),
      );

      const result: Record<MetricKey, ChartPoint[]> = {
        total_rate: [],
        product_cost: [],
        num_accidents: [],
      };

      for (let i = 0; i < maxStep; i++) {
        for (const m of METRICS) {
          const point: ChartPoint = { step: i };
          for (const run of runsWithData) {
            const key = runKey(run);
            const row = kpiByRun[key]?.[i];
            point[key] = row ? row[m.key] : 0;
          }
          result[m.key].push(point);
        }
      }

      setRuns(runsWithData);
      setDataByMetric(result);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [experimentId]);

  if (loading) {
    return (
      <section className="rounded-2xl bg-gray-900 p-6">
        <h2 className="text-lg font-semibold text-gray-100">KPI Timeline</h2>
        <p className="mt-4 text-sm text-gray-400">Loading KPI data...</p>
      </section>
    );
  }

  if (runs.length === 0) return null;

  return (
    <section className="rounded-2xl bg-gray-900 p-6">
      <h2 className="mb-2 text-lg font-semibold text-gray-100">
        KPI Timeline <span className="text-sm font-normal text-gray-400">(best episode per agent)</span>
      </h2>
      <RunLegend runs={runs} />
      <div className="grid gap-6 lg:grid-cols-3">
        {METRICS.map((m) => (
          <div key={m.key}>
            <h3 className="mb-2 text-sm font-medium text-gray-300">{m.label}</h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={dataByMetric[m.key]} margin={{ top: 5, right: 10, bottom: 20, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="step"
                  stroke="#9CA3AF"
                  interval={tickInterval(dataByMetric[m.key].length)}
                  label={{ value: "Step", position: "insideBottom", offset: -10, fill: "#9CA3AF", fontSize: 11 }}
                  tick={{ fontSize: 10 }}
                />
                <YAxis stroke="#9CA3AF" tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1F2937", border: "1px solid #374151", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#D1D5DB" }}
                  formatter={(value: number) => Number(value.toFixed(2))}
                />
                {runs.map((run) => (
                  <Line
                    key={runKey(run)}
                    type="monotone"
                    dataKey={runKey(run)}
                    name={runLabel(run)}
                    stroke={runColor(run)}
                    dot={false}
                    strokeWidth={2}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>
    </section>
  );
}
