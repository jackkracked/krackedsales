/**
 * "Calls Logged" = calls that were actually TAKEN, not calls that are merely
 * on the calendar for later, and not calls that never connected.
 *
 * This one predicate is the single source of truth, shared by:
 *   - the dashboard "Calls Logged" card   (app/api/dashboard/kpis/route.ts)
 *   - the /kpis engine "calls" dataset     (lib/kpi/engine/datasets/calls.ts)
 *   - the detail drawer list               (app/api/kpis/detail/route.ts)
 * so the headline number and the drilled-in list can never drift apart.
 *
 *   meet  , a booked video call counts once it has started (startedAt <= now)
 *            and was not a no-show or a cancellation. A past appointment still
 *            sitting as "booked"/"confirmed" (the rep never updated GHL) is
 *            treated as held; only an explicit no-show/cancel is excluded.
 *   dialer, a phone call counts once it has happened and actually connected.
 *            Ringing / no-answer / busy / failed / in-progress never connected,
 *            so they do not count. A logged past dialer call with no status
 *            (GHL dialer history) is a real, completed call → counts.
 */

export type TakenCallRow = {
  callType: string | null;
  status: string | null;
  startedAt: Date | string | number | null;
  durationSeconds?: number | null;
};

// Dialer statuses that mean the call never actually connected.
const DIALER_NOT_CONNECTED = new Set([
  "queued",
  "ringing",
  "in_progress",
  "in-progress",
  "no-answer",
  "no_answer",
  "busy",
  "failed",
  "canceled",
  "cancelled",
]);

// Meet statuses that mean the appointment did not happen.
const MEET_NOT_HELD = new Set(["noshow", "no_show", "cancelled", "canceled"]);

export function isTakenCall(row: TakenCallRow, nowMs: number): boolean {
  if (row.startedAt == null) return false;
  const t =
    row.startedAt instanceof Date
      ? row.startedAt.getTime()
      : new Date(row.startedAt).getTime();
  if (Number.isNaN(t)) return false;

  // Upcoming calls never count as "logged".
  if (t > nowMs) return false;

  const status = (row.status ?? "").toString().trim().toLowerCase();

  if (row.callType === "meet") {
    return !MEET_NOT_HELD.has(status);
  }

  // dialer (or any non-meet): only an explicitly-unconnected status is excluded;
  // a null/empty status is a completed logged call.
  if (status && DIALER_NOT_CONNECTED.has(status)) return false;
  return true;
}
