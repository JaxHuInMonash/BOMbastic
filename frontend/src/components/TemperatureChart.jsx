/**
 * TemperatureChart - daily line chart for a temperature variable (FR-02, FR-07, NFR-05).
 *
 * The chosen variable is drawn at full strength. The other temperature at the
 * same station (the companion: minimum beside maximum, or the reverse) is drawn
 * lighter on the same °C axis, so the two can be read together. One axis only.
 *
 * Up to LONG_RANGE_DAYS the daily line is the main mark. Beyond that a daily
 * line is too dense to read, so it fades and a 30-day mean is drawn over it;
 * the companion's daily line starts hidden (click its legend entry to show it).
 *
 * How gaps, lone readings and multi-day values are drawn is decided in
 * utils/series.js, and how quality is shown in utils/quality.js; both are
 * tested there. Quality marks follow the chosen variable: days it has no
 * reading get a grey × at the foot of the chart (ranges up to 400 days), and
 * its not-yet-checked readings get a pale band behind them. Hovering shows
 * each line's value and whether BOM has checked it.
 */

import { useMemo } from "react";
import { CHROME, seriesColor } from "../utils/chartTheme";
import { addDays, formatDate } from "../utils/dates";
import {
  dailyValues, describeTemperatureDay, isLongRange, loneDays, MEAN_WINDOW_DAYS, movingMean, multiDayValues,
} from "../utils/series";
import { bandLegend, bandShapes, noReadingDays, unverifiedRuns } from "../utils/quality";
import { classifyDays } from "../utils/rainfall";
import { useColorScheme } from "../utils/useColorScheme";
import PlotlyChart from "./PlotlyChart";

const COMPANION_OPACITY = 0.45;

/** Traces for one variable. `role` is "chosen" or "companion". */
function variableTraces(data, { role, long, color }) {
  const { variable, start, end } = data.query;
  const { variable_code: code } = variable;
  // "Maximum" / "Minimum": the y-axis already says Temperature (°C).
  const label = variable.label.replace(/ temperature$/i, "");
  const chosen = role === "chosen";
  const fade = chosen ? 1 : COMPANION_OPACITY;

  const daily = dailyValues(data.records, start, end);
  const lone = loneDays(daily);
  const multi = multiDayValues(data.records);

  const dailyName = long ? `${label}, daily` : label;
  const dailyGroup = `${code}-daily`;
  // On long ranges the daily line is background texture under the mean.
  const dailyOpacity = long ? 0.28 * fade : fade;
  const dailyVisible = long && !chosen ? "legendonly" : true;

  const traces = [
    {
      type: "scatter",
      mode: "lines",
      name: dailyName,
      legendgroup: dailyGroup,
      x: daily.dates,
      y: daily.values,
      connectgaps: false,
      line: { color, width: long ? 1 : chosen ? 2 : 1.5 },
      opacity: dailyOpacity,
      visible: dailyVisible,
      hoverinfo: "skip",
    },
  ];
  if (lone.dates.length) {
    traces.push({
      type: "scatter",
      mode: "markers",
      name: dailyName,
      legendgroup: dailyGroup,
      showlegend: false,
      x: lone.dates,
      y: lone.values,
      marker: { color, size: long ? 4 : 6 },
      opacity: dailyOpacity,
      visible: dailyVisible,
      hoverinfo: "skip",
    });
  }
  if (long) {
    const mean = movingMean(daily);
    const meanName = `${label}, ${MEAN_WINDOW_DAYS}-day mean`;
    traces.push({
      type: "scatter",
      mode: "lines",
      name: meanName,
      legendgroup: `${code}-mean`,
      x: mean.dates,
      y: mean.values,
      connectgaps: false,
      line: { color, width: 2 },
      opacity: fade,
      hoverinfo: "skip",
    });
  }
  if (multi.dates.length) {
    const multiName = `${label}, covers 2+ days`;
    traces.push({
      type: "scatter",
      mode: "markers",
      name: multiName,
      legendgroup: `${code}-multi`,
      x: multi.dates,
      y: multi.values,
      marker: { symbol: "circle-open", size: 8, color, line: { width: 1.5, color } },
      opacity: fade,
      hoverinfo: "skip",
    });
  }
  return traces;
}

/**
 * The tooltip. One invisible point per day carries every series' line for that
 * day, so hovering any date reports exactly that date: a value and whether BOM
 * has checked it, a multi-day value, or "no reading". (Left to itself, Plotly's
 * unified hover reports a neighbouring day's point when a line has a gap.)
 * The marks themselves don't take part in hover.
 */
function hoverTrace(data, companion, days, long, scheme) {
  const { start, end } = data.query;
  const series = [{ data, days }];
  if (companion) series.push({ data: companion, days: classifyDays(companion.records, start, end) });
  const rows = series.map(({ data: d, days: ds }) => {
    const v = d.query.variable;
    const label = v.label.replace(/ temperature$/i, "");
    const key = `<span style="color:${seriesColor(scheme, v.variable_code)}">━</span>`;
    const mean = long ? movingMean(dailyValues(d.records, start, end)).values : null;
    return ds.map((day, i) => {
      const meanText = mean && mean[i] !== null ? `, ${MEAN_WINDOW_DAYS}-day mean ${mean[i].toFixed(1)} ${v.unit}` : "";
      return `${key} ${label}: <b>${describeTemperatureDay(day, v.unit)}</b>${meanText}`;
    });
  });
  return {
    type: "scatter",
    mode: "markers",
    name: "",
    showlegend: false,
    x: days.map((d) => d.date),
    y: days.map(() => 0.5),
    yaxis: "y2",
    marker: { size: 1, color: "rgba(0,0,0,0)" },
    customdata: days.map((_, i) => rows.map((r) => r[i]).join("<br>")),
    // Rows in the order they are listed: the chosen variable first.
    hovertemplate: `%{customdata}<extra></extra>`,
  };
}

/**
 * data: the chosen variable's /api/v1/observations response.
 * companion: the other temperature's response for the same station and dates,
 * or null. The caller checks it matches; it is never drawn against other dates.
 */
export default function TemperatureChart({ data, companion }) {
  const scheme = useColorScheme();
  const { station, variable, start, end } = data.query;
  const long = isLongRange(start, end);

  const days = useMemo(() => classifyDays(data.records, start, end), [data.records, start, end]);
  const runs = useMemo(() => unverifiedRuns(days), [days]);
  const { band, muted } = CHROME[scheme];

  const traces = useMemo(() => {
    const own = variableTraces(data, { role: "chosen", long, color: seriesColor(scheme, variable.variable_code) });
    const other = companion
      ? variableTraces(companion, { role: "companion", long, color: seriesColor(scheme, companion.query.variable.variable_code) })
      : [];
    const quality = [];
    const gaps = long ? [] : noReadingDays(days);
    if (gaps.length) {
      const name = `No reading (${variable.label.replace(/ temperature$/i, "").toLowerCase()})`;
      quality.push({
        type: "scatter",
        mode: "markers",
        name,
        x: gaps.map((d) => d.date),
        // On a hidden 0-1 axis: the foot of the plot, never a temperature value.
        y: gaps.map(() => 0.03),
        yaxis: "y2",
        marker: { symbol: "x-thin-open", size: 7, color: muted, line: { width: 1.5, color: muted } },
        hoverinfo: "skip",
      });
    }
    if (runs.length) quality.push(bandLegend(band));
    // Companion first so the chosen variable is drawn on top.
    return [...other, ...own, ...quality, hoverTrace(data, companion, days, long, scheme)];
  }, [data, companion, long, scheme, variable.variable_code, variable.label, days, runs, band, muted]);

  const layout = useMemo(
    () => ({
      hovermode: "x unified",
      // Half a day of padding each side so dots on the first and last day aren't cut in half.
      xaxis: { type: "date", hoverformat: "%-d %b %Y", range: [`${addDays(start, -1)} 12:00`, `${end} 12:00`] },
      yaxis: { title: { text: `Temperature (${variable.unit})` } },
      yaxis2: { overlaying: "y", range: [0, 1], visible: false, fixedrange: true },
      shapes: bandShapes(runs, band),
    }),
    [start, end, variable.unit, runs, band],
  );

  const companionLabel = companion ? ` and ${companion.query.variable.label.toLowerCase()}` : "";
  return (
    <PlotlyChart
      traces={traces}
      layout={layout}
      revision={`${station.station_id}|${variable.variable_code}|${start}|${end}`}
      ariaLabel={`Line chart of daily ${variable.label.toLowerCase()}${companionLabel} at ${station.name}, ${formatDate(start)} to ${formatDate(end)}, in ${variable.unit}.${long ? ` A ${MEAN_WINDOW_DAYS}-day mean is drawn over the daily values.` : ""} The exact values are in the table below.`}
    />
  );
}
