/**
 * Date helpers that work on plain 'YYYY-MM-DD' strings, in UTC throughout, so a
 * user's time zone can never shift a day (BOM dates are calendar days).
 */

const DAY_MS = 86_400_000;

export function toDate(iso) {
  return new Date(`${iso}T00:00:00Z`);
}

export function toIso(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso, days) {
  return toIso(new Date(toDate(iso).getTime() + days * DAY_MS));
}

/** The first day of a window of `years` calendar years ending on `endIso`. */
export function yearsBefore(endIso, years) {
  const d = toDate(endIso);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return addDays(toIso(d), 1);
}

export function daysBetween(startIso, endIso) {
  return Math.round((toDate(endIso) - toDate(startIso)) / DAY_MS) + 1;
}

export function laterOf(a, b) {
  return a > b ? a : b;
}

const LONG = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function formatDate(iso) {
  return iso ? LONG.format(toDate(iso)) : "";
}
