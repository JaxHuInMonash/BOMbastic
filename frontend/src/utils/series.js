/**
 * Turns API records into what a daily line chart draws, applying the data
 * contract (docs/data-contract.md §5) in one place. Pure functions: no React,
 * no Plotly, covered by `npm test`.
 *
 * Rules for a daily line:
 *   - Only single-day readings are joined. A day with no reading, a day with no
 *     row at all, and a multi-day value each break the line; nothing is ever
 *     drawn as zero or joined across a gap.
 *   - A single-day reading with no neighbour to join to is still drawn, as a
 *     dot. A line through one point is invisible, so without the dot a real
 *     reading would vanish from the chart while appearing in the table.
 *   - A multi-day value (BOM's "days of accumulation" > 1) is a hollow dot on
 *     the last day it covers, never joined to the line, so it is visible without
 *     passing as one day's reading.
 */

import { addDays, daysBetween } from "./dates.js";

/** Ranges longer than this show a faded daily line under a 30-day mean. */
export const LONG_RANGE_DAYS = 400;
export const MEAN_WINDOW_DAYS = 30;
/** Same rule as the summary tiles (report D-A): a mean needs 90% of its days. */
export const MEAN_MIN_COVERAGE = 0.9;

const spanOf = (r) => r.accumulation_days ?? 1;

/** True for a record that is one day's measured value. */
export const isSingleDay = (r) => r.value !== null && r.value !== undefined && spanOf(r) <= 1;

export const isLongRange = (start, end) => daysBetween(start, end) > LONG_RANGE_DAYS;

/** The other temperature, if this station records it; otherwise null. */
export function companionOf(variableCode, station) {
  const other = { tmax: "tmin", tmin: "tmax" }[variableCode];
  if (!other || !station) return null;
  return station.variables.some((v) => v.variable_code === other) ? other : null;
}

/**
 * One entry per calendar day from start to end: the single-day value, or null.
 * Days absent from `records` are null too (the API omits days with no row).
 */
export function dailyValues(records, start, end) {
  const byDate = new Map();
  for (const r of records) if (isSingleDay(r)) byDate.set(r.date, r.value);
  const n = daysBetween(start, end);
  const dates = new Array(n);
  const values = new Array(n);
  let d = start;
  for (let i = 0; i < n; i += 1) {
    dates[i] = d;
    values[i] = byDate.has(d) ? byDate.get(d) : null;
    d = addDays(d, 1);
  }
  return { dates, values };
}

/** Days whose single-day value has no single-day neighbour on either side. */
export function loneDays({ dates, values }) {
  const out = { dates: [], values: [] };
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] === null) continue;
    const before = i > 0 && values[i - 1] !== null;
    const after = i < values.length - 1 && values[i + 1] !== null;
    if (!before && !after) {
      out.dates.push(dates[i]);
      out.values.push(values[i]);
    }
  }
  return out;
}

/** Multi-day values, each placed on the last day it covers (where BOM reports it). */
export function multiDayValues(records) {
  const rows = records.filter((r) => r.value !== null && r.value !== undefined && spanOf(r) > 1);
  return { dates: rows.map((r) => r.date), values: rows.map((r) => r.value), spans: rows.map(spanOf) };
}

/**
 * Centred moving mean of the daily values. The window is clipped at the ends
 * of the range (no data outside the range is used), and a day gets a mean only
 * when its window has at least MEAN_MIN_COVERAGE of its days with a single-day
 * value and is at least half the full window long. Anything less is null,
 * which the chart shows as a gap.
 */
export function movingMean({ dates, values }, windowDays = MEAN_WINDOW_DAYS, minCoverage = MEAN_MIN_COVERAGE) {
  const n = values.length;
  const sum = new Float64Array(n + 1);
  const count = new Int32Array(n + 1);
  for (let i = 0; i < n; i += 1) {
    const has = values[i] !== null;
    sum[i + 1] = sum[i] + (has ? values[i] : 0);
    count[i + 1] = count[i] + (has ? 1 : 0);
  }
  const before = Math.floor(windowDays / 2);
  const after = windowDays - before - 1;
  const minLength = Math.ceil(windowDays / 2);
  const means = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const lo = Math.max(0, i - before);
    const hi = Math.min(n - 1, i + after);
    const length = hi - lo + 1;
    const c = count[hi + 1] - count[lo];
    means[i] = length >= minLength && c >= Math.ceil(minCoverage * length)
      ? Math.round(((sum[hi + 1] - sum[lo]) / c) * 100) / 100
      : null;
  }
  return { dates, values: means };
}

const SHORT_DATE = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
const STATUS_WORD = { observed: "checked", unverified: "not yet checked", interpolated: "interpolated" };

/**
 * One line of the temperature tooltip for one classified day (utils/rainfall.js
 * classifyDays): the value and whether BOM has checked it, or why there is none.
 */
export function describeTemperatureDay(day, unit) {
  const t = (v) => `${Number(v.toFixed(1))} ${unit}`;
  if (day.kind === "value") return `${t(day.value)} · ${STATUS_WORD[day.quality] ?? day.quality}`;
  if (day.kind === "multi") {
    const { total } = day;
    const to = SHORT_DATE.format(new Date(`${total.end}T00:00:00Z`));
    return day.date === total.end
      ? `${t(total.value)} over ${total.span} days to ${to} · ${STATUS_WORD[total.quality] ?? total.quality}`
      : `inside a ${total.span}-day value (to ${to})`;
  }
  return day.kind === "missing" ? "no reading" : "no record";
}
