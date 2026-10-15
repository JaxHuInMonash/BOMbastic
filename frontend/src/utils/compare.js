/**
 * Comparing two stations (FR-04): which variables and dates they share, and
 * the difference indicators shown under the chart. Pure functions, covered by
 * `npm test`.
 *
 * Shared rule (docs/data-contract.md §5): a day counts only when both stations
 * have a single-day reading for it. A missing day is never zero and a
 * multi-day value is never one day's value, so neither is paired.
 */

/** Variables both stations record, in the order the API lists them. */
export function sharedVariables(variables, a, b) {
  const has = (s, code) => s.variables.some((v) => v.variable_code === code);
  return variables.filter((v) => has(a, v.variable_code) && has(b, v.variable_code));
}

/** The variable to compare: the one chosen if both record it, else rainfall, else the first shared. */
export function compareVariable(shared, chosen) {
  const codes = shared.map((v) => v.variable_code);
  if (codes.includes(chosen)) return chosen;
  if (codes.includes("rainfall")) return "rainfall";
  return codes[0] ?? null;
}

/** The dates both stations recorded a variable: the later start and the earlier end, or null. */
export function overlapOf(a, b) {
  if (!a?.first_date || !b?.first_date) return null;
  const first_date = a.first_date > b.first_date ? a.first_date : b.first_date;
  const last_date = a.last_date < b.last_date ? a.last_date : b.last_date;
  return first_date <= last_date ? { first_date, last_date } : null;
}

const single = (d) => (d.kind === "value" ? d.value : null);

/**
 * Day-by-day A − B for two classified day lists over the same dates
 * (utils/rainfall.js classifyDays): the difference, or null where either
 * station lacks a single-day reading.
 */
export function differences(daysA, daysB) {
  return {
    dates: daysA.map((d) => d.date),
    values: daysA.map((d, i) => {
      const a = single(d);
      const b = single(daysB[i]);
      return a === null || b === null ? null : Math.round((a - b) * 100) / 100;
    }),
  };
}

/** Temperature indicators on paired days, or null when no day is paired. */
export function compareTemperature(daysA, daysB) {
  let n = 0;
  let sumA = 0;
  let sumB = 0;
  let aHigher = 0;
  let bHigher = 0;
  let largest = null;
  daysA.forEach((d, i) => {
    const a = single(d);
    const b = single(daysB[i]);
    if (a === null || b === null) return;
    n += 1;
    sumA += a;
    sumB += b;
    if (a > b) aHigher += 1;
    else if (b > a) bHigher += 1;
    if (!largest || Math.abs(a - b) > Math.abs(largest.difference)) largest = { date: d.date, a, b, difference: Math.round((a - b) * 100) / 100 };
  });
  if (n === 0) return null;
  const round = (v) => Math.round(v * 100) / 100;
  return { days: n, meanA: round(sumA / n), meanB: round(sumB / n), meanDifference: round((sumA - sumB) / n), aHigher, bHigher, largest };
}

/** Rainfall indicators: rain days (a single-day reading of at least 1 mm) at each station, over its own readings. */
export function rainDays(days, threshold = 1) {
  return days.filter((d) => d.kind === "value" && d.value >= threshold).length;
}

