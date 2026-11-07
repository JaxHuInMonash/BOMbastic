/**
 * CompareRainfallChart - two stations' rainfall as running totals on one mm
 * axis (FR-04). Daily columns from two stations would hide each other; added
 * up, the two lines show which place got more rain and when the gap opened.
 *
 * Same rules as the single-station running total (utils/rainfall.js
 * runningLine): solid for daily readings, dashed for a multi-day total
 * (timing unknown), dotted for days with no reading (nothing added), each in
 * its station's colour. An end label gives each total, withheld below 90%
 * coverage like the summary tiles. The tooltip describes exactly the hovered
 * date for both stations.
 */

import { useMemo } from "react";
import { CHROME, stationColor } from "../utils/chartTheme";
import { addDays, formatDate } from "../utils/dates";
import { describeDay, joinSegments, runningLine } from "../utils/rainfall";
import { useColorScheme } from "../utils/useColorScheme";
import PlotlyChart from "./PlotlyChart";

const MIN_COVERAGE = 0.9;
const mm = (v) => `${Number(v.toFixed(1)).toLocaleString()} mm`;

function stationTraces(side, { days, start, name, color }) {
  const line = runningLine(days, start);
  const label = `${side} · ${name}`;
  const group = side;
  const traces = [
    { type: "scatter", mode: "lines", name: label, legendgroup: group, legendrank: side === "A" ? 1 : 2, ...joinSegments(line.solid), line: { color, width: 2 }, hoverinfo: "skip", connectgaps: false },
  ];
  if (line.dashed.length) {
    traces.push({ type: "scatter", mode: "lines", name: `${side}, multi-day total`, legendgroup: group, showlegend: false, ...joinSegments(line.dashed), line: { color, width: 2, dash: "dash" }, hoverinfo: "skip", connectgaps: false });
  }
  if (line.dotted.length) {
    traces.push({ type: "scatter", mode: "lines", name: `${side}, no reading`, legendgroup: group, showlegend: false, ...joinSegments(line.dotted), line: { color, width: 1.5, dash: "dot" }, opacity: 0.6, hoverinfo: "skip", connectgaps: false });
  }
  return { traces, line, gaps: line.run.filter((r) => r.kind === "gap").length };
}

export default function CompareRainfallChart({ a, b, daysA, daysB }) {
  const scheme = useColorScheme();
  const { start, end } = a.query;
  const colorA = stationColor(scheme, "A");
  const colorB = stationColor(scheme, "B");
  const showA = a.summary.coverage >= MIN_COVERAGE;
  const showB = b.summary.coverage >= MIN_COVERAGE;

  const { traces, lastA, lastB, gapsA, gapsB, hasDashed } = useMemo(() => {
    const ta = stationTraces("A", { days: daysA, start, name: a.query.station.name, color: colorA });
    const tb = stationTraces("B", { days: daysB, start, name: b.query.station.name, color: colorB });
    const key = (c) => `<span style="color:${c}">━</span>`;
    const row = (side, c, name, r, day) => {
      const so = r.total === null ? `${mm(r.from)} → ${mm(r.to)}` : mm(r.total);
      return `${key(c)} ${side} · ${name}: <b>${so} so far</b> · ${describeDay(day).value}`;
    };
    const tips = daysA.map((dayA, i) => [
      row("A", colorA, a.query.station.name, ta.line.run[i], dayA),
      row("B", colorB, b.query.station.name, tb.line.run[i], daysB[i]),
    ].join("<br>"));
    const hover = {
      type: "scatter", mode: "markers", name: "", showlegend: false,
      x: daysA.map((d) => d.date), y: ta.line.hoverY,
      marker: { size: 8, color: "rgba(0,0,0,0)" },
      customdata: tips, hovertemplate: "%{customdata}<extra></extra>",
    };
    return {
      traces: [...tb.traces, ...ta.traces, hover],
      lastA: ta.line.last,
      lastB: tb.line.last,
      gapsA: ta.gaps,
      gapsB: tb.gaps,
      hasDashed: ta.line.dashed.length > 0 || tb.line.dashed.length > 0,
    };
  }, [a, b, daysA, daysB, start, colorA, colorB]);

  const layout = useMemo(() => {
    const ink = CHROME[scheme].ink;
    // End labels just right of each line's end, outside the plot; the higher
    // total nudged up and the lower one down so close totals can't overlap.
    const label = (last, side, c, show, above) => (show ? [{
      x: last.x, y: last.y, xanchor: "left", yanchor: "middle", xshift: 6, yshift: above ? 8 : -8, showarrow: false,
      text: `<span style="color:${c}">${side}</span> <b>${mm(last.y)}</b>`, font: { color: ink, size: 12 },
    }] : []);
    const aAbove = lastA.y >= lastB.y;
    return {
      hovermode: "x",
      margin: { l: 56, r: 96, t: 8, b: 36 },
      xaxis: {
        type: "date", range: [`${addDays(start, -1)} 12:00`, `${end} 12:00`],
        showspikes: true, spikemode: "across", spikesnap: "cursor", spikethickness: 1, spikedash: "solid", spikecolor: CHROME[scheme].axis,
      },
      yaxis: { title: { text: `Rainfall since ${formatDate(start)} (mm)` }, rangemode: "tozero" },
      annotations: [...label(lastA, "A", colorA, showA, aAbove), ...label(lastB, "B", colorB, showB, !aAbove)],
    };
  }, [scheme, start, end, lastA, lastB, colorA, colorB, showA, showB]);

  const notes = [];
  if (hasDashed) notes.push("Dashed stretches are totals over several days: only their ends were measured.");
  for (const [side, gaps, show, cov] of [["A", gapsA, showA, a.summary.coverage], ["B", gapsB, showB, b.summary.coverage]]) {
    if (gaps > 0) {
      notes.push(`${side} has ${gaps.toLocaleString()} ${gaps === 1 ? "day" : "days"} with no reading (dotted), so its real total is probably higher${show ? "" : `; at ${Math.round(cov * 100)}% coverage no total is given`}.`);
    }
  }

  return (
    <>
      <PlotlyChart
        traces={traces}
        layout={layout}
        revision={`${a.query.station.station_id}|${b.query.station.station_id}|rainfall|${start}|${end}`}
        ariaLabel={`Line chart of rainfall added up from ${formatDate(start)} to ${formatDate(end)} at ${a.query.station.name} (A) and ${b.query.station.name} (B), in millimetres. The daily values are in the table below.`}
      />
      {notes.length > 0 && <p className="chart-note">{notes.join(" ")}</p>}
    </>
  );
}
