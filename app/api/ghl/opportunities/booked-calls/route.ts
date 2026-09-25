import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import { isBookedCallCalendar } from "@/lib/booking/calendars";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// The business reports in Eastern time (the daily summary derives "this month" in
// America/New_York). Booking-date boundaries must match, or a booking made late on the
// 1st/last day of the month lands in the wrong month.
const BUSINESS_TZ = "America/New_York";

interface GHLCalendar { id: string; name?: string }
interface GHLCalendarEvent {
  id: string;
  startTime?: string;
  dateAdded?: string; // when the appointment was BOOKED (created) — the metric's basis
  contactId?: string;
  deleted?: boolean;
  appointmentStatus?: string; // "confirmed" | "cancelled" | "showed" | "noshow" ...
  status?: string;
}

/**
 * "Booked This Month" counts calls by the date they were BOOKED (GHL `dateAdded`), NOT by when
 * the call happens — a call booked this month for a slot next month counts THIS month (Jack's
 * chosen definition). Rules:
 *   - distinct PROSPECTS (dedupe by contactId): a no-show who rebooks = 1 booked, not 2.
 *   - exclude cancelled + deleted appointments.
 *   - booking-date window is in the business timezone (Eastern).
 *
 * GHL's /calendars/events API only filters by the call's start time, so to catch everything
 * booked in the window (including calls scheduled far ahead) we fetch a WIDE start-time range
 * from the window start to ~18 months out, then filter by dateAdded. A booked call always has
 * startTime >= dateAdded (you can't book a call in the past), so nothing booked in-window can
 * have a start time before the window start.
 */
// Which calendars count lives in lib/booking/calendars.ts, shared with the pay tracker.

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

const DAY_MS = 86_400_000;

export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since"); // YYYY-MM-DD (business tz) — BOOKING date
  const until = req.nextUrl.searchParams.get("until"); // YYYY-MM-DD (business tz, inclusive) — BOOKING date
  // Booking-date window (what we count on).
  const bookSinceMs = since ? tzDayBoundaryMs(since, false) : new Date().setDate(1);
  const bookUntilMs = until ? tzDayBoundaryMs(until, true) : Date.now();
  // Wide call-start window we must fetch to catch every event booked in that window (incl. calls
  // scheduled ahead). Floor a little before the booking-window start; ceiling ~18 months out.
  const fetchStartMs = bookSinceMs - 2 * DAY_MS;
  const fetchEndMs = Date.now() + 550 * DAY_MS;

  try {
    const loc = locationId();
    const calData = await ghl.get<{ calendars?: GHLCalendar[] }>(`/calendars/?locationId=${loc}`);
    const allCals = (calData.calendars ?? []).filter((c) => c.id);
    const cals = allCals.filter((c) => isBookedCallCalendar(c.name ?? ""));
    // Every calendar deliberately left out, named. A booked-call number that quietly omits a
    // calendar is indistinguishable from a slow week — this makes the choice inspectable.
    const excludedCalendars = allCals.filter((c) => !isBookedCallCalendar(c.name ?? "")).map((c) => c.name);

    const perCalendar = await Promise.all(
      cals.map(async (cal) => {
        try {
          const data = await ghl.get<{ events?: GHLCalendarEvent[] }>(
            `/calendars/events?locationId=${loc}&calendarId=${cal.id}&startTime=${fetchStartMs}&endTime=${fetchEndMs}`,
          );
          const events = (data.events ?? []).filter((e) => {
            if (e.deleted === true) return false;
            if ((e.appointmentStatus ?? e.status ?? "").toLowerCase() === "cancelled") return false;
            const bookedMs = e.dateAdded ? new Date(e.dateAdded).getTime() : NaN; // count by BOOKING date
            return Number.isFinite(bookedMs) && bookedMs >= bookSinceMs && bookedMs <= bookUntilMs;
          });
          return { id: cal.id, name: cal.name ?? cal.id, events };
        } catch (e) {
          console.error(`[booked-calls] events failed for ${cal.id} (${cal.name}):`, e);
          return { id: cal.id, name: cal.name ?? cal.id, events: null as GHLCalendarEvent[] | null };
        }
      }),
    );

    // If ANY matching calendar failed to read, don't report a partial number as fact.
    if (perCalendar.some((c) => c.events === null)) {
      const failed = perCalendar.filter((c) => c.events === null).map((c) => c.name);
      return NextResponse.json({ count: null, error: `calendar read failed: ${failed.join(", ")}` }, { status: 502 });
    }

    // Distinct prospects, not appointments (rebook = 1). No contactId → fall back to event id.
    const all = perCalendar.flatMap((c) => c.events ?? []);
    const count = new Set(all.map((e) => e.contactId || e.id)).size;

    console.log(`[booked-calls] ${count} prospects booked (${all.length} appts) in ${since}..${until} across ${cals.length} calendars`);
    return NextResponse.json({
      count,
      appointments: all.length,
      byCalendar: perCalendar.map((c) => ({ name: c.name, appointments: c.events?.length ?? 0 })).filter((c) => c.appointments > 0),
      excludedCalendars,
    });
  } catch (err) {
    console.error("[/api/ghl/opportunities/booked-calls]", err);
    return NextResponse.json({ count: null, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
