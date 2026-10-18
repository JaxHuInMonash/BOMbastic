/**
 * `npm test`. Each test names the requirement it backs (report RTM IDs).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { canRelate, defaultPair, equationText, nearestStation, pairableCodes, regressionStations, resolvePair, sig, stationVariables } from "./regression.js";

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

const avail = (code, first_date, last_date, days_with_value) => ({ variable_code: code, first_date, last_date, days_with_value });
const RAIN = avail("rainfall", "2000-01-01", "2025-12-31", 9000);

test("FR-05: a station is offered only when two variables could give 20 paired days", () => {
  const rainOnly = { station_id: "1", variables: [RAIN] };
  const fewDays = { station_id: "2", variables: [RAIN, avail("tmax", "2025-01-01", "2025-12-31", 19)] };
  const noOverlap = { station_id: "3", variables: [avail("rainfall", "2000-01-01", "2009-12-31", 3000), avail("tmax", "2010-01-01", "2025-12-31", 5000)] };
  const shortOverlap = { station_id: "4", variables: [avail("rainfall", "2000-01-01", "2010-01-19", 3000), avail("tmax", "2010-01-01", "2025-12-31", 5000)] };
  const exactly = { station_id: "5", variables: [avail("rainfall", "2000-01-01", "2010-01-20", 3000), avail("tmax", "2010-01-01", "2025-12-31", 5000)] };
  const full = { station_id: "6", variables: [RAIN, avail("tmax", "2010-01-01", "2025-12-31", 5000), avail("tmin", "2010-01-01", "2025-12-31", 5000)] };
  assert.deepEqual([rainOnly, fewDays, noOverlap, shortOverlap, exactly, full].map(canRelate), [false, false, false, false, true, true]);
  assert.deepEqual(regressionStations([rainOnly, full, fewDays]).map((s) => s.station_id), ["6"]);
});

test("FR-05: only variables that can pair are offered as X or Y", () => {
  const station = { variables: [RAIN, avail("tmin", "2010-01-01", "2025-12-31", 5000), avail("tmax", "2025-12-01", "2025-12-31", 5)] };
  assert.deepEqual(pairableCodes(station), ["rainfall", "tmin"]);
  const all = [v("rainfall"), v("tmax"), v("tmin")];
  assert.deepEqual(stationVariables(all, station).map((x) => x.variable_code), ["rainfall", "tmin"]);
});

test("FR-05: the nearest usable station is suggested, never the station itself", () => {
  const here = { station_id: "a", latitude: -37.8, longitude: 145.0 };
  const geelong = { station_id: "b", latitude: -38.15, longitude: 144.36 };
  const perth = { station_id: "c", latitude: -31.95, longitude: 115.86 };
  const best = nearestStation(here, [perth, here, geelong]);
  assert.equal(best.station.station_id, "b");
  assert.ok(best.km > 60 && best.km < 75, `Melbourne to Geelong is about 67 km, got ${best.km}`);
  assert.equal(nearestStation(here, [here]), null);
});

test("FR-05: the equation names both variables, units and the sign of the intercept", () => {
  const x = v("tmin", "Minimum temperature", "°C");
  const y = v("tmax", "Maximum temperature", "°C");
  assert.equal(equationText({ slope: 0.953001641, intercept: 9.2985604 }, x, y), "Maximum temperature = 0.953 × minimum temperature + 9.3 °C");
  assert.equal(equationText({ slope: -0.414, intercept: -2.5 }, x, y), "Maximum temperature = −0.414 × minimum temperature − 2.5 °C");
  assert.equal(sig(0.000123456), "0.000123");
});
