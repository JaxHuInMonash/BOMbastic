/**
 * `npm test` (node's built-in runner). Each test names the RTM item it backs.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareStats, csvFilename, equationText, linearRegression, overlapOf, pairByDate, predictY, toCsv,
} from "./analysis.js";
import { barTraces, describeSeries, lineTraces, missingTrace, runsOf, stationTraces } from "./series.js";

const rec = (date, value, quality_state = "observed", accumulation_days = null) => ({
  date, value, quality_state, accumulation_days,
});
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not within ${eps} of ${b}`);

// ------------------------------------------------------------------ FR-05
test("FR-05: regression recovers an exact line", () => {
  const xs = [1, 2, 3, 4, 5];
  const m = linearRegression(xs, xs.map((x) => 2 * x + 1));
  near(m.slope, 2);
  near(m.intercept, 1);
  near(m.r2, 1);
  assert.ok(m.residuals.every((r) => Math.abs(r) < 1e-9));
});

test("FR-05: slope, intercept and r² match a hand-worked example", () => {
  // x = 1..5, y = 2,4,5,4,5 -> slope 0.6, intercept 2.2, r² = 0.6
  const m = linearRegression([1, 2, 3, 4, 5], [2, 4, 5, 4, 5]);
  near(m.slope, 0.6);
  near(m.intercept, 2.2);
  near(m.r2, 0.6);
  near(predictY(m, 6), 5.8);
});

test("FR-05: residuals are y minus the fitted value and sum to about zero", () => {
  const xs = [1, 2, 3, 4, 5];
  const ys = [2, 4, 5, 4, 5];
  const m = linearRegression(xs, ys);
  near(m.residuals.reduce((s, r) => s + r, 0), 0, 1e-9);
  near(m.residuals[0], ys[0] - m.fitted[0]);
});

test("FR-05: refuses to fit too few points or a constant x, with a reason", () => {
  assert.match(linearRegression([1, 2], [1, 2]).error, /at least 3/);
  assert.match(linearRegression([4, 4, 4], [1, 2, 3]).error, /does not vary/);
});

test("FR-05: equation text handles a negative intercept", () => {
  assert.equal(equationText({ slope: 0.82, intercept: -3.1 }, "Tmin", "Tmax"), "Tmax = 0.82 × Tmin − 3.1");
  assert.equal(equationText({ slope: 1.5, intercept: 2 }), "y = 1.5 × x + 2");
});

test("FR-05: only days where both variables have a single-day value are paired", () => {
  const x = [rec("2024-01-01", 10), rec("2024-01-02", null, "missing"), rec("2024-01-03", 12), rec("2024-01-04", 30, "observed", 3)];
  const y = [rec("2024-01-01", 20), rec("2024-01-02", 21), rec("2024-01-03", null, "missing"), rec("2024-01-04", 9)];
  const { pairs } = pairByDate(x, y);
  assert.deepEqual(pairs.map((p) => p.date), ["2024-01-01"]);
});

test("FR-05: an observed zero is paired, a missing day is not", () => {
  const x = [rec("2024-01-01", 0), rec("2024-01-02", null, "missing")];
  const y = [rec("2024-01-01", 5), rec("2024-01-02", 6)];
  const { pairs } = pairByDate(x, y);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].x, 0);
});

// ------------------------------------------------------------------ FR-04
test("FR-04: comparison uses only days both stations measured, and reports the mean difference", () => {
  const a = [rec("2024-01-01", 20), rec("2024-01-02", 24), rec("2024-01-03", null, "missing")];
  const b = [rec("2024-01-01", 18), rec("2024-01-02", 20), rec("2024-01-03", 30)];
  const s = compareStats(a, b);
  assert.equal(s.days, 2);
  near(s.meanDifference, 3);
  assert.equal(s.largest.date, "2024-01-02");
  near(s.largest.difference, 4);
});

test("FR-04: no shared days gives null, not a made-up number", () => {
  assert.equal(compareStats([rec("2024-01-01", 1)], [rec("2024-02-01", 1)]), null);
});

test("FR-04: overlap is the later start and the earlier end, or null", () => {
  assert.deepEqual(
    overlapOf({ first_date: "2000-01-01", last_date: "2024-06-01" }, { first_date: "2010-03-01", last_date: "2026-01-01" }),
    { first_date: "2010-03-01", last_date: "2024-06-01" },
  );
  assert.equal(overlapOf({ first_date: "2000-01-01", last_date: "2005-01-01" }, { first_date: "2010-01-01", last_date: "2011-01-01" }), null);
});

// ------------------------------------------------------------------ FR-08
test("FR-08: CSV has the unit in the column name, empty cells for missing, and days covered", () => {
  const data = {
    query: { station: { station_id: "086338", name: "MELBOURNE (OLYMPIC PARK)" }, variable: { variable_code: "rainfall", unit: "mm" }, start: "2024-01-01", end: "2024-01-03" },
    records: [rec("2024-01-01", 0), rec("2024-01-02", null, "missing"), rec("2024-01-03", 9, "unverified", 3)],
  };
  const lines = toCsv(data).trim().split("\r\n");
  assert.equal(lines[0], "station_id,station_name,variable,date,value_mm,quality,days_covered");
  assert.equal(lines[1], "086338,MELBOURNE (OLYMPIC PARK),rainfall,2024-01-01,0,observed,1");
  assert.equal(lines[2], "086338,MELBOURNE (OLYMPIC PARK),rainfall,2024-01-02,,missing,");
  assert.equal(lines[3], "086338,MELBOURNE (OLYMPIC PARK),rainfall,2024-01-03,9,unverified,3");
  assert.equal(csvFilename(data), "bombastic_086338_rainfall_2024-01-01_2024-01-03.csv");
});

test("FR-08: a station name with a comma is quoted", () => {
  const data = {
    query: { station: { station_id: "1", name: "A, B" }, variable: { variable_code: "tmax", unit: "°C" }, start: "x", end: "y" },
    records: [rec("2024-01-01", 20)],
  };
  assert.match(toCsv(data), /"A, B"/);
});

// ------------------------------------------------------------------ NFR-05 / FR-02
const style = { unit: "mm", name: undefined, color: "#2a78d6" };

test("NFR-05: a missing day breaks the line instead of being joined across", () => {
  const traces = lineTraces([rec("2024-01-01", 20), rec("2024-01-02", 21), rec("2024-01-03", null, "missing"), rec("2024-01-04", 22)], { ...style, unit: "°C" });
  const y = traces[0].y;
  assert.ok(y.includes(null), "a null point must separate the two runs");
  assert.deepEqual(y.filter((v) => v !== null), [20, 21, 22]);
  assert.equal(runsOf([rec("2024-01-01", 20), rec("2024-01-03", 22)]).length, 2, "an absent row also breaks the run");
});

test("NFR-05: a multi-day total never appears in a line", () => {
  const traces = lineTraces([rec("2024-01-01", 5), rec("2024-01-04", 15, "observed", 3), rec("2024-01-05", 2)], style);
  assert.ok(traces.every((t) => !t.y.includes(15)));
});

test("NFR-05: unverified days go to a dashed trace that shares the boundary point", () => {
  const traces = lineTraces([rec("2024-01-01", 1), rec("2024-01-02", 2), rec("2024-01-03", 3, "unverified"), rec("2024-01-04", 4, "unverified")], style);
  const solid = traces.find((t) => t.line.dash === "solid");
  const dashed = traces.find((t) => t.line.dash === "dash");
  assert.deepEqual(solid.y.filter((v) => v !== null), [1, 2]);
  assert.deepEqual(dashed.y.filter((v) => v !== null), [2, 3, 4], "starts at the last checked day so the line joins up");
});

test("NFR-05: a multi-day total is one wide bar covering its days, not a single-day bar", () => {
  const traces = barTraces([rec("2024-01-01", 2), rec("2024-01-04", 15, "observed", 3)], style);
  const total = traces.find((t) => t.name === "Multi-day total");
  assert.equal(total.width[0], 3 * 86_400_000);
  assert.ok(traces.filter((t) => t.name !== "Multi-day total").every((t) => !t.y.includes(15)));
  // Covers 2 Jan to 4 Jan, so it is centred on 3 Jan at midnight.
  assert.equal(total.x[0], "2024-01-03T00:00:00.000Z");
});

test("NFR-05: an observed zero is a bar of height 0; a missing day is never a bar", () => {
  const traces = barTraces([rec("2024-01-01", 0), rec("2024-01-02", null, "missing")], style);
  assert.deepEqual(traces[0].y, [0]);
  assert.equal(traces[0].x.length, 1);
});

test("NFR-05: missing days get their own ticks on the hidden axis, not data y = 0", () => {
  const t = missingTrace([rec("2024-01-01", 0), rec("2024-01-02", null, "missing")]);
  assert.deepEqual(t.x, ["2024-01-02"]);
  assert.equal(t.yaxis, "y2");
  assert.equal(missingTrace([rec("2024-01-01", 1)]), null);
});

test("FR-02: bar for accumulations, line for the rest, through one entry point", () => {
  const records = [rec("2024-01-01", 1), rec("2024-01-02", 2)];
  assert.equal(stationTraces(records, "bar", style)[0].type, "bar");
  assert.equal(stationTraces(records, "line", style)[0].type, "scatter");
});

test("describeSeries counts single days, totals and missing days separately", () => {
  assert.deepEqual(
    describeSeries([rec("2024-01-01", 0), rec("2024-01-02", null, "missing"), rec("2024-01-05", 9, "observed", 3)]),
    { single: 1, totals: 1, missing: 1 },
  );
});
