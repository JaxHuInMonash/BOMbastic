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
 * utils/series.js and tested there.
 */

import { useMemo } from "react";
import { seriesColor } from "../utils/chartTheme";
import { addDays, formatDate } from "../utils/dates";
import {
  dailyValues, isLongRange, loneDays, MEAN_WINDOW_DAYS, movingMean, multiDayValues,
} from "../utils/series";
import { useColorScheme } from "../utils/useColorScheme";
import PlotlyChart from "./PlotlyChart";

const COMPANION_OPACITY = 0.45;

/** Traces for one variable. `role` is "chosen" or "companion". */
function variableTraces(data, { role, long, color }) {
  const { variable, start, end } = data.query;
  const { unit, variable_code: code } = variable;
  // "Maximum" / "Minimum": the y-axis already says Temperature (°C).
  const label = variable.label.replace(/ temperature$/i, "");
  const chosen = role === "chosen";
  const fade = chosen ? 1 : COMPANION_OPACITY;
  const value = `%{y:.1f} ${unit}`;

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
      hovertemplate: `${value}<extra>${dailyName}</extra>`,
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
      hovertemplate: `${value}<extra>${dailyName}</extra>`,
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
      hovertemplate: `${value}<extra>${meanName}</extra>`,
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
      customdata: multi.spans,
      marker: { symbol: "circle-open", size: 8, color, line: { width: 1.5, color } },
      opacity: fade,
      hovertemplate: `${value} over the %{customdata} days to this date<extra>${multiName}</extra>`,
    });
  }
  return traces;
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

  const traces = useMemo(() => {
    const own = variableTraces(data, { role: "chosen", long, color: seriesColor(scheme, variable.variable_code) });
    if (!companion) return own;
    const other = variableTraces(companion, {
      role: "companion",
      long,
      color: seriesColor(scheme, companion.query.variable.variable_code),
    });
    // Companion first so the chosen variable is drawn on top.
    return [...other, ...own];
  }, [data, companion, long, scheme, variable.variable_code]);

  const layout = useMemo(
    () => ({
      hovermode: "x unified",
      // Half a day of padding each side so dots on the first and last day aren't cut in half.
      xaxis: { type: "date", hoverformat: "%-d %b %Y", range: [`${addDays(start, -1)} 12:00`, `${end} 12:00`] },
      yaxis: { title: { text: `Temperature (${variable.unit})` } },
    }),
    [start, end, variable.unit],
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
