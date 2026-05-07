import { NextRequest, NextResponse } from "next/server";
import { calendarClient, isGoogleConfigured } from "@/lib/google/client";

export const dynamic = "force-dynamic";

interface CalendarEvent {
  id: string;
  summary: string;
  description: string | null | undefined;
  start: { dateTime?: string | null; date?: string | null };
  end: { dateTime?: string | null; date?: string | null };
  repEmail: string;
  hangoutLink: string | null | undefined;
  attendees: { email?: string | null; displayName?: string | null }[];
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const repsParam = searchParams.get("reps");
  const since = searchParams.get("since");
  const until = searchParams.get("until");

  if (!repsParam || !since || !until) {
    return NextResponse.json(
      { error: "Missing required query params: reps, since, until" },
      { status: 400 }
    );
  }

  if (!isGoogleConfigured()) {
    return NextResponse.json({ events: [], googleNotConfigured: true });
  }

  const repEmails = repsParam.split(",").map((e) => e.trim()).filter(Boolean);

  const allEvents: CalendarEvent[] = [];
  const errors: { repEmail: string; error: string }[] = [];

  await Promise.all(
    repEmails.map(async (repEmail) => {
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

        const items = res.data.items ?? [];
        for (const item of items) {
          allEvents.push({
            id: item.id ?? "",
            summary: item.summary ?? "",
            description: item.description,
            start: {
              dateTime: item.start?.dateTime,
              date: item.start?.date,
            },
            end: {
              dateTime: item.end?.dateTime,
              date: item.end?.date,
            },
            repEmail,
            hangoutLink: item.hangoutLink,
            attendees: (item.attendees ?? []).map((a) => ({
              email: a.email,
              displayName: a.displayName,
            })),
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ repEmail, error: message });
        console.error(`[calendar/events] Failed to fetch for ${repEmail}:`, message);
      }
    })
  );

  // Sort merged results by start time ascending
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
