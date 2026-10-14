/**
 * Daily chart data: one entry per calendar day, classified once, so the
 * column chart, the calendar heatmap and their tooltips all agree.
 * Pure functions: no React, no Plotly, covered by `npm test`.
 *
 * Each day is one of:
 *   value     a single-day reading (0 mm is a dry day: a reading, never a gap)
 *   multi     part of a multi-day total. BOM reports the total on the last day
 *             it covers and leaves the earlier days blank; every covered day
 *             points at the same total, which is never split or shown as one
 *             day's rain (docs/data-contract.md §5, D-D)
 *   missing   BOM has a row for the day but no reading
 *   norecord  BOM has no row for the day at all
 */

import { addDays, daysBetween, toDate } from "./dates.js";

/** Rainfall classes for the calendar. Fixed in mm, so every year, and every station, uses the same scale. */
export const RAIN_BINS = [
  { min: 0, max: 0, label: "0 mm" },
  { min: 0, max: 1, label: "under 1" },
  { min: 1, max: 5, label: "1-5" },
  { min: 5, max: 10, label: "5-10" },
  { min: 10, max: 25, label: "10-25" },
  { min: 25, max: 50, label: "25-50" },
  { min: 50, max: Infinity, label: "50+ mm" },
];

/** Index into RAIN_BINS. 0 is exactly 0 mm; each other bin includes its lower bound. */
export function binOf(mm) {
  if (mm <= 0) return 0;
  if (mm < 1) return 1;
  for (let i = RAIN_BINS.length - 1; i >= 2; i -= 1) if (mm >= RAIN_BINS[i].min) return i;
  return 1;
}

const STATUS = {
  observed: "Quality-checked by BOM",
  unverified: "Not yet quality-checked by BOM",
  interpolated: "Interpolated (estimated)",
  missing: "No reading recorded",
  norecord: "No record in the BOM data",
};

/**
 * Dense list of days from start to end, one entry per day, in order.
 * A total reported after `end` is not in the records, so the days it covers
 * inside the range stay as the API reports them ("missing").
 */
export function classifyDays(records, start, end) {
  const byDate = new Map(records.map((r) => [r.date, r]));
  const totals = new Map(); // date -> total, for every day a total covers
  for (const r of records) {
    const span = r.accumulation_days ?? 1;
    if (r.value === null || r.value === undefined || span <= 1) continue;
    const total = { value: r.value, span, start: addDays(r.date, 1 - span), end: r.date, quality: r.quality_state };
    for (let i = 0; i < span; i += 1) totals.set(addDays(r.date, -i), total);
  }

  const n = daysBetween(start, end);
  const days = new Array(n);
  let date = start;
  for (let i = 0; i < n; i += 1) {
    const r = byDate.get(date);
    const total = totals.get(date);
    if (total) days[i] = { date, kind: "multi", total, quality: total.quality };
    else if (!r) days[i] = { date, kind: "norecord", quality: "norecord" };
    else if (r.value === null || r.value === undefined) days[i] = { date, kind: "missing", quality: "missing" };
    else days[i] = { date, kind: "value", value: r.value, quality: r.quality_state };
    date = addDays(date, 1);
  }
  return days;
}

const DAY_LONG = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const DAY_SHORT = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
const mm = (v) => `${Number(v.toFixed(1))} mm`;

/**
 * What a tooltip says about one day: { date, value, status }.
 * The value line leads; status follows (dataviz: values lead, labels follow).
 */
export function describeDay(day) {
  const date = DAY_LONG.format(toDate(day.date));
  if (day.kind === "value") {
    return { date, value: day.value === 0 ? "0 mm · dry day" : mm(day.value), status: STATUS[day.quality] ?? day.quality };
  }
  if (day.kind === "multi") {
    const t = day.total;
    const from = DAY_SHORT.format(toDate(t.start));
    const to = DAY_SHORT.format(toDate(t.end));
    return {
      date,
      value: `Part of ${mm(t.value)} over ${t.span} days (${from} - ${to})`,
      status: `Multi-day total, not a single day's rain · ${STATUS[t.quality] ?? t.quality}`,
    };
  }
  return { date, value: day.kind === "missing" ? "No reading" : "No record", status: STATUS[day.kind] };
}

/** The first and last day of the month containing `date`, clipped to [start, end]. */
export function monthBounds(date, start, end) {
  const first = `${date.slice(0, 7)}-01`;
  const next = toDate(first);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const last = addDays(next.toISOString().slice(0, 10), -1);
  return { start: first < start ? start : first, end: last > end ? end : last };
}

/** The month before or after `month` ("YYYY-MM"), as "YYYY-MM". */
export function shiftMonth(month, by) {
  const d = toDate(`${month}-01`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
}

/** Monday-first weekday: 0 = Mon ... 6 = Sun (Australian calendars start on Monday). */
export const weekdayOf = (date) => (toDate(date).getUTCDay() + 6) % 7;

/**
 * Calendar layout: one grid per calendar year that the range touches.
 * Columns are Monday-to-Sunday weeks, rows are weekdays. Only days inside
 * [start, end] get a cell; the rest of the year is left blank.
 * Returns [{ year, weeks, cells: [{ index, date, col, row }], months: [{ month, label, col }] }]
 * where `index` is the day's position in classifyDays().
 */
export function calendarYears(start, end) {
  const years = [];
  const first = Number(start.slice(0, 4));
  const last = Number(end.slice(0, 4));
  let index = 0;
  for (let year = first; year <= last; year += 1) {
    const jan1 = `${year}-01-01`;
    const offset = weekdayOf(jan1); // empty cells before 1 Jan in its first week
    const from = start > jan1 ? start : jan1;
    const to = end < `${year}-12-31` ? end : `${year}-12-31`;
    const cells = [];
    const months = [];
    let date = from;
    while (date <= to) {
      const dayOfYear = daysBetween(jan1, date) - 1;
      const col = Math.floor((dayOfYear + offset) / 7);
      cells.push({ index, date, col, row: weekdayOf(date) });
      if (date.endsWith("-01") || date === from) {
        // When the range starts late in a month, that partial month's label would
        // overlap the next month's, so only the next one is kept.
        if (months.length && col - months[months.length - 1].col < 3) months.pop();
        months.push({ month: date.slice(0, 7), col });
      }
      index += 1;
      date = addDays(date, 1);
    }
    const weeks = Math.floor((daysBetween(jan1, `${year}-12-31`) - 1 + offset) / 7) + 1;
    years.push({ year, weeks, cells, months });
  }
  return years;
}

/**
 * Running total for the "Running total" view: one entry per day with the
 * measured rainfall since the start of the range, at the end of that day.
 *
 *   value    total after adding that day's reading
 *   multi    days inside a multi-day total: `total` is null (the timing inside
 *            the span is unknown) and `from`/`to` give the totals either side;
 *            on the last day `total` equals `to`. The chart joins `from` to `to`
 *            with a dashed straight line, which claims nothing about timing.
 *   gap      no reading or no record: nothing is added, so the total carries on
 *            unchanged; the chart draws this stretch differently because the
 *            real total is probably higher.
 *
 * A total whose span began before the range is still added on its last day, as
 * the API's summary total does, so the line ends on the same number as the tile.
 */
export function runningTotal(days) {
  const out = new Array(days.length);
  let run = 0;
  let spanFrom = 0;
  for (let i = 0; i < days.length; i += 1) {
    const d = days[i];
    if (d.kind === "value") {
      run += d.value;
      out[i] = { date: d.date, kind: "value", total: run };
    } else if (d.kind === "multi") {
      if (i === 0 || days[i - 1].kind !== "multi" || days[i - 1].total !== d.total) spanFrom = run;
      const to = spanFrom + d.total.value;
      const last = d.date === d.total.end;
      if (last) run = to;
      out[i] = { date: d.date, kind: "multi", total: last ? to : null, from: spanFrom, to };
    } else {
      out[i] = { date: d.date, kind: "gap", total: run };
    }
  }
  return out;
}

const round1 = (v) => Number(v.toFixed(1));

/** Tooltip for one day of the running total: { total, detail, status }. */
export function describeRunning(entry, day) {
  const base = describeDay(day);
  if (entry.kind === "multi") {
    const total = entry.total === null
      ? `So far: ${round1(entry.from)} → ${round1(entry.to)} mm`
      : `So far: ${round1(entry.to)} mm`;
    return { total, detail: `${base.date}: ${base.value}`, status: "Timing inside a multi-day total is unknown" };
  }
  if (entry.kind === "gap") {
    return { total: `So far: ${round1(entry.total)} mm`, detail: `${base.date}: ${base.value}, nothing added`, status: base.status };
  }
  return { total: `So far: ${round1(entry.total)} mm`, detail: `${base.date}: ${base.value}`, status: base.status };
}

/**
 * Multi-day totals for the column chart, one per total. Each is drawn across
 * the days it covers at the average per day, so the block's area equals the
 * rain measured (the same as if it had been daily columns); the tooltip gives
 * the total itself.
 */
export function multiDayBlocks(days) {
  const seen = new Map();
  for (const d of days) if (d.kind === "multi" && !seen.has(d.total.end)) seen.set(d.total.end, d.total);
  return [...seen.values()].map((t) => ({ ...t, perDay: t.value / t.span }));
}
