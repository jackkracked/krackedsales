import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { ghl, locationId } from "@/lib/ghl/client";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface GhlEvent {
  id: string;
  title?: string;
  calendarId: string;
  contactId?: string;
  startTime: string;
  endTime: string;
  appointmentStatus?: string;
  notes?: string;
  [key: string]: unknown;
}

interface GhlEventsResponse {
  events: GhlEvent[];
}

/** GET /api/calendar/ghl-events — fetch GHL appointments for given calendars + time range */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const calendarIdsParam = searchParams.get("calendarIds");
  const startTime = searchParams.get("startTime");
  const endTime = searchParams.get("endTime");

  if (!calendarIdsParam || !startTime || !endTime) {
    return NextResponse.json(
      { error: "Missing required query params: calendarIds, startTime, endTime" },
      { status: 400 }
    );
  }

  const calendarIds = calendarIdsParam.split(",").map((id) => id.trim()).filter(Boolean);
  if (calendarIds.length === 0) {
    return NextResponse.json({ events: [] });
  }

  const loc = locationId();
  const allEvents: GhlEvent[] = [];
  const errors: { calendarId: string; error: string }[] = [];

  await Promise.all(
    calendarIds.map(async (calId) => {
      try {
        const data = await ghl.get<GhlEventsResponse>(
          `/calendars/events?locationId=${loc}&calendarId=${calId}&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`
        );
        for (const event of data.events ?? []) {
          allEvents.push(event);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ calendarId: calId, error: message });
        console.error(`[ghl-events] Failed to fetch for calendar ${calId}:`, message);
      }
    })
  );

  // Sort by startTime ascending
  allEvents.sort((a, b) => a.startTime.localeCompare(b.startTime));

  return NextResponse.json({
    events: allEvents,
    ...(errors.length > 0 ? { errors } : {}),
  });
}
