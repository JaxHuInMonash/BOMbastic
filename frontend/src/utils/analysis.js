/**
 * Pure analysis helpers: regression (FR-05), two-station comparison (FR-04) and
 * CSV export (FR-08). No React, no network, so `npm test` covers every rule.
 *
 * Shared rule (docs/data-contract.md §5): only single-day readings with a value
 * take part. A missing day is never zero, and a multi-day total is never one
 * day's value, so neither is paired, averaged or fitted.
 */

const spanOf = (r) => r.accumulation_days ?? 1;

/** True for a record that is one day's measured value. */
export const isSingleDay = (r) => r.value !== null && r.value !== undefined && spanOf(r) <= 1;

/**
 * Pair two record lists by date. Returns only days where both have a
 * single-day value, plus how many days were dropped and why.
 */
export function pairByDate(recordsX, recordsY) {
  const y = new Map();
  for (const r of recordsY) if (isSingleDay(r)) y.set(r.date, r);
  const pairs = [];
  let usableX = 0;
  for (const r of recordsX) {
    if (!isSingleDay(r)) continue;
    usableX += 1;
    const match = y.get(r.date);
    if (match) pairs.push({ date: r.date, x: r.value, y: match.value, qx: r.quality_state, qy: match.quality_state });
  }
  return { pairs, dropped: Math.max(usableX, y.size) - pairs.length };
}

/**
 * Ordinary least squares for y = intercept + slope * x.
 * Returns { error } instead of a model when the fit would be meaningless.
 */
export function linearRegression(xs, ys) {
  const n = xs.length;
  if (n !== ys.length) return { error: "x and y must be the same length." };
  if (n < 3) return { error: `Need at least 3 paired days to fit a line; found ${n}.` };

  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(xs);
  const my = mean(ys);
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) return { error: "The x variable does not vary in this range, so no line can be fitted." };

  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const fitted = xs.map((x) => intercept + slope * x);
  const residuals = ys.map((y, i) => y - fitted[i]);
  const ssRes = residuals.reduce((s, r) => s + r * r, 0);
  const r2 = syy === 0 ? 1 : 1 - ssRes / syy;
  const rmse = Math.sqrt(ssRes / n);
  return { n, slope, intercept, r2, rmse, fitted, residuals, xMin: Math.min(...xs), xMax: Math.max(...xs) };
}

export const predictY = (model, x) => model.intercept + model.slope * x;

/** "y = 0.82x + 3.10" with sensible rounding and sign handling. */
export function equationText(model, xLabel = "x", yLabel = "y") {
  const r = (v) => Number(v.toPrecision(3));
  const slope = r(model.slope);
  const b = r(Math.abs(model.intercept));
  const sign = model.intercept < 0 ? "−" : "+";
  return `${yLabel} = ${slope} × ${xLabel} ${sign} ${b}`;
}

/** The dates two variables (or two stations) both have: the later start and earlier end. */
export function overlapOf(a, b) {
  if (!a?.first_date || !a?.last_date || !b?.first_date || !b?.last_date) return null;
  const first_date = a.first_date > b.first_date ? a.first_date : b.first_date;
  const last_date = a.last_date < b.last_date ? a.last_date : b.last_date;
  return first_date <= last_date ? { first_date, last_date } : null;
}

/** Summary difference indicators for two stations, same variable, same range (FR-04). */
export function compareStats(recordsA, recordsB) {
  const { pairs } = pairByDate(
    recordsA.map((r) => ({ ...r })),
    recordsB.map((r) => ({ ...r })),
  );
  if (pairs.length === 0) return null;
  let sum = 0;
  let biggest = pairs[0];
  for (const p of pairs) {
    const d = p.x - p.y;
    sum += d;
    if (Math.abs(d) > Math.abs(biggest.x - biggest.y)) biggest = p;
  }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  return {
    days: pairs.length,
    meanA: mean(pairs.map((p) => p.x)),
    meanB: mean(pairs.map((p) => p.y)),
    meanDifference: sum / pairs.length,
    largest: { date: biggest.date, a: biggest.x, b: biggest.y, difference: biggest.x - biggest.y },
  };
}

const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * The records on screen as CSV (FR-08). Column names carry the unit, a missing
 * day is an empty cell (never 0), and quality and days covered travel with the
 * value so the file cannot be misread outside the app.
 */
export function toCsv(data) {
  const { station, variable } = data.query;
  const header = [
    "station_id", "station_name", "variable", "date",
    `value_${variable.unit}`, "quality", "days_covered",
  ];
  const rows = data.records.map((r) => [
    station.station_id, station.name, variable.variable_code, r.date,
    r.value === null ? "" : r.value, r.quality_state,
    r.value === null ? "" : (r.accumulation_days ?? 1),
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function csvFilename(data) {
  const { station, variable, start, end } = data.query;
  return `bombastic_${station.station_id}_${variable.variable_code}_${start}_${end}.csv`;
}
