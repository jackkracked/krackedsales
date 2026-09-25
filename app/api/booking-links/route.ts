import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { bookingLinks } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { ghl, locationId } from "@/lib/ghl/client";
import { sendGhlMessage } from "@/lib/ghl/send";
import { logActivity } from "@/lib/activity/logger";

export const dynamic = "force-dynamic";

/** GoHighLevel's booking widget. Keyed on the calendar ID, not the slug: a slug changes when
 *  someone renames a calendar, and a link already sitting in a prospect's inbox must not break.
 *  Verified 2026-09-22: this form returns 200, the slug form does not. */
const bookingUrl = (calendarId: string) =>
  `https://api.leadconnectorhq.com/widget/booking/${calendarId}`;

interface Target { type: string; conversationId?: string }

/**
 * Mint a tracked booking link, and optionally send it.
 *
 * WHY MINT AND SEND IN ONE CALL
 * If the client minted a link and then sent it separately, a failed send would leave a row
 * claiming the prospect was contacted when they were not — and that row is what pays a
 * setter's commission. Here the row is only written as "sent" once GoHighLevel accepted the
 * message. A copy-to-clipboard is recorded as "copied", which attributes a booking but is
 * never counted as outreach.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.isActive) return NextResponse.json({ error: "Account is deactivated" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    contactId?: string;
    contactName?: string;
    calendarId?: string;
    delivery?: "sent" | "copied";
    message?: string;
    targets?: Target[];
  };

  const { contactId, calendarId } = body;
  if (!contactId || !calendarId) {
    return NextResponse.json({ error: "contactId and calendarId are required" }, { status: 400 });
  }
  const delivery = body.delivery === "copied" ? "copied" : "sent";

  try {
    // Confirm the calendar is real before promising a prospect a link to it.
    const cals = await ghl.get<{ calendars?: Array<{ id: string; name: string; isActive?: boolean }> }>(
      `/calendars/?locationId=${locationId()}`,
    );
    const calendar = (cals.calendars ?? []).find((c) => c.id === calendarId);
    if (!calendar) return NextResponse.json({ error: "That calendar no longer exists" }, { status: 400 });

    const token = randomBytes(24).toString("hex");
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://kracked-sales.vercel.app";
    const trackedUrl = `${appUrl}/b/${token}`;

    // ── Send first, record second ────────────────────────────────────────────────────────
    // So a row never claims an outreach that did not happen.
    let sentChannel: string | null = null;
    if (delivery === "sent") {
      const targets = Array.isArray(body.targets) ? body.targets : [];
      if (!targets.length) {
        return NextResponse.json({ error: "No channel to send on" }, { status: 400 });
      }
      const text = (body.message ?? "").includes(trackedUrl)
        ? body.message!
        : `${(body.message ?? "").trim()}\n\n${trackedUrl}`.trim();

      // `sendGhlMessage` THROWS on failure rather than returning a result — the same shape
      // app/api/inbox/send/route.ts relies on. Reaching the next line means it went out.
      const target = targets[0];
      try {
        await sendGhlMessage({
          contactId,
          type: target.type,
          message: text,
          conversationId: target.conversationId,
        });
      } catch (e) {
        console.error("[booking-links] send failed", e);
        return NextResponse.json({ error: "Could not send the booking link" }, { status: 502 });
      }
      sentChannel = target.type;
    }

    const [row] = await db().insert(bookingLinks).values({
      token,
      ghlContactId: contactId,
      contactName: body.contactName ?? null,
      calendarId,
      calendarName: calendar.name,
      targetUrl: bookingUrl(calendarId),
      sentByUserId: user.id,
      sentByName: user.name,
      delivery,
      channel: sentChannel,
    }).returning();

    logActivity({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      action: delivery === "sent" ? "booking_link.sent" : "booking_link.copied",
      entityType: "contact",
      entityId: contactId,
      entityName: body.contactName ?? contactId,
      metadata: { calendar: calendar.name, channel: sentChannel },
    });

    return NextResponse.json({ id: row.id, url: trackedUrl, delivery, channel: sentChannel });
  } catch (err) {
    console.error("[POST /api/booking-links]", err);
    return NextResponse.json({ error: "Could not create the booking link" }, { status: 500 });
  }
}
