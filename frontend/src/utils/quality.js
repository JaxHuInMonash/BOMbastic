/**
 * How data quality is drawn on every Plotly chart (NFR-05), in one place.
 *
 *   not yet quality-checked   a pale grey band behind the days concerned, with
 *                             its own legend entry. A band works the same on
 *                             lines, columns and the running total, and doesn't
 *                             take over a mark style (dashes and stripes
 *                             already mean "multi-day"). Per-day status is
 *                             always in the tooltip and the table.
 *   no reading                grey × at the foot of the chart
 *   interpolated              BOM daily data has none; if it ever appears it is
 *                             named in the tooltip and table
 *
 * Pure functions: no React, no Plotly import, covered by `npm test`.
 */

import { addDays } from "./dates.js";

export const QUALITY_LABEL = {
  observed: "quality-checked",
  unverified: "not yet checked",
  interpolated: "interpolated",
};

/** The quality that applies to a classified day (a multi-day total's own quality for its days). */
const qualityOf = (day) => (day.kind === "multi" ? day.total.quality : day.quality);

/**
 * Runs of consecutive days whose reading is not yet quality-checked, as
 * [{ start, end }]. A day without a reading ends a run: there is nothing there
 * to be checked.
 */
export function unverifiedRuns(days) {
  const runs = [];
  let run = null;
  for (const d of days) {
    const unverified = (d.kind === "value" || d.kind === "multi") && qualityOf(d) === "unverified";
    if (unverified) {
      if (run && run.end === addDays(d.date, -1)) run.end = d.date;
      else runs.push((run = { start: d.date, end: d.date }));
    } else {
      run = null;
    }
  }
  return runs;
}

/** Plotly background shapes for the runs: each covers its days edge to edge. */
export function bandShapes(runs, color) {
  return runs.map((r) => ({
    type: "rect",
    xref: "x",
    yref: "paper",
    x0: `${addDays(r.start, -1)} 12:00`,
    x1: `${r.end} 12:00`,
    y0: 0,
    y1: 1,
    fillcolor: color,
    line: { width: 0 },
    layer: "below",
  }));
}

/** A legend entry for the band (shapes have no legend of their own). */
export function bandLegend(color) {
  return {
    type: "scatter",
    mode: "markers",
    name: "Not yet checked by BOM",
    x: [null],
    y: [null],
    marker: { symbol: "square", size: 12, color },
    hoverinfo: "skip",
  };
}

/** Days with no reading (missing or no record), for the × markers. */
export const noReadingDays = (days) => days.filter((d) => d.kind === "missing" || d.kind === "norecord");
