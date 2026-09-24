import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { fetchExperiment, fetchEpisodes, fetchKpiSteps, runKey, runLabel, runColor } from "../api";
import type { Run, Episode, KpiStep } from "../api";
import { RunLegend } from "./RunLegend";
import { Card, CardMessage, SectionLabel } from "../ui";
import { CHART } from "../theme";

const METRICS = [
  { key: "total_rate", label: "Production rate", unit: "units per step, max 16" },
  { key: "product_cost", label: "Product cost", unit: "EUR per part" },
  { key: "num_accidents", label: "Accidents", unit: "cumulative this episode" },
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

/**
 * Renders a section header plus three cards meant to sit directly inside the
 * page's 12-column grid (each card spans 4 columns on large screens).
 */
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
      if (expRuns.length === 0) { if (!cancelled) { setRuns([]); setLoading(false); } return; }

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

      // Promise.all pushes in completion order — restore the experiment's run order
      // so legend and line colors don't shuffle between loads.
      runsWithData.sort((a, b) => expRuns.indexOf(a) - expRuns.indexOf(b));

      if (runsWithData.length === 0) { setRuns([]); setLoading(false); return; }

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

  const header = (
    <SectionLabel
      title="Shift timeline"
      detail="best episode per run, step by step"
      right={<RunLegend runs={runs} />}
    />
  );

  if (loading || runs.length === 0) {
    return (
      <>
        {header}
        <Card className="col-span-12" title="KPI timeline">
          <CardMessage>
            {loading ? "Loading KPI data…" : "No step-level KPI data stored for this experiment."}
          </CardMessage>
        </Card>
      </>
    );
  }

  return (
    <>
      {header}
      {METRICS.map((m) => (
        <Card key={m.key} className="col-span-12 lg:col-span-4" title={m.label} subtitle={m.unit}>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={dataByMetric[m.key]} margin={{ top: 6, right: 8, bottom: 14, left: 0 }}>
              <CartesianGrid {...CHART.grid} />
              <XAxis
                dataKey="step"
                {...CHART.axis}
                interval={tickInterval(dataByMetric[m.key].length, 5)}
                label={{ value: "Step", position: "insideBottom", offset: -8, ...CHART.axisLabel }}
              />
              <YAxis {...CHART.axis} width={40} />
              <Tooltip
                {...CHART.tooltip}
                labelFormatter={(v) => `Step ${v}`}
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
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </Card>
      ))}
    </>
  );
}
