import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import { db } from "@/lib/db";
import { callDispositions, users } from "@/lib/db/schema";
import { eq, inArray, isNotNull } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import type { GHLCalendarEvent } from "@/lib/ghl/types";

export const dynamic = "force-dynamic";

interface EnrichedEvent extends GHLCalendarEvent {
  repEmail?: string;
  repName?: string;
  calendarName?: string;
  isPast: boolean;
}

interface GHLCalendarResponse {
  events?: GHLCalendarEvent[];
}

/** Map of GHL calendarId → calendar name (e.g. "Demo Intro Call"), so each
 * call tile can show what the call is for. Non-fatal: empty map on failure. */
async function fetchCalendarNames(): Promise<Map<string, string>> {
  try {
    const data = await ghl.get<{ calendars?: Array<{ id: string; name: string }> }>(
      `/calendars/?locationId=${locationId()}`
    );
    return new Map((data.calendars ?? []).map((c) => [c.id, c.name]));
  } catch {
    return new Map();
  }
}

async function fetchEventsForUser(
  ghlUserId: string,
  startMs: number,
  endMs: number,
  repEmail?: string,
  repName?: string
): Promise<EnrichedEvent[]> {
  try {
    const data = await ghl.get<GHLCalendarResponse>(
      `/calendars/events?locationId=${locationId()}&userId=${ghlUserId}&startTime=${startMs}&endTime=${endMs}`
    );
    const now = new Date();
    return (data.events ?? []).map((e) => ({
      ...e,
      repEmail,
      repName,
      isPast: new Date(e.startTime) < now,
    }));
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const repParam = searchParams.get("rep");       // admin: specific rep email
  const allReps = searchParams.get("allReps") === "true"; // admin: all reps

  const isAdmin = user.role === "admin";

  // Date range: 14 days back to 30 days forward
  const now = new Date();
  const startMs = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).getTime();
  const endMs = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).getTime();

  // Fetch all active users for admin rep switcher options
  const allUsers = await db()
    .select({ id: users.id, name: users.name, email: users.email, ghlUserId: users.ghlUserId })
    .from(users)
    .where(isNotNull(users.ghlUserId));

  const repOptions = allUsers.map((u) => ({ email: u.email, name: u.name }));

  // Determine which users to fetch events for
  let targetUsers: Array<{ email: string; name: string; ghlUserId: string }> = [];

  if (isAdmin && allReps) {
    targetUsers = allUsers
      .filter((u) => u.ghlUserId)
      .map((u) => ({ email: u.email, name: u.name, ghlUserId: u.ghlUserId! }));
  } else if (isAdmin && repParam) {
    const rep = allUsers.find((u) => u.email === repParam && u.ghlUserId);
    if (rep) targetUsers = [{ email: rep.email, name: rep.name, ghlUserId: rep.ghlUserId! }];
  } else {
    // Default: current user's own events
    if (user.ghlUserId) {
      targetUsers = [{ email: user.email, name: user.name, ghlUserId: user.ghlUserId }];
    }
  }

  if (targetUsers.length === 0) {
    return NextResponse.json({ events: [], repOptions });
  }

  // Fetch GHL events for all target users + the calendar-name map in parallel
  const [eventArrays, calendarNames] = await Promise.all([
    Promise.all(
      targetUsers.map((u) =>
        fetchEventsForUser(u.ghlUserId, startMs, endMs, u.email, u.name)
      )
    ),
    fetchCalendarNames(),
  ]);
  const rawEvents = eventArrays.flat();

  // Deduplicate across reps: same call appears in multiple calendars when
  // both reps are attendees. Key on startTime + title (lowercased).
  // Keep the first occurrence's ID as the canonical event ID; merge rep names.
  const deduped = new Map<string, EnrichedEvent>();
  for (const event of rawEvents) {
    const key = `${event.startTime}::${event.title.toLowerCase().trim()}`;
    if (deduped.has(key)) {
      const existing = deduped.get(key)!;
      // Append rep name if different
      if (event.repName && existing.repName && !existing.repName.includes(event.repName.split(" ")[0])) {
        existing.repName = `${existing.repName}, ${event.repName.split(" ")[0]}`;
      }
    } else {
      deduped.set(key, { ...event });
    }
  }
  const allEvents = Array.from(deduped.values());

  // Get all event IDs so we can filter out already-dispositioned ones
  const eventIds = allEvents.map((e) => e.id).filter(Boolean);
  if (eventIds.length === 0) {
    return NextResponse.json({ events: [], repOptions });
  }

  const dispositioned = await db()
    .select({ calendarEventId: callDispositions.calendarEventId })
    .from(callDispositions)
    .where(inArray(callDispositions.calendarEventId, eventIds));

  const dispositionedIds = new Set(dispositioned.map((d) => d.calendarEventId));

  // Filter out dispositioned events, then split into past and upcoming
  const undispositioned = allEvents.filter((e) => !dispositionedIds.has(e.id));
  const nowMs = now.getTime();

  const pastPending = undispositioned
    .filter((e) => new Date(e.startTime).getTime() < nowMs)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  const upcomingPending = undispositioned
    .filter((e) => new Date(e.startTime).getTime() >= nowMs)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  // Only show the 4 most recent past calls — reps won't remember older ones
  const recentPast = pastPending.slice(-4);

  const pending = [...recentPast, ...upcomingPending].map((e) => ({
    ...e,
    calendarName: e.calendarId ? calendarNames.get(e.calendarId) ?? null : null,
  }));

  return NextResponse.json({ events: pending, repOptions });
}
