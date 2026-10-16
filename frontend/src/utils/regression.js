/**
 * Small helpers for the Relationship view (FR-05). The fit itself is done by
 * the API (POST /api/v1/regressions, backend/regression.py), so the numbers on
 * screen are the ones the backend tests check. Pure functions, covered by
 * `npm test`.
 */

/** Variables this station records, in the API's order. */
export const stationVariables = (variables, station) =>
  variables.filter((v) => station.variables.some((sv) => sv.variable_code === v.variable_code));

/** Stations recording at least two variables: the ones a relationship can be fitted at. */
export const regressionStations = (stations) => stations.filter((s) => s.variables.length >= 2);

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
