/**
 * Which calendars represent a BOOKED CALL with a prospect.
 *
 * Shared by the booked-calls KPI and the pay tracker, so the two can never disagree about which
 * calendars count. A setter paid for a call the KPI does not count, or the reverse, would be
 * argued about every month.
 *
 * Matching on "intro call" or "demo" alone silently excluded every Strategy Session and
 * Clarity Call calendar — real booked calls, taken by the closer. Measured 1-7 Aug 2026:
 * 5 counted, 1 missed on "Taylor's Strategy Sessions Calendar.". Small in that window only
 * because volume was low; structurally it was dropping a whole category of call.
 *
 * Personal calendars are excluded explicitly: "Bloo io's Personal Calendar" is not sales.
 *
 * This is a BUSINESS definition, not a technical one. The booked-calls endpoint returns
 * `byCalendar` and `excludedCalendars` so the split is always auditable rather than buried in
 * a regex — if a calendar is on the wrong side, that response says so.
 */
const BOOKED_CALL_PATTERNS = ["intro call", "demo", "strategy", "clarity call", "consult"];
const NOT_A_BOOKED_CALL = ["personal calendar"];

export function isBookedCallCalendar(name: string): boolean {
  const n = name.toLowerCase();
  if (NOT_A_BOOKED_CALL.some((p) => n.includes(p))) return false;
  return BOOKED_CALL_PATTERNS.some((p) => n.includes(p));
}
