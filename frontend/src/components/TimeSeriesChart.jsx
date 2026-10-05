/**
 * TimeSeriesChart - one station, one variable (FR-01, FR-02, FR-07, NFR-05).
 *
 * Bars for accumulations (rainfall), lines for temperature: the variable's
 * default_chart from /api/v1/variables decides, so nothing is hardcoded.
 * How each data-quality state is drawn is decided in utils/series.js.
 */

import { useMemo } from "react";
import { seriesColor } from "../utils/chartTheme";
import { formatDate } from "../utils/dates";
import { stationTraces } from "../utils/series";
import { useColorScheme } from "../utils/useColorScheme";
import PlotlyChart from "./PlotlyChart";

export default function TimeSeriesChart({ data }) {
  const scheme = useColorScheme();
  const { variable, start, end } = data.query;
  const kind = variable.default_chart === "bar" ? "bar" : "line";
  const color = seriesColor(scheme, variable.variable_code);

  const traces = useMemo(
    () => stationTraces(data.records, kind, { unit: variable.unit, color }),
    [data.records, kind, variable.unit, color],
  );
  const layout = useMemo(
    () => ({
      barmode: "overlay",
      yaxis: { title: { text: `${variable.label} (${variable.unit})` }, rangemode: kind === "bar" ? "tozero" : "normal" },
      yaxis2: { overlaying: "y", range: [0, 1], visible: false, fixedrange: true },
    }),
    [variable.label, variable.unit, kind],
  );

  return (
    <PlotlyChart
      traces={traces}
      layout={layout}
      ariaLabel={`${kind === "bar" ? "Bar" : "Line"} chart of ${variable.label.toLowerCase()} in ${variable.unit}, ${formatDate(start)} to ${formatDate(end)}. The same values are in the table below.`}
    />
  );
}
