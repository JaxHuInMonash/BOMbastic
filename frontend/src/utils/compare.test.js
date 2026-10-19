/**
 * `npm test`. Each test names the requirement it backs (report RTM IDs).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { compareTemperature, compareVariable, differences, overlapOf, rainDays, sharedVariables } from "./compare.js";
import { classifyDays } from "./rainfall.js";

const rec = (date, value, accumulation_days = 1) => ({
  date, value, quality_state: value === null ? "missing" : "observed", accumulation_days: value === null ? null : accumulation_days,
});
const v = (code) => ({ variable_code: code });

test("FR-04: only variables both stations record are offered; the choice falls back to rainfall", () => {
  const all = [v("rainfall"), v("tmax"), v("tmin")];
  const a = { variables: [v("rainfall"), v("tmax"), v("tmin")] };
  const b = { variables: [v("rainfall"), v("tmax")] };
  const shared = sharedVariables(all, a, b);
  assert.deepEqual(shared.map((x) => x.variable_code), ["rainfall", "tmax"]);
  assert.equal(compareVariable(shared, "tmax"), "tmax");
  assert.equal(compareVariable(shared, "tmin"), "rainfall");
});

test("FR-04: the compared dates are the period both stations recorded", () => {
  assert.deepEqual(overlapOf({ first_date: "1998-06-30", last_date: "2003-06-29" }, { first_date: "1994-01-01", last_date: "2026-10-02" }), { first_date: "1998-06-30", last_date: "2003-06-29" });
  assert.equal(overlapOf({ first_date: "1950-01-01", last_date: "1960-01-01" }, { first_date: "1994-01-01", last_date: "2026-10-02" }), null);
});

test("FR-04, NFR-05: differences and indicators use only days both stations measured", () => {
  const a = classifyDays([rec("2025-01-01", 30), rec("2025-01-02", 25), rec("2025-01-03", null), rec("2025-01-04", 20, 2), rec("2025-01-05", 18)], "2025-01-01", "2025-01-05");
  const b = classifyDays([rec("2025-01-01", 22), rec("2025-01-02", 27), rec("2025-01-03", 24), rec("2025-01-04", 19), rec("2025-01-05", 18)], "2025-01-01", "2025-01-05");
  assert.deepEqual(differences(a, b).values, [8, -2, null, null, 0]);
  const s = compareTemperature(a, b);
  assert.equal(s.days, 3);
  assert.equal(s.meanA, 24.33);
  assert.equal(s.meanB, 22.33);
  assert.equal(s.meanDifference, 2);
  assert.equal(s.aHigher, 1);
  assert.equal(s.bHigher, 1);
  assert.deepEqual(s.largest, { date: "2025-01-01", a: 30, b: 22, difference: 8 });
});

test("FR-04: no paired day gives no indicators rather than zeros", () => {
  const a = classifyDays([rec("2025-01-01", null)], "2025-01-01", "2025-01-01");
  const b = classifyDays([rec("2025-01-01", 20)], "2025-01-01", "2025-01-01");
  assert.equal(compareTemperature(a, b), null);
});

test("FR-04: rain days count single-day readings of at least 1 mm only", () => {
  const days = classifyDays([rec("2025-01-01", 0), rec("2025-01-02", 0.8), rec("2025-01-03", 1), rec("2025-01-04", 12), rec("2025-01-06", 30, 2)], "2025-01-01", "2025-01-06");
  assert.equal(rainDays(days), 2);
});
