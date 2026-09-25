/**
 * Month arithmetic for the pay tracker, in the business timezone.
 *
 * WHY NEW YORK AND NOT UTC
 * The business reports in Eastern time (the booked-calls KPI and the daily summary both do). A
 * call at 9pm ET on the 31st is still that month to everyone who works here; in UTC it is the
 * next month, and a setter's $25 would land on the wrong sheet.
 */

export const BUSINESS_TZ = "America/New_York";

/** The first month the tracker is the system of record. Earlier months were paid from the
 *  spreadsheet, so they are shown for reference but never closed, adjusted or restored into. */
export const TRACKER_GO_LIVE_MONTH = "2026-09";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonthKey(m: string): boolean {
  return MONTH_RE.test(m);
}

/** YYYY-MM of an instant, as seen in New York. */
export function nyMonth(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  return `${y}-${m}`;
}

export function currentNyMonth(now: Date = new Date()): string {
  return nyMonth(now);
}

/** UTC instant of midnight New York time on the 1st of a month. DST-safe. */
function nyMonthStart(month: string): Date {
  const [y, m] = month.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, 1, 0, 0, 0);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: BUSINESS_TZ, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(guess).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]),
  );
  const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour === 24 ? 0 : parts.hour, parts.minute, parts.second);
  return new Date(guess - (shown - guess));
}

/** [start, end) of a month in New York, as UTC instants. */
export function nyMonthRange(month: string): { start: Date; end: Date } {
  return { start: nyMonthStart(month), end: nyMonthStart(addMonths(month, 1)) };
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** Inclusive list of months from `from` to `to`, oldest first. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** A month is over once New York has moved past it. */
export function isMonthOver(month: string, now: Date = new Date()): boolean {
  return month < currentNyMonth(now);
}
