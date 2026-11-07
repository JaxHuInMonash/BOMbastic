/**
 * Date-range presets and how a range resolves against what a station recorded.
 */

import { laterOf, yearsBefore } from "./dates";

export const PRESETS = [
  { key: "1y", label: "1 year", years: 1 },
  { key: "5y", label: "5 years", years: 5 },
  { key: "10y", label: "10 years", years: 10 },
];

/**
 * Presets count back from the last day this station recorded this variable,
 * not from today, so a station that stopped in 2003 still opens on data.
 * They never reach before the first recorded day.
 */
export function resolveRange(range, available) {
  if (range.preset === "custom") return { start: range.start, end: range.end };
  const preset = PRESETS.find((p) => p.key === range.preset) ?? PRESETS[0];
  const end = available.last_date;
  return { start: laterOf(yearsBefore(end, preset.years), available.first_date), end };
}
