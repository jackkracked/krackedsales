/**
 * Timezone-aware date formatting utilities.
 *
 * These replace raw date-fns `format()` calls throughout the app.
 * Pass the user's stored IANA timezone (from useUserTimezone() hook)
 * and all dates will render in that timezone regardless of the browser's local time.
 */

// ─── Core formatter ──────────────────────────────────────────────────────────

/**
 * Convert a date to the target timezone and return a Date-like object
 * that, when passed to date-fns format(), produces the correct TZ-adjusted output.
 *
 * This works by shifting the UTC time so that when format() reads it as local,
 * it shows the target timezone's wall-clock time.
 */
export function toZonedDate(date: Date | string, tz: string): Date {
  const d = typeof date === "string" ? new Date(date) : date;

  // Get the target timezone's offset by formatting in that TZ and parsing back
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";

  const year = parseInt(get("year"));
  const month = parseInt(get("month")) - 1;
  const day = parseInt(get("day"));
  let hour = parseInt(get("hour"));
  if (hour === 24) hour = 0; // midnight edge case
  const minute = parseInt(get("minute"));
  const second = parseInt(get("second"));

  // Create a date with these values as if they were local
  const zoned = new Date(year, month, day, hour, minute, second, d.getMilliseconds());
  return zoned;
}

// ─── Intl-based formatters (no date-fns dependency) ──────────────────────────

/**
 * Format a date in the user's timezone using Intl.DateTimeFormat.
 */
export function formatInTz(
  date: Date | string,
  tz: string,
  options: Intl.DateTimeFormatOptions = {}
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", { ...options, timeZone: tz });
}

/**
 * Format time only: "3:30 PM"
 */
export function formatTimeTz(date: Date | string, tz: string): string {
  return formatInTz(date, tz, { hour: "numeric", minute: "2-digit", hour12: true });
}

/**
 * Format date only: "29 May"
 */
export function formatDateShortTz(date: Date | string, tz: string): string {
  return formatInTz(date, tz, { day: "numeric", month: "short" });
}

/**
 * Format full date: "Thu 29 May 2026"
 */
export function formatDateFullTz(date: Date | string, tz: string): string {
  return formatInTz(date, tz, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

/**
 * Format date + time: "Thu 29 May · 3:30 PM"
 */
export function formatDateTimeTz(date: Date | string, tz: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const datePart = d.toLocaleDateString("en-US", { timeZone: tz, weekday: "short", day: "numeric", month: "short" });
  const timePart = d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true });
  return `${datePart} · ${timePart}`;
}

/**
 * Check if a date is "today" in a given timezone.
 */
export function isTodayInTz(date: Date | string, tz: string): boolean {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const dStr = d.toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD
  const nowStr = now.toLocaleDateString("en-CA", { timeZone: tz });
  return dStr === nowStr;
}

/**
 * Check if a date is in the past in a given timezone.
 */
export function isPastInTz(date: Date | string, tz: string): boolean {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.getTime() < Date.now();
}

/**
 * Get the short timezone abbreviation for a given IANA timezone.
 * e.g. "America/Los_Angeles" → "PDT"
 */
export function getTimezoneAbbr(timezone?: string | null): string {
  const tz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    return new Date()
      .toLocaleTimeString("en-US", { timeZone: tz, timeZoneName: "short" })
      .split(" ")
      .pop() ?? tz;
  } catch {
    return tz;
  }
}
