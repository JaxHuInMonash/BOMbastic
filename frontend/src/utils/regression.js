/**
 * Small helpers for the Relationship view (FR-05). The fit itself is done by
 * the API (POST /api/v1/regressions, backend/regression.py), so the numbers on
 * screen are the ones the backend tests check. Pure functions, covered by
 * `npm test`.
 */

import { overlapOf } from "./compare.js";
import { daysBetween } from "./dates.js";

/**
 * Fewest paired days a line is fitted with. Matches the API's default
 * (backend/regression.py MIN_PAIRS); the API still decides, so if
 * BOMBASTIC_REGRESSION_MIN_PAIRS is raised it explains instead of fitting.
 */
export const MIN_PAIRS = 20;

/**
 * Could these two variables give at least MIN_PAIRS paired days? Each needs
 * that many days with a value, and their records must overlap by that many
 * days. It is an upper bound: the API pairs the actual days and may still find
 * too few in the chosen period.
 */
function canPair(a, b) {
  if (a.days_with_value < MIN_PAIRS || b.days_with_value < MIN_PAIRS) return false;
  const overlap = overlapOf(a, b);
  return Boolean(overlap) && daysBetween(overlap.first_date, overlap.last_date) >= MIN_PAIRS;
}

/** Variable codes at this station that can pair with at least one other there. */
export function pairableCodes(station) {
  const vs = station.variables;
  return vs.filter((a) => vs.some((b) => b !== a && canPair(a, b))).map((v) => v.variable_code);
}

/** Can a relationship be fitted at this station at all? */
export const canRelate = (station) => pairableCodes(station).length >= 2;

/** Stations a relationship can be fitted at: the Relationship tab's station list. */
export const regressionStations = (stations) => stations.filter(canRelate);

/** Variables, in the API's order, that can take part in a relationship at this station. */
export function stationVariables(variables, station) {
  const codes = pairableCodes(station);
  return variables.filter((v) => codes.includes(v.variable_code));
}

/** The closest of `candidates` to `station` (great-circle), with its distance in km, or null. */
export function nearestStation(station, candidates) {
  const rad = Math.PI / 180;
  const km = (s) => {
    const dLat = (s.latitude - station.latitude) * rad;
    const dLon = (s.longitude - station.longitude) * rad;
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos(station.latitude * rad) * Math.cos(s.latitude * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  };
  let best = null;
  for (const s of candidates) {
    if (s.station_id === station.station_id) continue;
    const d = km(s);
    if (!best || d < best.km) best = { station: s, km: d };
  }
  return best;
}

/**
 * Which pair to start with: minimum → maximum temperature when both exist
 * (the classic pair), else the first two the station records.
 */
export function defaultPair(codes) {
  if (codes.includes("tmin") && codes.includes("tmax")) return { x: "tmin", y: "tmax" };
  return { x: codes[0] ?? null, y: codes[1] ?? null };
}

/** Keep a chosen pair if this station has it; otherwise fall back, never x = y. */
export function resolvePair(chosen, codes) {
  const fallback = defaultPair(codes);
  const x = codes.includes(chosen.x) ? chosen.x : fallback.x;
  let y = codes.includes(chosen.y) && chosen.y !== x ? chosen.y : fallback.y;
  if (y === x) y = codes.find((c) => c !== x) ?? null;
  return { x, y };
}

/** Three significant figures, with a real minus sign. */
export function sig(v, digits = 3) {
  if (v === 0) return "0";
  const s = String(Number(v.toPrecision(digits)));
  return s.startsWith("-") ? `−${s.slice(1)}` : s;
}

/** "Max temp = 0.953 × Min temp + 9.30 °C", from the model and the two variables. */
export function equationText(model, x, y) {
  const sign = model.intercept < 0 ? "−" : "+";
  return `${y.label} = ${sig(model.slope)} × ${x.label.toLowerCase()} ${sign} ${sig(Math.abs(model.intercept))} ${y.unit}`;
}
