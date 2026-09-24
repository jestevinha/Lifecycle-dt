import { useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { runHeadlessSimulation } from "../api";
import type { SimKpiStep } from "../api";
import { PlantVisualPanel } from "./PlantVisualPanel";
import { Card, CardMessage, StatTile, btnPrimary, inputClass } from "../ui";
import { CHART } from "../theme";

const METRICS = [
  { key: "totalRate",       label: "Production rate",   color: "#0F766E" },
  { key: "productCost",     label: "Product cost",      color: "#6D28D9" },
  { key: "numberAccidents", label: "Accidents",         color: "#B91C1C" },
  { key: "cumProduction",   label: "Cum. production",   color: "#B45309" },
  { key: "cumEnergy",       label: "Cum. energy",       color: "#1D4ED8" },
  { key: "currPower",       label: "Current power",     color: "#BE185D" },
] as const;

type MetricKey = (typeof METRICS)[number]["key"];

export function HeadlessSimulation() {
  const [steps, setSteps] = useState(200);
  const [seed, setSeed] = useState(42);
  const [setpointRate, setSetpointRate] = useState(0.5);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kpiData, setKpiData] = useState<SimKpiStep[] | null>(null);
  const [visibleMetrics, setVisibleMetrics] = useState<Set<MetricKey>>(
    new Set(["totalRate", "productCost", "numberAccidents"]),
  );

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    try {
      const result = await runHeadlessSimulation({ steps, seed, setpointRate });
      setKpiData(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setKpiData(null);
    } finally {
      setRunning(false);
    }
  };

  const toggleMetric = (key: MetricKey) => {
    setVisibleMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Summary stats from last run
  const summary = kpiData && kpiData.length > 0
    ? {
        avgRate: (kpiData.reduce((s, k) => s + k.totalRate, 0) / kpiData.length).toFixed(3),
        avgCost: (kpiData.reduce((s, k) => s + k.productCost, 0) / kpiData.length).toFixed(3),
        totalAccidents: kpiData[kpiData.length - 1].numberAccidents,
        totalProduction: kpiData[kpiData.length - 1].cumProduction.toFixed(1),
        totalEnergy: kpiData[kpiData.length - 1].cumEnergy.toFixed(1),
      }
    : null;

  return (
    <div className="grid grid-cols-12 gap-5">
      {/* ── Settings + summary ── */}
      <Card className="col-span-12 xl:col-span-4" title="Headless simulation" subtitle="fixed set-point, no agent">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sim-setpoint" className="text-sm font-medium text-ink-2">Set-point rate</label>
            <div className="flex items-center gap-3">
              <input
                id="sim-setpoint"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={setpointRate}
                onChange={(e) => setSetpointRate(Number(e.target.value))}
                className="h-2 flex-1 cursor-pointer accent-[#0B4F5C]"
                disabled={running}
              />
              <input
                type="number"
                aria-label="Set-point rate value"
                min={0}
                max={1}
                step={0.01}
                value={setpointRate}
                onChange={(e) => setSetpointRate(Math.min(1, Math.max(0, Number(e.target.value))))}
                className={`${inputClass} tabular w-20 text-center font-mono`}
                disabled={running}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-2">Steps</span>
              <input
                type="number"
                min={1}
                value={steps}
                onChange={(e) => setSteps(Number(e.target.value))}
                className={`${inputClass} tabular font-mono`}
                disabled={running}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-2">Seed</span>
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value))}
                className={`${inputClass} tabular font-mono`}
                disabled={running}
              />
            </label>
          </div>

          <button type="button" onClick={handleRun} disabled={running} className={btnPrimary}>
            {running ? "Running…" : "Run simulation"}
          </button>

          {error && (
            <div className="rounded-lg border border-crit/30 bg-crit-soft px-3 py-2 text-sm text-crit">{error}</div>
          )}

          {summary && (
            <div className="grid grid-cols-2 gap-2.5 border-t border-grid pt-4">
              <StatTile label="Avg rate" value={summary.avgRate} unit="/ 16" />
              <StatTile label="Avg cost" value={summary.avgCost} unit="EUR/part" />
              <StatTile label="Accidents" value={summary.totalAccidents} tone={summary.totalAccidents > 0 ? "crit" : "ok"} />
              <StatTile label="Production" value={summary.totalProduction} unit="parts" />
              <StatTile label="Energy" value={summary.totalEnergy} />
            </div>
          )}
        </div>
      </Card>

      {/* ── Plant floor ── */}
      <Card className="col-span-12 xl:col-span-8" title="Plant floor" subtitle="step playback">
        {kpiData && kpiData.length > 0 ? (
          <PlantVisualPanel kpiData={kpiData} />
        ) : (
          <CardMessage>
            {running
              ? "Running simulation…"
              : "Choose a set-point rate, steps and seed, then run a headless simulation."}
          </CardMessage>
        )}
      </Card>

      {/* ── Metric charts ── */}
      {kpiData && kpiData.length > 0 && (
        <>
          <div className="col-span-12 flex flex-wrap items-center gap-2" role="group" aria-label="Metrics shown">
            <span className="mr-1 text-xs font-semibold uppercase tracking-[0.06em] text-ink-2">Metrics</span>
            {METRICS.map((m) => (
              <label
                key={m.key}
                className="flex h-8 cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-3 text-xs text-ink-2 has-[:checked]:border-ink-3 has-[:checked]:text-ink"
              >
                <input
                  type="checkbox"
                  checked={visibleMetrics.has(m.key)}
                  onChange={() => toggleMetric(m.key)}
                  className="h-3.5 w-3.5 accent-[#0B4F5C]"
                />
                <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: m.color }} />
                {m.label}
              </label>
            ))}
          </div>
          {METRICS.filter((m) => visibleMetrics.has(m.key)).map((m) => (
            <Card key={m.key} className="col-span-12 md:col-span-6 xl:col-span-4" title={m.label}>
              <ResponsiveContainer width="100%" height={210}>
                <LineChart data={kpiData} margin={{ top: 6, right: 8, bottom: 14, left: 0 }}>
                  <CartesianGrid {...CHART.grid} />
                  <XAxis
                    dataKey="step"
                    {...CHART.axis}
                    minTickGap={40}
                    label={{ value: "Step", position: "insideBottom", offset: -8, ...CHART.axisLabel }}
                  />
                  <YAxis {...CHART.axis} width={48} />
                  <Tooltip
                    {...CHART.tooltip}
                    labelFormatter={(v) => `Step ${v}`}
                    formatter={(value: number) => [Number(value.toFixed(4)), m.label]}
                  />
                  <Line type="monotone" dataKey={m.key} stroke={m.color} dot={false} strokeWidth={2} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
