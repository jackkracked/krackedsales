import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// The business reports in Eastern time (the daily summary derives "yesterday"/"this month" in
// America/New_York). Month boundaries must match, or a call late on the 1st/last day lands in the
// wrong month. GHL also returns events a few hours outside the requested range, so we re-filter.
const BUSINESS_TZ = "America/New_York";

interface GHLCalendar { id: string; name?: string }
interface GHLCalendarEvent {
  id: string;
  startTime?: string;
  contactId?: string;
  deleted?: boolean;
  appointmentStatus?: string; // "confirmed" | "cancelled" | "showed" | "noshow" ...
  status?: string;
}

/**
 * Which calendars count as a booked sales call. NAME-based on purpose: the old approach hardcoded
 * a single calendar id in GHL_INTRO_CALL_CALENDAR_ID, which had gone stale (pointed at an
 * abandoned "…Intro Call OLD" calendar) AND carried a trailing "\n", so every lookup 400'd and
 * the summary silently showed 0. Matching on name self-heals when a calendar is replaced or added.
 */
function isBookedCallCalendar(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes("intro call") || n.includes("demo");
}

/** UTC ms for a wall-clock day boundary (00:00:00, or 23:59:59.999) in BUSINESS_TZ, DST-safe. */
function tzDayBoundaryMs(ymd: string, endOfDay: boolean): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const guessUtc = Date.UTC(y, (m ?? 1) - 1, d ?? 1, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(fmt.formatToParts(guessUtc).filter((x) => x.type !== "literal").map((x) => [x.type, Number(x.value)]));
  const shownUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second);
  return guessUtc - (shownUtc - guessUtc); // subtract the tz offset at that instant
}

export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since"); // YYYY-MM-DD (business tz)
  const until = req.nextUrl.searchParams.get("until"); // YYYY-MM-DD (business tz, inclusive day)
  const sinceMs = since ? tzDayBoundaryMs(since, false) : new Date().setDate(1);
  const untilMs = until ? tzDayBoundaryMs(until, true) : Date.now();

  try {
    const loc = locationId();
    const calData = await ghl.get<{ calendars?: GHLCalendar[] }>(`/calendars/?locationId=${loc}`);
    const cals = (calData.calendars ?? []).filter((c) => c.id && isBookedCallCalendar(c.name ?? ""));

    const perCalendar = await Promise.all(
      cals.map(async (cal) => {
        try {
          const data = await ghl.get<{ events?: GHLCalendarEvent[] }>(
            `/calendars/events?locationId=${loc}&calendarId=${cal.id}&startTime=${sinceMs}&endTime=${untilMs}`,
          );
          const events = (data.events ?? []).filter((e) => {
            if (e.deleted === true) return false;                                   // deleted appt never counts
            if ((e.appointmentStatus ?? e.status ?? "").toLowerCase() === "cancelled") return false; // cancelled never counts
            const startMs = e.startTime ? new Date(e.startTime).getTime() : NaN;    // GHL returns a few outside the range
            return Number.isFinite(startMs) && startMs >= sinceMs && startMs <= untilMs;
          });
          return { id: cal.id, name: cal.name ?? cal.id, events };
        } catch (e) {
          console.error(`[booked-calls] events failed for ${cal.id} (${cal.name}):`, e);
          return { id: cal.id, name: cal.name ?? cal.id, events: null as GHLCalendarEvent[] | null };
        }
      }),
    );

    // If ANY matching calendar failed to read, don't under-report a partial number as fact.
    if (perCalendar.some((c) => c.events === null)) {
      const failed = perCalendar.filter((c) => c.events === null).map((c) => c.name);
      return NextResponse.json({ count: null, error: `calendar read failed: ${failed.join(", ")}` }, { status: 502 });
    }

    // Count DISTINCT prospects, not appointments: a prospect who no-shows and rebooks (two events,
    // same contactId) is ONE booked call, not two. Events with no contactId fall back to their own
    // id so they still count once each.
    const all = perCalendar.flatMap((c) => c.events ?? []);
    const distinct = new Set(all.map((e) => e.contactId || e.id));
    const count = distinct.size;

    console.log(`[booked-calls] ${count} distinct prospects (${all.length} appts) across ${cals.length} calendars (${since}..${until})`);
    return NextResponse.json({
      count,
      appointments: all.length, // non-deduped, for transparency
      byCalendar: perCalendar.map((c) => ({ name: c.name, appointments: c.events?.length ?? 0 })).filter((c) => c.appointments > 0),
    });
  } catch (err) {
    console.error("[/api/ghl/opportunities/booked-calls]", err);
    // Explicit null (not 0) so the caller shows "—", never a false 0.
    return NextResponse.json({ count: null, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
