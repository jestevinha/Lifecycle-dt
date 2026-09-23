import { runKey, runLabel, runColor } from "../api";
import type { Run } from "../api";

/**
 * Shared legend row for panels comparing multiple runs. Recharts' built-in
 * <Legend> lives INSIDE the chart's reserved vertical space, so once an
 * experiment has more runs than fit on one line (e.g. 3 agents × 2 reward
 * profiles = 6), the wrapped legend text overflows that space and overlaps
 * the plotted data. Rendering the legend as normal block content above the
 * chart instead means it just pushes the chart down when it wraps, never
 * overlaps it — and rendering it once per section (not once per sub-chart)
 * avoids repeating the same wrapped block 3x in panels like KpiTimeline.
 */
export function RunLegend({ runs }: { runs: Run[] }) {
  if (runs.length === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
      {runs.map((run) => (
        <span key={runKey(run)} className="flex items-center gap-1.5 text-xs text-gray-300">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: runColor(run) }}
          />
          {runLabel(run)}
        </span>
      ))}
    </div>
  );
}
