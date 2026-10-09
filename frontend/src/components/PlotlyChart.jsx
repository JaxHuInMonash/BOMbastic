/**
 * PlotlyChart - the one thin wrapper around Plotly that every chart uses
 * (report D-02: Plotly.js as the single chart library).
 *
 * Plotly supplies hover, box-zoom, pan, double-click reset and legend toggling
 * (FR-06). This wrapper adds only:
 *   - the dashboard's chart chrome, light or dark, following the OS like index.css;
 *   - loading Plotly on first use, so the map and filters don't wait for it
 *     (it is most of the bundle; Vite splits it into its own file);
 *   - updating in place with Plotly.react, and clearing up only on unmount.
 *     `revision` is Plotly's uirevision: while it stays the same, a zoom or a
 *     hidden legend entry survives redraws (a theme change, a late companion
 *     series); a new query passes a new revision and the view resets.
 *
 * Every chart has the same values in the table below it (DR-05), so the plot
 * itself is labelled as one image for screen readers.
 */

import { useEffect, useRef, useState } from "react";
import { CHROME } from "../utils/chartTheme";
import { useColorScheme } from "../utils/useColorScheme";

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const CONFIG = {
  responsive: true,
  displaylogo: false,
  modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d", "toImage"],
};

let plotlyModule = null;
function loadPlotly() {
  plotlyModule ??= import("plotly.js-basic-dist-min").then((m) => m.default ?? m);
  return plotlyModule;
}

function themed(layout, scheme, height, revision) {
  const c = CHROME[scheme];
  const axis = {
    gridcolor: c.grid,
    linecolor: c.axis,
    zeroline: false,
    tickfont: { color: c.muted },
    title: { font: { color: c.ink2 } },
    automargin: true,
  };
  return {
    autosize: true,
    height,
    margin: { l: 56, r: 16, t: 8, b: 36 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: FONT, color: c.ink2, size: 12 },
    hoverlabel: { font: { family: FONT, color: c.ink }, bgcolor: c.surface, bordercolor: c.axis },
    legend: { orientation: "h", x: 0, y: 1.02, yanchor: "bottom", font: { color: c.ink2 } },
    uirevision: revision,
    ...layout,
    xaxis: { ...axis, ...layout.xaxis, title: { ...axis.title, ...layout.xaxis?.title } },
    yaxis: { ...axis, ...layout.yaxis, title: { ...axis.title, ...layout.yaxis?.title } },
  };
}

export default function PlotlyChart({ traces, layout, revision, ariaLabel, height = 340 }) {
  const ref = useRef(null);
  const scheme = useColorScheme();
  const [plotly, setPlotly] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let live = true;
    loadPlotly().then(
      (p) => live && setPlotly(p),
      (e) => live && setLoadError(e),
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!plotly || !ref.current) return;
    plotly.react(ref.current, traces, themed(layout, scheme, height, revision), CONFIG);
  }, [plotly, traces, layout, scheme, height, revision]);

  useEffect(() => {
    const el = ref.current;
    return () => {
      if (plotly && el) plotly.purge(el);
    };
  }, [plotly]);

  if (loadError) {
    return (
      <p className="chart-message" role="alert">
        The chart library didn&apos;t load ({loadError.message}). The values are in the table below.
      </p>
    );
  }
  return (
    <div ref={ref} className="plotly-host" role="img" aria-label={ariaLabel} style={{ minHeight: height }} />
  );
}
