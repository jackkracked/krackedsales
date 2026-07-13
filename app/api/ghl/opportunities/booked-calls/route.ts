import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface GHLCalendar { id: string; name?: string }
interface GHLCalendarEvent {
  startTime?: string;
  appointmentStatus?: string; // "confirmed" | "cancelled" | "showed" | "noshow" ...
  status?: string;
}

/**
 * Which calendars count as a booked sales call. NAME-based on purpose: the old approach
 * hardcoded a single calendar id in GHL_INTRO_CALL_CALENDAR_ID, which had gone stale (it
 * pointed at "Email Design Demo | Intro Call OLD", an abandoned empty calendar) AND carried a
 * trailing "\n", so every lookup 400'd and the summary silently showed 0 booked calls. Matching
 * on name self-heals when a calendar is replaced (old → new) or a new intro/demo calendar is
 * added, and excludes internal/strategy calendars. Returns the per-calendar breakdown so the
 * count is always verifiable.
 */
function isBookedCallCalendar(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes("intro call") || n.includes("demo");
}

export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since"); // YYYY-MM-DD
  const until = req.nextUrl.searchParams.get("until"); // YYYY-MM-DD
  const sinceMs = since ? new Date(`${since}T00:00:00.000Z`).getTime() : new Date().setDate(1);
  const untilMs = until ? new Date(`${until}T23:59:59.999Z`).getTime() : Date.now();

  try {
    const loc = locationId();
    const calData = await ghl.get<{ calendars?: GHLCalendar[] }>(`/calendars/?locationId=${loc}`);
    const cals = (calData.calendars ?? []).filter((c) => c.id && isBookedCallCalendar(c.name ?? ""));

    // One events call per matching calendar, in parallel; a single failing calendar degrades to 0
    // for that calendar rather than failing the whole count.
    const perCalendar = await Promise.all(
      cals.map(async (cal) => {
        try {
          const data = await ghl.get<{ events?: GHLCalendarEvent[] }>(
            `/calendars/events?locationId=${loc}&calendarId=${cal.id}&startTime=${sinceMs}&endTime=${untilMs}`,
          );
          const events = data.events ?? [];
          const count = events.filter((e) => {
            const status = (e.appointmentStatus ?? e.status ?? "").toLowerCase();
            if (status === "cancelled") return false; // confirmed/showed/noshow = the call WAS booked
            const startMs = e.startTime ? new Date(e.startTime).getTime() : null;
            return startMs === null || (startMs >= sinceMs && startMs <= untilMs);
          }).length;
          return { id: cal.id, name: cal.name ?? cal.id, count };
        } catch (e) {
          console.error(`[booked-calls] events failed for ${cal.id} (${cal.name}):`, e);
          return { id: cal.id, name: cal.name ?? cal.id, count: 0, error: true };
        }
      }),
    );

    const count = perCalendar.reduce((sum, c) => sum + c.count, 0);
    console.log(`[booked-calls] ${count} across ${cals.length} calendars (${since}..${until})`);
    return NextResponse.json({
      count,
      byCalendar: perCalendar.filter((c) => c.count > 0 || "error" in c),
    });
  } catch (err) {
    console.error("[/api/ghl/opportunities/booked-calls]", err);
    // Explicit null (not 0): the caller must be able to tell "genuinely zero booked" apart from
    // "couldn't read GHL" and show "—" rather than a false 0.
    return NextResponse.json({ count: null, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
