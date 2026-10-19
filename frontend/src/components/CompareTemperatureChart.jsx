/**
 * CompareTemperatureChart - two stations, one temperature variable (FR-04).
 *
 * Top panel: both stations' daily lines on one °C axis, A blue and B orange,
 * with the same rules as the single-station chart (gaps never joined, a lone
 * reading drawn as a dot, ranges over 400 days fade the daily line under a
 * 30-day mean). Bottom panel: A − B per day, in A's colour where A was
 * warmer and B's where B was, only on days both stations measured.
 *
 * One figure with two panels sharing the date axis, so zooming one zooms both.
 * They are separate panels with their own axes, not two scales on one plot.
 * The tooltip describes exactly the hovered date for both stations.
 */

import { useMemo } from "react";
import { CHROME, stationColor } from "../utils/chartTheme";
import { addDays, formatDate } from "../utils/dates";
import { differences } from "../utils/compare";
import { dailyValues, describeTemperatureDay, isLongRange, loneDays, MEAN_WINDOW_DAYS, movingMean } from "../utils/series";
import { useColorScheme } from "../utils/useColorScheme";
import PlotlyChart from "./PlotlyChart";

const fmt = (v, unit) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)} ${unit}`;

function stationTraces(side, { data, color, long }) {
  const { start, end } = data.query;
  // A listed before B in the legend, whatever the drawing order.
  const legendrank = side === "A" ? 1 : 2;
  const name = `${side} · ${data.query.station.name}`;
  const daily = dailyValues(data.records, start, end);
  const lone = loneDays(daily);
  const traces = [
    {
      type: "scatter", mode: "lines", name: long ? `${name}, daily` : name, legendgroup: `${side}-daily`, legendrank,
      x: daily.dates, y: daily.values, connectgaps: false, hoverinfo: "skip",
      line: { color, width: long ? 1 : 1.75 }, opacity: long ? 0.28 : 1,
    },
  ];
  if (lone.dates.length) {
    traces.push({
      type: "scatter", mode: "markers", name, legendgroup: `${side}-daily`, showlegend: false,
      x: lone.dates, y: lone.values, hoverinfo: "skip", marker: { color, size: long ? 4 : 6 }, opacity: long ? 0.28 : 1,
    });
  }
  const mean = long ? movingMean(daily) : null;
  if (mean) {
    traces.push({
      type: "scatter", mode: "lines", name: `${name}, ${MEAN_WINDOW_DAYS}-day mean`, legendgroup: `${side}-mean`, legendrank,
      x: mean.dates, y: mean.values, connectgaps: false, hoverinfo: "skip", line: { color, width: 2 },
    });
  }
  return { traces, mean: mean ? mean.values : null };
}

export default function CompareTemperatureChart({ a, b, daysA, daysB }) {
  const scheme = useColorScheme();
  const { start, end, variable } = a.query;
  const unit = variable.unit;
  const long = isLongRange(start, end);
  const colorA = stationColor(scheme, "A");
  const colorB = stationColor(scheme, "B");

  const traces = useMemo(() => {
    const ta = stationTraces("A", { data: a, color: colorA, long });
    const tb = stationTraces("B", { data: b, color: colorB, long });
    const diff = differences(daysA, daysB);
    const diffMean = long ? movingMean(diff).values : null;

    const out = [...tb.traces, ...ta.traces];
    out.push({
      type: "bar", name: "A − B", showlegend: false, xaxis: "x", yaxis: "y3",
      x: diff.dates, y: diff.values,
      marker: { color: diff.values.map((d) => (d === null ? "rgba(0,0,0,0)" : d >= 0 ? colorA : colorB)) },
      opacity: long ? 0.35 : 0.85, hoverinfo: "skip",
    });
    if (long) {
      out.push({
        type: "scatter", mode: "lines", name: `A − B, ${MEAN_WINDOW_DAYS}-day mean`, showlegend: false, yaxis: "y3",
        x: diff.dates, y: diffMean, connectgaps: false, hoverinfo: "skip", line: { color: CHROME[scheme].ink2, width: 1.5 },
      });
    }

    // One tooltip per day: both stations and the difference, for exactly that date.
    const labelA = a.query.station.name;
    const labelB = b.query.station.name;
    const key = (c) => `<span style="color:${c}">━</span>`;
    const tips = daysA.map((dayA, i) => {
      const dayB = daysB[i];
      const meanA = ta.mean && ta.mean[i] !== null ? `, ${MEAN_WINDOW_DAYS}-day mean ${ta.mean[i].toFixed(1)} ${unit}` : "";
      const meanB = tb.mean && tb.mean[i] !== null ? `, ${MEAN_WINDOW_DAYS}-day mean ${tb.mean[i].toFixed(1)} ${unit}` : "";
      const d = diff.values[i];
      const diffLine = d === null ? "A − B: not both measured" : `A − B: <b>${fmt(d, unit)}</b>`;
      return [
        `${key(colorA)} A · ${labelA}: <b>${describeTemperatureDay(dayA, unit)}</b>${meanA}`,
        `${key(colorB)} B · ${labelB}: <b>${describeTemperatureDay(dayB, unit)}</b>${meanB}`,
        diffLine,
      ].join("<br>");
    });
    out.push({
      type: "scatter", mode: "markers", name: "", showlegend: false, yaxis: "y2",
      x: daysA.map((x) => x.date), y: daysA.map(() => 0.5),
      marker: { size: 1, color: "rgba(0,0,0,0)" },
      customdata: tips, hovertemplate: "%{customdata}<extra></extra>",
    });
    return out;
  }, [a, b, daysA, daysB, colorA, colorB, long, scheme, unit]);

  const layout = useMemo(() => {
    const c = CHROME[scheme];
    const axis = { gridcolor: c.grid, linecolor: c.axis, zeroline: false, tickfont: { color: c.muted }, automargin: true };
    return {
      hovermode: "x unified",
      xaxis: {
        type: "date", hoverformat: "%-d %b %Y", anchor: "y3",
        range: [`${addDays(start, -1)} 12:00`, `${end} 12:00`],
      },
      yaxis: { domain: [0.36, 1], title: { text: `${variable.label} (${unit})` } },
      yaxis2: { domain: [0.36, 1], overlaying: "y", range: [0, 1], visible: false, fixedrange: true },
      yaxis3: {
        ...axis, domain: [0, 0.27], title: { text: `A − B (${unit})`, font: { color: c.ink2 } },
        zeroline: true, zerolinecolor: c.axis, zerolinewidth: 1,
      },
      bargap: 0,
    };
  }, [scheme, start, end, variable.label, unit]);

  return (
    <PlotlyChart
      traces={traces}
      layout={layout}
      height={460}
      revision={`${a.query.station.station_id}|${b.query.station.station_id}|${variable.variable_code}|${start}|${end}`}
      ariaLabel={`Line chart comparing daily ${variable.label.toLowerCase()} at ${a.query.station.name} (A) and ${b.query.station.name} (B), ${formatDate(start)} to ${formatDate(end)}, with the daily difference A minus B underneath. The values are in the table below.`}
    />
  );
}
