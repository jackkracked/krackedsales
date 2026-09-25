import { NextRequest, NextResponse } from "next/server";
import { attributeBookings } from "@/lib/booking/attribute";
import { syncAppointments } from "@/lib/tracker/appointments-sync";
import { sendTrackerNudges } from "@/lib/tracker/nudges";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/attribute-bookings
 *
 * Credits booked calls back to the tracked links that produced them, then refreshes the pay
 * tracker's copy of every booked-call appointment (cancellations included). One job rather than
 * two because both read the same calendars and the tracker should see a credit and the
 * appointment it credits in the same pass. GET because Vercel crons only ever issue GET.
 *
 * Authorization: Bearer <CRON_SECRET>.
 *
 * Always returns 200 on a completed run, including one that credited nothing: an empty result
 * is the normal state most of the day, and a non-200 would page for a job that worked fine.
 * A genuine failure is reported in the body and recorded against the job lock.
 */
export async function GET(req: NextRequest) {
  // Fails CLOSED: this job now sends Slack DMs and writes pay-tracker data, so a missing secret
  // must never mean "open to anyone". (Other crons still use the older fail-open pattern.)
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await attributeBookings();
  if (result.credited > 0 || result.status !== "ok") {
    console.log("[cron/attribute-bookings]", result);
  }
  // Independent of attribution's outcome: a failed attribution run must not also stop the
  // tracker seeing today's cancellations.
  const appointments = await syncAppointments();
  if (appointments.status !== "ok" || appointments.calendarsFailed > 0 || appointments.markedDeleted > 0) {
    console.log("[cron/attribute-bookings] appointments", appointments);
  }
  // The daily pay-tracker nudge rides the 13:20 UTC run (9:20am New York), after the sync, so
  // it reflects this morning's cancellations. Once a day per person is enforced inside.
  let nudges: { sent: number; skipped: number } | null = null;
  if (new Date().getUTCHours() === 13) {
    nudges = await sendTrackerNudges().catch((err) => {
      console.error("[cron/attribute-bookings] nudges failed", err);
      return null;
    });
  }
  return NextResponse.json({ ...result, appointments, nudges });
}
