/**
 * PlotlyChart - one thin wrapper around Plotly for every chart in the app.
 *
 * Plotly gives hover tooltips, box-zoom, pan, double-click reset and legend
 * toggling (FR-06) without us rebuilding them. This wrapper only supplies the
 * dashboard's theme, redraws when its inputs change, and cleans up on unmount.
 * The bundle is plotly.js-basic-dist-min (scatter + bar), about a third of the
 * size of the full library.
 *
 * Every chart has a table equivalent below it (DR-05), so the chart itself is
 * labelled as an image for screen readers.
 */

import Plotly from "plotly.js-basic-dist-min";
import { useEffect, useRef } from "react";
import { PALETTE } from "../utils/chartTheme";
import { useColorScheme } from "../utils/useColorScheme";

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const merge = (base, extra = {}) => ({ ...base, ...extra });

export default function PlotlyChart({ traces, layout, ariaLabel, height = 340 }) {
  const ref = useRef(null);
  const scheme = useColorScheme();

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const c = PALETTE[scheme];
    const axis = { gridcolor: c.grid, linecolor: c.axis, zerolinecolor: c.axis, tickfont: { color: c.muted }, automargin: true };

    Plotly.react(
      el,
      traces,
      {
        autosize: true,
        height,
        margin: { l: 56, r: 16, t: 12, b: 40 },
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        font: { family: FONT, color: c.ink, size: 12 },
        hovermode: "closest",
        hoverlabel: { font: { family: FONT } },
        legend: { orientation: "h", y: -0.18, font: { color: c.ink } },
        ...layout,
        xaxis: merge(axis, layout?.xaxis),
        yaxis: merge(axis, layout?.yaxis),
        ...(layout?.yaxis2 ? { yaxis2: layout.yaxis2 } : {}),
      },
      { responsive: true, displaylogo: false, modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d", "sendDataToCloud", "sendChartToCloud"] },
    );
    return () => Plotly.purge(el);
  }, [traces, layout, height, scheme]);

  return <div ref={ref} className="plotly-host" role="img" aria-label={ariaLabel} style={{ minHeight: height }} />;
}
