/**
 * `npm test`. Each test names the requirement it backs (report RTM IDs).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  binOf, calendarYears, describeDay, monthBounds, RAIN_BINS, rainfallDays, shiftMonth, weekdayOf,
} from "./rainfall.js";

const rec = (date, value, accumulation_days = 1, quality_state = "observed") => ({
  date, value, quality_state: value === null ? "missing" : quality_state, accumulation_days: value === null ? null : accumulation_days,
});

test("NFR-05: every day is classified once, dry is a reading and absent rows are 'norecord'", () => {
  const days = rainfallDays([rec("2025-01-01", 0), rec("2025-01-02", 4.2), rec("2025-01-03", null)], "2025-01-01", "2025-01-04");
  assert.deepEqual(days.map((d) => d.kind), ["value", "value", "missing", "norecord"]);
  assert.equal(days[0].value, 0);
});

test("NFR-05: a multi-day total marks every day it covers and is never split", () => {
  // BOM: 14 Jan reports 21 mm over 3 days; 12 and 13 Jan are blank rows.
  const records = [rec("2025-01-11", 1), rec("2025-01-12", null), rec("2025-01-13", null), rec("2025-01-14", 21, 3), rec("2025-01-15", 0)];
  const days = rainfallDays(records, "2025-01-11", "2025-01-15");
  assert.deepEqual(days.map((d) => d.kind), ["value", "multi", "multi", "multi", "value"]);
  assert.equal(days[1].total, days[3].total, "all covered days share one total");
  assert.deepEqual({ ...days[3].total }, { value: 21, span: 3, start: "2025-01-12", end: "2025-01-14", quality: "observed" });
  assert.ok(days.every((d) => d.kind !== "multi" || d.value === undefined), "no covered day carries a per-day value");
});

test("FR-02: tooltip text for a dry day, a missing day and a multi-day total", () => {
  const records = [rec("2025-01-12", null), rec("2025-01-13", 21, 2, "unverified"), rec("2025-01-14", 0), rec("2025-01-15", null)];
  const [part, , dry, missing] = rainfallDays(records, "2025-01-12", "2025-01-16").map(describeDay);
  assert.equal(dry.value, "0 mm · dry day");
  assert.equal(dry.status, "Quality-checked by BOM");
  assert.equal(missing.value, "No reading");
  assert.equal(part.value, "Part of 21 mm over 2 days (12 Jan – 13 Jan)");
  assert.match(part.status, /^Multi-day total, not a single day's rain · Not yet quality-checked/);
  const absent = describeDay(rainfallDays([], "2025-01-16", "2025-01-16")[0]);
  assert.equal(absent.value, "No record");
  assert.match(absent.date, /16 Jan 2025/);
});

test("FR-02: rainfall classes use fixed mm thresholds, 0 mm on its own", () => {
  assert.equal(binOf(0), 0);
  assert.equal(binOf(0.2), 1);
  assert.equal(binOf(1), 2);
  assert.equal(binOf(9.9), 3);
  assert.equal(binOf(10), 4);
  assert.equal(binOf(49.9), 5);
  assert.equal(binOf(50), 6);
  assert.equal(binOf(312), RAIN_BINS.length - 1);
});

test("FR-02: calendar has one grid per year, Monday-first weeks, only days in range", () => {
  const years = calendarYears("2024-12-30", "2025-01-02");
  assert.deepEqual(years.map((y) => y.year), [2024, 2025]);
  assert.equal(years[0].cells.length + years[1].cells.length, 4);
  // 1 Jan 2025 is a Wednesday: row 2 of week 0. 30 Dec 2024 is a Monday.
  assert.deepEqual(years[1].cells[0], { index: 2, date: "2025-01-01", col: 0, row: 2 });
  assert.equal(weekdayOf("2024-12-30"), 0);
  assert.equal(years[0].cells[0].row, 0);
  // A full year needs 53 weeks, or 54 when it starts late in the week and is a leap year.
  assert.equal(calendarYears("2025-01-01", "2025-12-31")[0].weeks, 53);
  assert.equal(calendarYears("2024-01-01", "2024-12-31")[0].cells.length, 366);
});

test("FR-02: calendar cell indexes line up with rainfallDays", () => {
  const start = "2023-10-04";
  const end = "2026-10-03";
  const days = rainfallDays([], start, end);
  const cells = calendarYears(start, end).flatMap((y) => y.cells);
  assert.equal(cells.length, days.length);
  assert.ok(cells.every((c) => days[c.index].date === c.date));
});

test("FR-02: selecting a month clips it to the chosen range", () => {
  assert.deepEqual(monthBounds("2025-02-14", "2020-01-01", "2026-01-01"), { start: "2025-02-01", end: "2025-02-28" });
  assert.deepEqual(monthBounds("2024-02-10", "2020-01-01", "2026-01-01"), { start: "2024-02-01", end: "2024-02-29" });
  assert.deepEqual(monthBounds("2021-10-20", "2021-10-04", "2026-10-03"), { start: "2021-10-04", end: "2021-10-31" });
  assert.equal(shiftMonth("2025-12", 1), "2026-01");
  assert.equal(shiftMonth("2025-01", -1), "2024-12");
});
