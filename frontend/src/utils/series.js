/**
 * Turns API records into Plotly traces, applying the data-contract rules
 * (docs/data-contract.md §5) in one place so every chart agrees:
 *
 *   quality-checked   solid line / solid bar
 *   not yet checked   dashed line / patterned bar
 *   multi-day total   one wide patterned bar spanning the days it covers
 *                     (never a single-day bar, never part of a line)
 *   no reading        a tick at the foot of the plot, and a gap in a line
 *                     (never zero, never joined across)
 *
 * Pure functions: no React, no Plotly import, covered by `npm test`.
 */

import { addDays } from "./dates.js";
import { isSingleDay } from "./analysis.js";

const DAY_MS = 86_400_000;
const spanOf = (r) => r.accumulation_days ?? 1;

const hoverFor = (r, unit, name) => {
  const who = name ? `${name}<br>` : "";
  const quality = r.quality_state === "unverified" ? "not yet quality-checked" : "quality-checked";
  return `${who}${r.date}<br>${r.value} ${unit}<br>${quality}`;
};

/** Runs of consecutive single-day readings; a missing day, multi-day total or absent row ends a run. */
export function runsOf(records) {
  const runs = [];
  let current = null;
  let last = null;
  for (const r of records) {
    if (!isSingleDay(r)) {
      current = null;
      continue;
    }
    if (!current || r.date !== addDays(last, 1)) {
      current = [];
      runs.push(current);
    }
    current.push(r);
    last = r.date;
  }
  return runs;
}

/**
 * Line traces for one station: quality-checked (solid) and not-yet-checked
 * (dashed). Where quality changes inside a run the boundary point belongs to
 * both traces so the line has no visible break; between runs a null point makes
 * Plotly leave a gap.
 */
export function lineTraces(records, { unit, name, color }) {
  const make = (dash, label) => ({
    type: "scatter",
    mode: "lines",
    name: label,
    x: [],
    y: [],
    text: [],
    hoverinfo: "text",
    line: { color, width: 1.5, dash },
    connectgaps: false,
  });
  const solid = make("solid", name ? `${name}` : "Quality-checked");
  const dashed = make("dash", name ? `${name} (not yet checked)` : "Not yet checked");
  const add = (t, r) => {
    t.x.push(r.date);
    t.y.push(r.value);
    t.text.push(hoverFor(r, unit, name));
  };
  const close = (t, lastDate) => {
    if (t.y.length && t.y[t.y.length - 1] !== null) {
      t.x.push(addDays(lastDate, 1));
      t.y.push(null);
      t.text.push("");
    }
  };

  for (const run of runsOf(records)) {
    let prev = null;
    for (const r of run) {
      const target = r.quality_state === "unverified" ? dashed : solid;
      const other = target === solid ? dashed : solid;
      if (prev && prev.quality_state !== r.quality_state) {
        // The boundary point starts the new piece as well as ending the old one.
        add(target, prev);
        close(other, prev.date);
      }
      add(target, r);
      prev = r;
    }
    close(solid, run[run.length - 1].date);
    close(dashed, run[run.length - 1].date);
  }
  return [solid, dashed].filter((t) => t.y.some((v) => v !== null));
}

/** Bar traces: quality-checked (solid), not-yet-checked (patterned) and multi-day totals (wide, patterned). */
export function barTraces(records, { unit, name, color }) {
  const singles = records.filter(isSingleDay);
  const checked = singles.filter((r) => r.quality_state !== "unverified");
  const unchecked = singles.filter((r) => r.quality_state === "unverified");
  const totals = records.filter((r) => r.value !== null && spanOf(r) > 1);

  const bars = (rows, label, marker) => ({
    type: "bar",
    name: label,
    x: rows.map((r) => r.date),
    y: rows.map((r) => r.value),
    text: rows.map((r) => hoverFor(r, unit, name)),
    hoverinfo: "text",
    marker,
  });
  const out = [];
  if (checked.length) out.push(bars(checked, name ?? "Quality-checked", { color }));
  if (unchecked.length) {
    out.push(bars(unchecked, name ? `${name} (not yet checked)` : "Not yet checked", {
      color, opacity: 0.6, pattern: { shape: "/", size: 5, solidity: 0.45, fgcolor: color, bgcolor: "rgba(0,0,0,0)" },
    }));
  }
  if (totals.length) {
    out.push({
      type: "bar",
      name: name ? `${name} (multi-day total)` : "Multi-day total",
      // Centre each bar on the days it covers; BOM reports the total against the last day.
      // A daily bar for day D is centred on D's midnight and one day wide, so a total covering
      // the n days ending on D is centred (n - 1) / 2 days earlier and n days wide.
      x: totals.map((r) => new Date(new Date(`${r.date}T00:00:00Z`).getTime() - ((spanOf(r) - 1) * DAY_MS) / 2).toISOString()),
      width: totals.map((r) => spanOf(r) * DAY_MS),
      y: totals.map((r) => r.value),
      text: totals.map((r) => `${r.date}<br>${r.value} ${unit} total over ${spanOf(r)} days<br>Not a single-day value`),
      hoverinfo: "text",
      marker: { color, opacity: 0.35, pattern: { shape: "x", size: 6, solidity: 0.3, fgcolor: color }, line: { color, width: 1 } },
    });
  }
  return out;
}

/** Ticks at the foot of the plot for days with no reading. They sit on a hidden 0-1 axis, never at y = 0 of the data. */
export function missingTrace(records, { color = "#898781", name } = {}) {
  const days = records.filter((r) => r.value === null).map((r) => r.date);
  if (!days.length) return null;
  return {
    type: "scatter",
    mode: "markers",
    name: name ? `No reading · ${name}` : "No reading",
    x: days,
    y: days.map(() => 0.012),
    yaxis: "y2",
    marker: { symbol: "line-ns-open", size: 9, color, line: { width: 1, color } },
    text: days.map((d) => `${d}<br>No reading`),
    hoverinfo: "text",
  };
}

/** Everything a station's chart needs, chosen by the variable's default_chart. */
export function stationTraces(records, kind, opts) {
  const main = kind === "bar" ? barTraces(records, opts) : lineTraces(records, opts);
  const missing = missingTrace(records, { name: opts.name });
  return missing ? [...main, missing] : main;
}

/** Counts used in the chart caption and tests. */
export function describeSeries(records) {
  let single = 0;
  let totals = 0;
  let missing = 0;
  for (const r of records) {
    if (r.value === null) missing += 1;
    else if (spanOf(r) > 1) totals += 1;
    else single += 1;
  }
  return { single, totals, missing };
}
