/**
 * `npm test` - node's built-in test runner, no extra dependencies.
 * Each test names the requirement it backs (report RTM IDs).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  companionOf, dailyValues, isLongRange, isSingleDay, loneDays, movingMean, multiDayValues,
} from "./series.js";

const rec = (date, value, accumulation_days = 1, quality_state = "observed") => ({
  date, value, quality_state, accumulation_days: value === null ? null : accumulation_days,
});

test("NFR-05: only one-day readings with a value count as single-day", () => {
  assert.equal(isSingleDay(rec("2024-01-01", 12.5)), true);
  assert.equal(isSingleDay(rec("2024-01-01", 0)), true, "zero is a reading, not a gap");
  assert.equal(isSingleDay(rec("2024-01-01", null)), false);
  assert.equal(isSingleDay(rec("2024-01-01", 11.4, 2)), false);
  assert.equal(isSingleDay({ date: "2024-01-01", value: 3, accumulation_days: null }), true, "null span means one day");
});

test("NFR-05: missing days, absent rows and multi-day values are null in the daily line, never zero", () => {
  const records = [rec("2024-01-01", 10), rec("2024-01-02", null), rec("2024-01-04", 11.4, 2), rec("2024-01-05", 9)];
  const { dates, values } = dailyValues(records, "2024-01-01", "2024-01-06");
  assert.deepEqual(dates, ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-06"]);
  assert.deepEqual(values, [10, null, null, null, 9, null]);
});

test("FR-02: a reading with no neighbour is kept as a dot so it can't vanish from the line", () => {
  // Albany tmin, Sep 2022: 17th covers two days, 18th is a lone single-day reading, 19th missing.
  const records = [rec("2022-09-15", 12.1), rec("2022-09-16", null), rec("2022-09-17", 11.4, 2), rec("2022-09-18", 11.2), rec("2022-09-19", null)];
  const lone = loneDays(dailyValues(records, "2022-09-15", "2022-09-19"));
  assert.deepEqual(lone.dates, ["2022-09-15", "2022-09-18"]);
  assert.deepEqual(lone.values, [12.1, 11.2]);
});

test("FR-02: days inside a run are not lone", () => {
  const records = [rec("2024-01-01", 1), rec("2024-01-02", 2), rec("2024-01-03", 3)];
  assert.deepEqual(loneDays(dailyValues(records, "2024-01-01", "2024-01-03")).dates, []);
});

test("NFR-05: multi-day values sit on the last day they cover and keep their span", () => {
  const records = [rec("2022-09-17", 11.4, 2), rec("2022-09-18", 11.2), rec("2022-09-20", null)];
  assert.deepEqual(multiDayValues(records), { dates: ["2022-09-17"], values: [11.4], spans: [2] });
});

test("FR-02: the 30-day mean matches a hand calculation", () => {
  const daily = { dates: Array.from({ length: 60 }, (_, i) => `d${i}`), values: Array.from({ length: 60 }, (_, i) => i) };
  const { values } = movingMean(daily);
  // Day 30: window is days 15..44, mean 29.5.
  assert.equal(values[30], 29.5);
  // Day 0: window clipped to days 0..14 (15 days, the minimum length), mean 7.
  assert.equal(values[0], 7);
  // Day 59: window clipped to days 44..59 (16 days), mean 51.5.
  assert.equal(values[59], 51.5);
});

test("D-A: the mean is withheld where under 90% of its window has a value", () => {
  const values = Array.from({ length: 60 }, () => 20);
  for (let i = 25; i < 30; i += 1) values[i] = null; // 5 missing days
  const daily = { dates: values.map((_, i) => `d${i}`), values };
  const mean = movingMean(daily).values;
  // Day 30's window (15..44) has 25 of 30 days: 83%, withheld.
  assert.equal(mean[30], null);
  // Day 50's window (35..59, clipped to 25 days) has no gaps.
  assert.equal(mean[50], 20);
  // Day 12's window (0..26, 27 days) has 2 missing: 25/27 = 92.6%, shown.
  assert.equal(mean[12], 20);
});

test("D-A: a missing day lowers the count, never the mean (no zero filling)", () => {
  const values = Array.from({ length: 30 }, () => 10);
  values[10] = null;
  values[11] = null;
  const mean = movingMean({ dates: values.map((_, i) => `d${i}`), values }).values;
  assert.equal(mean[15], 10);
});

test("FR-02: only ranges over 400 days count as long", () => {
  assert.equal(isLongRange("2025-10-04", "2026-10-03"), false);
  assert.equal(isLongRange("2021-10-04", "2026-10-03"), true);
});

test("FR-07: the companion is the other temperature, only if the station records it", () => {
  const station = { variables: [{ variable_code: "rainfall" }, { variable_code: "tmax" }, { variable_code: "tmin" }] };
  assert.equal(companionOf("tmax", station), "tmin");
  assert.equal(companionOf("tmin", station), "tmax");
  assert.equal(companionOf("rainfall", station), null);
  assert.equal(companionOf("tmax", { variables: [{ variable_code: "tmax" }] }), null);
});
