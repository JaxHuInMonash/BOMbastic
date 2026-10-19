
/**
 * Seasonal + Trend Regression Chart
 *
 * Top: observed monthly values and fitted seasonal curve.
 * Bottom: residuals (observed minus fitted).
 */

import { useMemo } from "react";
import { CHROME, stationColor } from "../utils/chartTheme";
import { formatDate } from "../utils/dates";
import { useColorScheme } from "../utils/useColorScheme";
import PlotlyChart from "./PlotlyChart";

export default function RegressionChart({ data }) {
  const scheme = useColorScheme();

  const { station, variable, start, end } = data.query;
  const { model, points } = data;

  const color = stationColor(scheme, "A");

  const unit = variable.unit;
  const label = variable.label;

  const traces = useMemo(() => {
    const c = CHROME[scheme];

    const dates = points.map((p) => p.date);
    const observed = points.map((p) => p.observed);
    const fitted = points.map((p) => p.fitted);
    const residuals = points.map((p) => p.residual);

    return [
      {
        type: "scatter",
        mode: "markers",
        name: "Observed monthly values",
        x: dates,
        y: observed,
        marker: {
          color,
          size: 6,
          opacity: 0.75,
        },
        hovertemplate:
          "%{x|%b %Y}<br>Observed: %{y:.2f} " +
          unit +
          "<extra></extra>",
      },
      {
        type: "scatter",
        mode: "lines",
        name: "Fitted seasonal curve",
        x: dates,
        y: fitted,
        line: {
          color: c.ink,
          width: 2.5,
        },
        hovertemplate:
          "%{x|%b %Y}<br>Fitted: %{y:.2f} " +
          unit +
          "<extra></extra>",
      },
      {
        type: "scatter",
        mode: "markers",
        name: "Residuals",
        showlegend: false,
        xaxis: "x2",
        yaxis: "y2",
        x: dates,
        y: residuals,
        marker: {
          color,
          size: 5,
          opacity: 0.75,
        },
        hovertemplate:
          "%{x|%b %Y}<br>Residual: %{y:.2f} " +
          unit +
          "<extra></extra>",
      },
    ];
  }, [points, color, scheme, unit]);

  const layout = useMemo(() => {
    const c = CHROME[scheme];

    const axis = {
      gridcolor: c.grid,
      linecolor: c.axis,
      tickfont: { color: c.muted },
      automargin: true,
    };

    const r2 =
      model.r_squared === null
        ? "R² undefined"
        : `R² = ${model.r_squared.toFixed(3)}`;

    return {
      hovermode: "closest",

      xaxis: {
        ...axis,
        type: "date",
        domain: [0, 1],
        anchor: "y",
        showticklabels: false,
      },

      yaxis: {
        ...axis,
        domain: [0.36, 1],
        title: {
          text: `${label} (${unit})`,
        },
        zeroline: false,
      },

      xaxis2: {
        ...axis,
        type: "date",
        domain: [0, 1],
        anchor: "y2",
        matches: "x",
        title: {
          text: "Month",
        },
      },

      yaxis2: {
        ...axis,
        domain: [0, 0.24],
        title: {
          text: `Residual (${unit})`,
        },
        zeroline: true,
        zerolinecolor: c.ink2,
        zerolinewidth: 1,
      },

      annotations: [
        {
          xref: "paper",
          yref: "paper",
          x: 0.01,
          y: 0.99,
          xanchor: "left",
          yanchor: "top",
          showarrow: false,
          align: "left",
          text: `<b>Seasonal + Trend Regression</b><br>${r2} · n = ${model.n} months`,
          bgcolor: c.surface,
          bordercolor: c.axis,
          borderpad: 5,
          font: {
            color: c.ink,
            size: 12,
          },
        },
      ],
    };
  }, [model, label, unit, scheme]);

  return (
    <PlotlyChart
      traces={traces}
      layout={layout}
      height={520}
      revision={`${station.station_id}|${variable.variable_code}|${start}|${end}|${data.query.quality_policy}`}
      ariaLabel={`Seasonal and trend regression of monthly ${label.toLowerCase()} at ${station.name}, from ${formatDate(start)} to ${formatDate(end)}. The chart shows observed monthly values, fitted seasonal values and residuals. R squared is ${model.r_squared === null ? "undefined" : model.r_squared.toFixed(3)}. ${model.n} months were used.`}
    />
  );
}
