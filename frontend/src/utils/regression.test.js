/**
 * `npm test`. Each test names the requirement it backs (report RTM IDs).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultPair, equationText, regressionStations, resolvePair, sig, stationVariables } from "./regression.js";

const v = (code, label, unit) => ({ variable_code: code, label, unit });

test("FR-05: the starting pair is minimum → maximum temperature, else the first two variables", () => {
  assert.deepEqual(defaultPair(["rainfall", "tmax", "tmin"]), { x: "tmin", y: "tmax" });
  assert.deepEqual(defaultPair(["rainfall", "tmax"]), { x: "rainfall", y: "tmax" });
  assert.deepEqual(defaultPair(["rainfall"]), { x: "rainfall", y: null });
});

test("FR-05: a chosen pair is kept when the station has it and never becomes x = y", () => {
  assert.deepEqual(resolvePair({ x: "rainfall", y: "tmin" }, ["rainfall", "tmax", "tmin"]), { x: "rainfall", y: "tmin" });
  assert.deepEqual(resolvePair({ x: "tmin", y: "tmin" }, ["rainfall", "tmax", "tmin"]), { x: "tmin", y: "tmax" });
  assert.deepEqual(resolvePair({ x: "tmin", y: "tmax" }, ["rainfall", "tmax"]), { x: "rainfall", y: "tmax" });
});

test("FR-05: only stations with two or more variables can be offered", () => {
  const stations = [{ variables: [1] }, { variables: [1, 2] }, { variables: [1, 2, 3] }];
  assert.equal(regressionStations(stations).length, 2);
  const all = [v("rainfall"), v("tmax"), v("tmin")];
  assert.deepEqual(stationVariables(all, { variables: [{ variable_code: "tmin" }, { variable_code: "rainfall" }] }).map((x) => x.variable_code), ["rainfall", "tmin"]);
});

test("FR-05: the equation names both variables, units and the sign of the intercept", () => {
  const x = v("tmin", "Minimum temperature", "°C");
  const y = v("tmax", "Maximum temperature", "°C");
  assert.equal(equationText({ slope: 0.953001641, intercept: 9.2985604 }, x, y), "Maximum temperature = 0.953 × minimum temperature + 9.3 °C");
  assert.equal(equationText({ slope: -0.414, intercept: -2.5 }, x, y), "Maximum temperature = −0.414 × minimum temperature − 2.5 °C");
  assert.equal(sig(0.000123456), "0.000123");
});
