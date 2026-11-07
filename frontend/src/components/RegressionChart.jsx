/**
 * RegressionChart - scatterplot, fitted line and residual plot (FR-05).
 *
 * Top panel: one dot per paired day, the fitted line drawn across the range of
 * x it was fitted on (never extended beyond it), and the equation with R² and n.
 * A filled dot means both readings are quality-checked; a hollow dot means at
 * least one isn't yet. Bottom panel: residuals (y − fitted) against the same x
 * axis, around a zero line, so a curve or a fan shape that a straight line
 * misses is visible. The panels share x, so zooming one zooms both.
 *
 * Every dot has a tooltip: the date, both values, the fitted value, the
 * residual and whether BOM has checked the readings.
 */

import { useMemo } from "react";
import { CHROME, stationColor } from "../utils/chartTheme";
import { formatDate } from "../utils/dates";
import { equationText, sig } from "../utils/regression";
import { useColorScheme } from "../utils/useColorScheme";
import PlotlyChart from "./PlotlyChart";

const STATUS = { observed: "checked", unverified: "not yet checked", interpolated: "interpolated" };

export default function RegressionChart({ data }) {
  const scheme = useColorScheme();
  const { x, y, station, start, end } = data.query;
  const { model, points } = data;
  const color = stationColor(scheme, "A");

  const traces = useMemo(() => {
    const c = CHROME[scheme];
    // Dense scatters (years of days) fade so overlaps read as darker areas.
    const opacity = points.length > 1500 ? 0.35 : points.length > 400 ? 0.55 : 0.8;
    const checked = (p) => p.x_quality === "observed" && p.y_quality === "observed";
    const tip = (p) => [
      `<b>${formatDate(p.date)}</b>`,
      `${x.label}: ${p.x} ${x.unit} · ${STATUS[p.x_quality]}`,
      `${y.label}: ${p.y} ${y.unit} · ${STATUS[p.y_quality]}`,
      `Fitted: ${p.fitted.toFixed(1)} ${y.unit} · residual ${p.residual >= 0 ? "+" : "−"}${Math.abs(p.residual).toFixed(1)} ${y.unit}`,
    ].join("<br>");
    const group = (keep, name, hollow) => {
      const ps = points.filter(keep);
      if (!ps.length) return [];
      const marker = hollow
        ? { symbol: "circle-open", size: 6, color, line: { width: 1.2, color } }
        : { symbol: "circle", size: 5, color };
      return [
        { type: "scatter", mode: "markers", name, legendgroup: name, x: ps.map((p) => p.x), y: ps.map((p) => p.y), marker, opacity, customdata: ps.map(tip), hovertemplate: "%{customdata}<extra></extra>" },
        { type: "scatter", mode: "markers", name, legendgroup: name, showlegend: false, xaxis: "x", yaxis: "y2", x: ps.map((p) => p.x), y: ps.map((p) => p.residual), marker, opacity, customdata: ps.map(tip), hovertemplate: "%{customdata}<extra></extra>" },
      ];
    };
    return [
      ...group(checked, "Both readings quality-checked", false),
      ...group((p) => !checked(p), "At least one not yet checked", true),
      {
        type: "scatter", mode: "lines", name: "Fitted line",
        x: [model.x_min, model.x_max],
        y: [model.intercept + model.slope * model.x_min, model.intercept + model.slope * model.x_max],
        line: { color: c.ink, width: 2 }, hoverinfo: "skip",
      },
    ];
  }, [points, model, x, y, color, scheme]);

  const layout = useMemo(() => {
    const c = CHROME[scheme];
    const axis = { gridcolor: c.grid, linecolor: c.axis, tickfont: { color: c.muted }, automargin: true };
    const r2 = model.r_squared === null ? "R² undefined" : `R² = ${model.r_squared.toFixed(3)}`;
    return {
      hovermode: "closest",
      xaxis: { title: { text: `${x.label} (${x.unit})` }, zeroline: false, anchor: "y2" },
      yaxis: { domain: [0.34, 1], title: { text: `${y.label} (${y.unit})` }, zeroline: false },
      yaxis2: {
        ...axis, domain: [0, 0.24], title: { text: `Residual (${y.unit})`, font: { color: c.ink2 } },
        zeroline: true, zerolinecolor: c.ink2, zerolinewidth: 1,
      },
      annotations: [{
        xref: "paper", yref: "paper", x: 0.01, y: 0.99, xanchor: "left", yanchor: "top", showarrow: false, align: "left",
        text: `<b>${equationText(model, x, y)}</b><br>${r2} · n = ${model.n.toLocaleString()} days`,
        bgcolor: c.surface, bordercolor: c.axis, borderpad: 5, font: { color: c.ink, size: 12 },
      }],
    };
  }, [model, x, y, scheme]);

  return (
    <PlotlyChart
      traces={traces}
      layout={layout}
      height={500}
      revision={`${station.station_id}|${x.variable_code}|${y.variable_code}|${start}|${end}|${data.query.quality_policy}`}
      ariaLabel={`Scatterplot of daily ${y.label.toLowerCase()} against ${x.label.toLowerCase()} at ${station.name}, ${formatDate(start)} to ${formatDate(end)}, ${model.n} days, with a fitted line: ${equationText(model, x, y)}, slope ${sig(model.slope)}${model.r_squared === null ? "" : `, R squared ${model.r_squared.toFixed(3)}`}. Residuals are plotted underneath. The paired values are in the table below.`}
    />
  );
}
