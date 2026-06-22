import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import { db } from "@/lib/db";
import { demoBoards, users } from "@/lib/db/schema";
import { getBoardByToken, logBoardEvent } from "@/lib/demo-boards/queries";
import { resolveBoardCalendar } from "@/lib/demo-boards/booking-routing";
import { notifySlack } from "@/lib/demo-boards/slack-adapter";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

interface ApptResponse {
  id: string;
  [k: string]: unknown;
}

/**
 * POST /api/boards/public/[token]/book
 * The prospect books a call from their board. Creates a GHL appointment on the
 * routed rep's calendar (reusing the proven /calendars/events/appointments path),
 * attributes it to the board (status → booked, bookedAt), and notifies the team.
 * Body: { startTime, endTime, timezone }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const body = await req.json().catch(() => ({}));
    const startTime = String(body?.startTime ?? "");
    if (!startTime) return NextResponse.json({ error: "Pick a time." }, { status: 400 });
    // GHL accepts a 30-min default if endTime is omitted; compute one to be safe.
    const endTime = body?.endTime
      ? String(body.endTime)
      : new Date(new Date(startTime).getTime() + 30 * 60 * 1000).toISOString();

    const board = await getBoardByToken(token);
    if (!board) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (!board.ghlContactId) {
      return NextResponse.json({ error: "This board has no linked contact." }, { status: 409 });
    }

    const cal = await resolveBoardCalendar(board.id);
    if (!cal) {
      return NextResponse.json({ error: "No calendar is available right now." }, { status: 503 });
    }

    let appointmentId: string;
    try {
      const appt = await ghl.post<ApptResponse>("/calendars/events/appointments", {
        locationId: locationId(),
        calendarId: cal.ghlCalendarId,
        contactId: board.ghlContactId,
        title: `Demo call with ${board.contactName}`,
        startTime,
        endTime,
        notes: `Booked from the demo board (${board.referenceCode}).`,
      });
      appointmentId = appt.id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[boards book] GHL appointment failed", msg);
      return NextResponse.json({ error: "Couldn’t book that time. Try another." }, { status: 502 });
    }

    // Attribute the booking to the board.
    await db()
      .update(demoBoards)
      .set({ status: "booked", bookedAt: new Date(), updatedAt: new Date() })
      .where(eq(demoBoards.id, board.id));

    await logBoardEvent({
      boardId: board.id,
      type: "booked",
      actor: "prospect",
      metadata: { startTime, appointmentId, calendarId: cal.ghlCalendarId },
    });

    // Notify the rep.
    const repName = board.repId
      ? (await db().select({ name: users.name }).from(users).where(eq(users.id, board.repId)).limit(1))[0]?.name ?? cal.repName
      : cal.repName;
    await notifySlack.booked(board.contactName, repName);

    return NextResponse.json({ ok: true, startTime, rep: cal.repName });
  } catch (err) {
    console.error("[POST /api/boards/public/[token]/book]", err);
    return NextResponse.json({ error: "Couldn’t complete the booking." }, { status: 500 });
  }
}
