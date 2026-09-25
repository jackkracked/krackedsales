import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { bookingLinks } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { ghl, locationId } from "@/lib/ghl/client";
import { logActivity } from "@/lib/activity/logger";

export const dynamic = "force-dynamic";

/**
 * Book a prospect straight into a calendar, while you have them on the phone.
 *
 * WHY `postOnce` AND NOT `post`
 * `ghl.post` retries on a status-0 error, which includes this client's own 20s abort. GoHighLevel
 * regularly takes longer than that under load, completes the write, and only then loses the race —
 * so a retry would create the SAME appointment twice, and each one fires that calendar's
 * automations at the customer. `postOnce` sends exactly once. See lib/ghl/client.ts, and the
 * 2026-08-13 wrong-contact incident in tasks/HANDOFF-proposal-dates.md.
 *
 * The attribution row is written to the same table as sent links, with `delivery = 'booked'`.
 * One place answers "who earned this booked call", whether it came from a link they clicked or
 * a slot the rep picked on the phone.
 */
/**
 * Did this insert lose to the "one appointment pays one link" index?
 *
 * Drizzle wraps the driver error, so the Postgres code lives on `err.cause`, never in the
 * message. See lib/booking/attribute.ts, which carries the same walk for the same reason.
 */
function isDuplicateAppointment(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 5; depth++) {
    const c = e as { code?: string; constraint?: string; cause?: unknown };
    if (c.code === "23505" || c.constraint === "booking_links_appointment_uniq") return true;
    e = c.cause;
  }
  return false;
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.isActive) return NextResponse.json({ error: "Account is deactivated" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    contactId?: string;
    contactName?: string;
    calendarId?: string;
    /** ISO string with offset, exactly as the slots endpoint returned it. */
    startTime?: string;
    timezone?: string;
  };
  const { contactId, calendarId, startTime } = body;
  if (!contactId || !calendarId || !startTime) {
    return NextResponse.json({ error: "contactId, calendarId and startTime are required" }, { status: 400 });
  }

  try {
    const cals = await ghl.get<{ calendars?: Array<{ id: string; name: string }> }>(
      `/calendars/?locationId=${locationId()}`,
    );
    const calendar = (cals.calendars ?? []).find((c) => c.id === calendarId);
    if (!calendar) return NextResponse.json({ error: "That calendar no longer exists" }, { status: 400 });

    // EXACTLY ONCE. A duplicate appointment is not a tidy-up job: it double-books the rep and
    // sends the customer two confirmations.
    const created = await ghl.postOnce<{ id?: string; appointment?: { id?: string } }>(
      "/calendars/events/appointments",
      {
        calendarId,
        locationId: locationId(),
        contactId,
        startTime,
        // Booked BY this rep, so GoHighLevel's own record agrees with ours.
        assignedUserId: user.ghlUserId ?? undefined,
        ignoreFreeSlotValidation: false,
        toNotify: true,
      },
    );
    const appointmentId = created?.id ?? created?.appointment?.id ?? null;
    if (!appointmentId) {
      // The appointment exists, but without its id this row cannot claim it, and the
      // attribution job could later hand the same appointment to someone's pending link. Say so
      // loudly rather than writing a row that quietly invites a double payment.
      console.error(
        "[POST /api/booking-links/book] GoHighLevel returned no appointment id; " +
        "attribution for this booking cannot be guaranteed",
        { contactId, calendarId, startTime },
      );
    }

    const [row] = await db().insert(bookingLinks).values({
      // No link is sent here, but the row still needs its own identity; the token is never
      // published, and /b/{token} would only ever redirect to the same public booking page.
      token: randomBytes(24).toString("hex"),
      ghlContactId: contactId,
      contactName: body.contactName ?? null,
      calendarId,
      calendarName: calendar.name,
      targetUrl: `https://api.leadconnectorhq.com/widget/booking/${calendarId}`,
      sentByUserId: user.id,
      sentByName: user.name,
      delivery: "booked",
      channel: "direct",
      bookedAt: new Date(),
      ghlAppointmentId: appointmentId,
    }).returning();

    logActivity({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      action: "booking.created",
      entityType: "contact",
      entityId: contactId,
      entityName: body.contactName ?? contactId,
      metadata: { calendar: calendar.name, startTime, appointmentId },
    });

    return NextResponse.json({ id: row.id, appointmentId, startTime, calendar: calendar.name });
  } catch (err) {
    // The appointment WAS created; only our attribution row lost a race with the cron, which
    // may have credited this appointment to a pending link in the moment between the two
    // writes. Reporting that as a failure would invite a retry that double-books the customer.
    if (isDuplicateAppointment(err)) {
      console.warn("[POST /api/booking-links/book] appointment already attributed", { contactId, calendarId });
      return NextResponse.json({
        id: null, appointmentId: null, startTime, calendar: undefined,
        attributed: false,
        warning: "The appointment was created. Credit for it had already been recorded elsewhere.",
      });
    }
    // A timeout may mean GoHighLevel DID create it. Say so rather than inviting a second
    // attempt that double-books the customer.
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/booking-links/book]", err);
    const timedOut = /abort|timeout/i.test(message);
    return NextResponse.json(
      {
        error: timedOut
          ? "GoHighLevel did not answer in time. Check the calendar before trying again — the appointment may already exist."
          : "Could not book that slot. It may have just been taken.",
      },
      { status: 502 },
    );
  }
}
