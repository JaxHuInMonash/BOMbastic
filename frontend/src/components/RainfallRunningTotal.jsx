/**
 * RainfallRunningTotal - measured rainfall added up from the first day of the
 * range (FR-02, NFR-05). The "Running total" option of the rainfall chart.
 *
 *   solid line     daily readings, added day by day
 *   dashed line    a multi-day total: a straight line from the total before the
 *                  span to the total after it. Only the two ends are measured;
 *                  the straight line claims nothing about when the rain fell
 *   grey dotted    days with no reading: nothing is added, so the line stays
 *                  level, but the real total is probably higher
 *   grey ×         those same days, on the baseline
 *
 *   pale band      days BOM hasn't quality-checked yet (utils/quality.js)
 *
 * One y-axis, one meaning: millimetres since the start of the range. Every
 * day has a tooltip (an invisible point per day is the hover target).
 */

import { useMemo } from "react";
import { CHROME, seriesColor } from "../utils/chartTheme";
import { addDays, formatDate } from "../utils/dates";
import { describeRunning, runningTotal } from "../utils/rainfall";
import { isLongRange } from "../utils/series";
import { bandLegend, bandShapes, unverifiedRuns } from "../utils/quality";
import { useColorScheme } from "../utils/useColorScheme";
import PlotlyChart from "./PlotlyChart";

/**
 * Segments of one kind as a single trace. Touching segments are merged into
 * one polyline (a run of dry days is one flat line, not 100 tiny pieces);
 * separate runs are split with null so Plotly leaves a gap between them.
 */
function segments(pairs) {
  const x = [];
  const y = [];
  let end = null;
  for (const [a, b] of pairs) {
    if (end !== a) {
      if (x.length) x.push(null), y.push(null);
      x.push(a.x), y.push(a.y);
    }
    x.push(b.x), y.push(b.y);
    end = b;
  }
  return { x, y };
}

/** Same rule as the summary tiles (report D-A): no total is stated below 90% coverage. */
const MIN_COVERAGE = 0.9;

export default function RainfallRunningTotal({ days, start, end, coverage, revision, ariaLabel }) {
  const scheme = useColorScheme();
  const color = seriesColor(scheme, "rainfall");
  const { muted, band } = CHROME[scheme];
  const runs = useMemo(() => unverifiedRuns(days), [days]);

  const { traces, last, gapDays } = useMemo(() => {
    const run = runningTotal(days);
    // Known points: the start (0 mm, the evening before the first day) and every day whose total is known.
    let prev = { x: addDays(start, -1), y: 0 };
    const solid = [];
    const dashed = [];
    const dotted = [];
    const hoverY = new Array(run.length);
    for (let i = 0; i < run.length; i += 1) {
      const r = run[i];
      if (r.total === null) continue;
      const point = { x: r.date, y: r.total };
      (r.kind === "multi" ? dashed : r.kind === "gap" ? dotted : solid).push([prev, point]);
      prev = point;
    }
    // Hover anchors sit on the line, inside a dashed span too (position only;
    // the tooltip says the timing there is unknown).
    for (let i = 0; i < run.length;) {
      if (run[i].total !== null) {
        hoverY[i] = run[i].total;
        i += 1;
      } else {
        let j = i;
        while (j < run.length - 1 && run[j].total === null) j += 1;
        const { from, to } = run[i];
        const n = j - i + 1;
        for (let k = i; k < j; k += 1) hoverY[k] = from + ((to - from) * (k - i + 1)) / n;
        i = j;
      }
    }
    const tips = run.map((r, i) => {
      const t = describeRunning(r, days[i]);
      return `<b>${t.total}</b><br>${t.detail}<br>${t.status}`;
    });
    const gaps = run.filter((r) => r.kind === "gap");

    const out = [];
    const s = segments(solid);
    out.push({ type: "scatter", mode: "lines", name: "Measured total", ...s, line: { color, width: 2 }, hoverinfo: "skip", connectgaps: false });
    if (dashed.length) {
      out.push({ type: "scatter", mode: "lines", name: "Multi-day total (timing unknown)", ...segments(dashed), line: { color, width: 2, dash: "dash" }, hoverinfo: "skip", connectgaps: false });
    }
    if (dotted.length) {
      // Crosses on the baseline only on short ranges; over years they merge into a grey bar.
      const crosses = !isLongRange(start, end);
      out.push({ type: "scatter", mode: "lines", name: "No reading (nothing added)", ...segments(dotted), line: { color: muted, width: 1.5, dash: "dot" }, hoverinfo: "skip", connectgaps: false });
      if (crosses) out.push({
        type: "scatter", mode: "markers", name: "No reading", showlegend: false,
        x: gaps.map((g) => g.date), y: gaps.map(() => 0), cliponaxis: false, hoverinfo: "skip",
        marker: { symbol: "x-thin-open", size: 7, color: muted, line: { width: 1.5, color: muted } },
      });
    }
    if (runs.length) out.push(bandLegend(band));
    out.push({
      type: "scatter", mode: "markers", name: "", showlegend: false,
      x: run.map((r) => r.date), y: hoverY,
      marker: { size: 8, color: "rgba(0,0,0,0)" },
      customdata: tips, hovertemplate: "%{customdata}<extra></extra>",
    });
    return { traces: out, last: prev, gapDays: gaps.length };
  }, [days, start, end, color, muted, runs, band]);
  const stateTotal = coverage >= MIN_COVERAGE;

  const layout = useMemo(
    () => ({
      hovermode: "x",
      xaxis: {
        type: "date",
        range: [`${addDays(start, -1)} 12:00`, `${end} 12:00`],
        showspikes: true, spikemode: "across", spikesnap: "cursor", spikethickness: 1, spikedash: "solid",
        spikecolor: CHROME[scheme].axis,
      },
      yaxis: { title: { text: `Rainfall since ${formatDate(start)} (mm)` }, rangemode: "tozero" },
      legend: { orientation: "h", x: 0, y: 1.02, yanchor: "bottom" },
      // Pale band behind days BOM hasn't quality-checked yet (utils/quality.js).
      shapes: bandShapes(runs, CHROME[scheme].band),
      // Direct label at the end of the line: the number the reader came for.
      annotations: stateTotal ? [{
        x: last.x, y: last.y, xanchor: "right", yanchor: "bottom", showarrow: false,
        text: `<b>${Number(last.y.toFixed(1))} mm</b> measured`, font: { color: CHROME[scheme].ink, size: 12 },
      }] : [],
    }),
    [start, end, scheme, last, stateTotal, runs],
  );

  return (
    <>
      <PlotlyChart traces={traces} layout={layout} revision={revision} ariaLabel={ariaLabel} />
      {gapDays > 0 && (
        <p className="chart-note">
          {gapDays.toLocaleString()} {gapDays === 1 ? "day has" : "days have"} no reading, so nothing is added for {gapDays === 1 ? "it" : "them"}: the real total is probably higher than shown.
          {!stateTotal && ` Only ${Math.round(coverage * 100)}% of days have a value, so no total is given (a total needs 90%, as in the summary below).`}
        </p>
      )}
    </>
  );
}
