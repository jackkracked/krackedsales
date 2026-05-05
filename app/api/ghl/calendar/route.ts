import { NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import type { GHLCalendarEvent } from "@/lib/ghl/types";
import { startOfDay, endOfDay } from "date-fns";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const now = new Date();
    const start = startOfDay(now).getTime();
    const end = endOfDay(now).getTime();

    const data = await ghl.get<{ events: GHLCalendarEvent[] }>(
      `/calendars/events?locationId=${locationId()}&startTime=${start}&endTime=${end}`
    );

    return NextResponse.json(data);
  } catch (err) {
    console.error("[GET /api/ghl/calendar]", err);
    return NextResponse.json(
      { error: "Failed to fetch calendar events" },
      { status: 500 }
    );
  }
}
