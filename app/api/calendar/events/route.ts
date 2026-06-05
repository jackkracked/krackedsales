import { NextRequest, NextResponse } from "next/server";
import { calendarClient, isGoogleConfigured } from "@/lib/google/client";
import { ghl, locationId } from "@/lib/ghl/client";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface CalendarEvent {
  id: string;
  summary: string;
  description: string | null | undefined;
  start: { dateTime?: string | null; date?: string | null };
  end: { dateTime?: string | null; date?: string | null };
  repEmail: string;
  repId?: string;
  contactId?: string | null;
  hangoutLink: string | null | undefined;
  attendees: { email?: string | null; displayName?: string | null }[];
  source: "ghl" | "google";
  appointmentStatus?: string;
}

interface GhlCalendarEvent {
  id: string;
  title?: string;
  calendarId?: string;
  contactId?: string;
  startTime: string;
  endTime: string;
  appointmentStatus?: string;
  assignedUserId?: string;
  address?: string;
  notes?: string;
  users?: string[];
  [key: string]: unknown;
}

const parseGhlDate = (s: string): Date =>
  new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");

function ghlEventToCalendarEvent(
  evt: GhlCalendarEvent,
  repId: string,
): CalendarEvent {
  return {
    id: evt.id,
    summary: evt.title ?? "Appointment",
    description: evt.notes ?? null,
    start: { dateTime: parseGhlDate(evt.startTime).toISOString() },
    end: { dateTime: parseGhlDate(evt.endTime).toISOString() },
    repEmail: "",
    repId,
    contactId: evt.contactId ?? null,
    hangoutLink: evt.address?.includes("meet.google.com") ? evt.address : null,
    attendees: evt.title ? [{ email: null, displayName: evt.title }] : [],
    source: "ghl",
    appointmentStatus: evt.appointmentStatus,
  };
}

/**
 * GET /api/calendar/events
 *
 * Strategy (fastest to slowest):
 * 1. If GHL userIds provided → /calendars/events?userId=X per user (2 calls)
 * 2. If no userIds → /calendars/events?calendarId=X per calendar (~10 calls)
 * All use epoch-millisecond timestamps (the format GHL accepts).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const emailsParam = searchParams.get("emails");
  const userIdsParam = searchParams.get("userIds");
  const since = searchParams.get("since");
  const until = searchParams.get("until");

  if (!since || !until) {
    return NextResponse.json(
      { error: "Missing required query params: since, until" },
      { status: 400 },
    );
  }

  const emails = emailsParam
    ? emailsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const userIds = userIdsParam
    ? userIdsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const allEvents: CalendarEvent[] = [];
  const seenEventIds = new Set<string>();
  const errors: { rep: string; error: string }[] = [];

  const loc = locationId();
  const sinceMs = new Date(since).getTime();
  const untilMs = new Date(until).getTime();

  // --- 1. Fetch GHL events ---
  try {
    let ghlEvents: GhlCalendarEvent[] = [];

    if (userIds.length > 0) {
      // Strategy A: per-userId (fast — one call per rep)
      const results = await Promise.allSettled(
        userIds.map((userId) =>
          ghl.get<{ events: GhlCalendarEvent[] }>(
            `/calendars/events?locationId=${loc}&userId=${userId}&startTime=${sinceMs}&endTime=${untilMs}`,
          ),
        ),
      );

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === "fulfilled") {
          for (const evt of r.value.events ?? []) {
            // Tag each event with the userId we fetched it for
            if (!evt.assignedUserId) evt.assignedUserId = userIds[i];
            ghlEvents.push(evt);
          }
        } else {
          errors.push({ rep: userIds[i], error: `GHL userId: ${r.reason}` });
        }
      }
    }

    // Strategy B: if no userIds OR userId approach returned nothing,
    // try per-calendarId (covers all calendars, ~10 calls)
    if (ghlEvents.length === 0) {
      try {
        const calsData = await ghl.get<{ calendars: { id: string }[] }>(
          `/calendars/?locationId=${loc}`,
        );
        const calIds = (calsData.calendars ?? []).map((c) => c.id);

        if (calIds.length > 0) {
          const calResults = await Promise.allSettled(
            calIds.map((calId) =>
              ghl.get<{ events: GhlCalendarEvent[] }>(
                `/calendars/events?locationId=${loc}&calendarId=${calId}&startTime=${sinceMs}&endTime=${untilMs}`,
              ),
            ),
          );

          for (const r of calResults) {
            if (r.status === "fulfilled") {
              ghlEvents.push(...(r.value.events ?? []));
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ rep: "ghl-calendars", error: message });
      }
    }

    // Convert and deduplicate
    for (const evt of ghlEvents) {
      if (seenEventIds.has(evt.id)) continue;
      seenEventIds.add(evt.id);

      const repId = evt.assignedUserId ?? evt.users?.[0] ?? "";
      allEvents.push(ghlEventToCalendarEvent(evt, repId));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push({ rep: "ghl", error: message });
    console.error("[calendar/events] GHL fetch failed:", message);
  }

  // --- 2. Fetch Google Calendar events (if configured) ---
  const googleConfigured = isGoogleConfigured();
  if (googleConfigured && emails.length > 0) {
    const googleFetches = emails.map(async (repEmail) => {
      try {
        const cal = await calendarClient(repEmail);
        const res = await cal.events.list({
          calendarId: "primary",
          timeMin: since,
          timeMax: until,
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 250,
        });

        for (const item of res.data.items ?? []) {
          const eventId = item.id ?? "";
          if (seenEventIds.has(eventId)) continue;
          seenEventIds.add(eventId);

          allEvents.push({
            id: eventId,
            summary: item.summary ?? "",
            description: item.description,
            start: { dateTime: item.start?.dateTime, date: item.start?.date },
            end: { dateTime: item.end?.dateTime, date: item.end?.date },
            repEmail,
            hangoutLink: item.hangoutLink,
            attendees: (item.attendees ?? []).map((a) => ({
              email: a.email,
              displayName: a.displayName,
            })),
            source: "google",
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ rep: repEmail, error: `Google: ${message}` });
      }
    });

    await Promise.all(googleFetches);
  }

  allEvents.sort((a, b) => {
    const aTime = a.start.dateTime ?? a.start.date ?? "";
    const bTime = b.start.dateTime ?? b.start.date ?? "";
    return aTime.localeCompare(bTime);
  });

  return NextResponse.json({
    events: allEvents,
    ...(errors.length > 0 ? { errors } : {}),
  });
}
