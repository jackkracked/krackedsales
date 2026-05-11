import { NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import { getSessionUser } from "@/lib/auth/session";
import type { GHLCalendarEvent } from "@/lib/ghl/types";
import { startOfDay, endOfDay } from "date-fns";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();

  // GHL requires userId, calendarId, or groupId — without one the request
  // returns a 422. Return empty events gracefully for users with no GHL ID set.
  if (!user?.ghlUserId) {
    return NextResponse.json({ events: [] });
  }

  try {
    const now = new Date();
    const start = startOfDay(now).getTime();
    const end = endOfDay(now).getTime();

    const data = await ghl.get<{ events: GHLCalendarEvent[] }>(
      `/calendars/events?locationId=${locationId()}&userId=${user.ghlUserId}&startTime=${start}&endTime=${end}`
    );

    return NextResponse.json(data);
  } catch (err) {
    console.error("[GET /api/ghl/calendar]", err);
    return NextResponse.json({ events: [] });
  }
}
