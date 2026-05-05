import { NextRequest, NextResponse } from "next/server";
import { locationId } from "@/lib/ghl/client";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

interface GHLCalendarEvent {
  id: string;
  title: string;
  startTime: string; // ISO string e.g. "2026-04-01T09:30:00-07:00"
  appointmentStatus: string; // "confirmed" | "cancelled" | "showed" | "noshow" etc.
}

interface GHLCalendarEventsResponse {
  events: GHLCalendarEvent[];
}

function calendarId(): string {
  const id = process.env.GHL_INTRO_CALL_CALENDAR_ID;
  if (!id) throw new Error("GHL_INTRO_CALL_CALENDAR_ID is not set");
  return id;
}

export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since"); // YYYY-MM-DD
  const until = req.nextUrl.searchParams.get("until"); // YYYY-MM-DD

  try {
    const loc = locationId();
    const calId = calendarId();

    // GHL calendar events API filters by appointment startTime
    const sinceMs = since ? new Date(since).getTime() : new Date().setDate(1);
    const untilMs = until ? new Date(`${until}T23:59:59Z`).getTime() : Date.now();

    const url =
      `${GHL_BASE}/calendars/events` +
      `?locationId=${loc}&calendarId=${calId}` +
      `&startTime=${sinceMs}&endTime=${untilMs}`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.GHL_PRIVATE_TOKEN}`,
        Version: GHL_VERSION,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`GHL calendar API error ${res.status}: ${body}`);
    }

    const data = (await res.json()) as GHLCalendarEventsResponse;
    const events = data.events ?? [];

    // Count appointments that:
    // - Are NOT cancelled (confirmed, showed, noshow all count — the call was booked)
    // - Have a startTime within the requested period (GHL can return edge-case events
    //   just outside the window due to timezone handling — filter strictly here)
    const count = events.filter((e) => {
      if (e.appointmentStatus === "cancelled") return false;
      const startMs = new Date(e.startTime).getTime();
      return startMs >= sinceMs && startMs <= untilMs;
    }).length;

    console.log(`[booked-calls] Calendar events in period: ${count} (total returned: ${events.length})`);

    return NextResponse.json({ count });
  } catch (err) {
    console.error("[/api/ghl/opportunities/booked-calls]", err);
    return NextResponse.json({ count: 0 }, { status: 500 });
  }
}
