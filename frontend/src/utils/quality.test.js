/**
 * `npm test`. Each test names the requirement it backs (report RTM IDs).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { bandShapes, noReadingDays, unverifiedRuns } from "./quality.js";
import { classifyDays } from "./rainfall.js";

const rec = (date, value, quality_state = "observed", accumulation_days = 1) => ({
  date, value, quality_state: value === null ? "missing" : quality_state, accumulation_days: value === null ? null : accumulation_days,
});

test("NFR-05: unverified readings form runs; a checked day or a day without a reading ends a run", () => {
  const records = [
    rec("2025-01-01", 1), rec("2025-01-02", 2, "unverified"), rec("2025-01-03", 0, "unverified"),
    rec("2025-01-04", 3), rec("2025-01-05", 1, "unverified"), rec("2025-01-06", null), rec("2025-01-07", 4, "unverified"),
  ];
  const runs = unverifiedRuns(classifyDays(records, "2025-01-01", "2025-01-07"));
  assert.deepEqual(runs, [
    { start: "2025-01-02", end: "2025-01-03" },
    { start: "2025-01-05", end: "2025-01-05" },
    { start: "2025-01-07", end: "2025-01-07" },
  ]);
});

test("NFR-05: every day of an unverified multi-day total is inside the band", () => {
  const records = [rec("2025-01-01", null), rec("2025-01-02", null), rec("2025-01-03", 12, "unverified", 3)];
  assert.deepEqual(unverifiedRuns(classifyDays(records, "2025-01-01", "2025-01-03")), [{ start: "2025-01-01", end: "2025-01-03" }]);
});

test("NFR-05: a band covers its days edge to edge, behind the data", () => {
  const [shape] = bandShapes([{ start: "2025-01-02", end: "2025-01-03" }], "#eee");
  assert.equal(shape.x0, "2025-01-01 12:00");
  assert.equal(shape.x1, "2025-01-03 12:00");
  assert.equal(shape.layer, "below");
});

test("NFR-05: no-reading markers cover missing days and absent rows, not multi-day days", () => {
  const records = [rec("2025-01-01", null), rec("2025-01-02", null), rec("2025-01-03", 12, "observed", 2)];
  const days = classifyDays(records, "2025-01-01", "2025-01-04");
  assert.deepEqual(noReadingDays(days).map((d) => d.date), ["2025-01-01", "2025-01-04"]);
});
