import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { demoGhlLinks } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { ghl, locationId } from "@/lib/ghl/client";
import type { GHLCalendarEvent } from "@/lib/ghl/types";

export const dynamic = "force-dynamic";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface TaskRef {
  id: string;
  name: string;
  dateSent: string; // ISO string
  brandHubUrl: string | null; // Brand Hub custom field from ClickUp — preferred for GHL search
}

export interface DemoLinkData {
  ghlContactId: string | null;
  firstCallAt: string | null;
  callStatus: "booked" | "awaiting" | "no_response" | "unlinked";
  daysToCall: number | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Normalise a URL or brand name to a clean search term */
function normaliseSearchTerm(input: string): string {
  return input
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim();
}

/**
 * Find GHL contact ID.
 * Prefers brandHubUrl (domain from ClickUp custom field) for reliable matching.
 * Falls back to brand name extracted from the task title.
 */
async function findGhlContact(task: TaskRef): Promise<string | null> {
  // Build search term: prefer Brand Hub URL (a real domain), fall back to task name prefix
  const raw = task.brandHubUrl
    ? task.brandHubUrl
    : task.name.includes(": ")
    ? task.name.split(": ")[0].trim()
    : task.name;

  const term = normaliseSearchTerm(raw);

  try {
    const loc = locationId();
    const res = await ghl.get<{ contacts: Array<{ id: string }> }>(
      `/contacts/?locationId=${loc}&query=${encodeURIComponent(term)}&limit=3`
    );
    return res.contacts?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch all calendar events from `afterDate` to now, return the first one
 * that belongs to this contactId — this is the first intro call booked.
 */
async function findFirstCall(
  contactId: string,
  afterDate: Date,
  allEvents: GHLCalendarEvent[]
): Promise<Date | null> {
  const events = allEvents
    .filter(
      (e) =>
        e.contactId === contactId &&
        e.status !== "cancelled" &&
        new Date(e.startTime) > afterDate
    )
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  return events[0] ? new Date(events[0].startTime) : null;
}

/** Fetch all calendar events from a start date to now (handles pagination) */
async function fetchCalendarEvents(fromDate: Date): Promise<GHLCalendarEvent[]> {
  try {
    const loc = locationId();
    const start = fromDate.getTime();
    const end = Date.now();

    const res = await ghl.get<{ events: GHLCalendarEvent[] }>(
      `/calendars/events?locationId=${loc}&startTime=${start}&endTime=${end}&limit=200`
    );
    return res.events ?? [];
  } catch {
    return [];
  }
}

function computeCallStatus(
  ghlContactId: string | null,
  firstCallAt: Date | null | undefined,
  dateSent: Date
): DemoLinkData["callStatus"] {
  if (!ghlContactId) return "unlinked";
  if (firstCallAt) return "booked";
  const daysSinceSent = (Date.now() - dateSent.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceSent >= 14 ? "no_response" : "awaiting";
}

// ─── POST handler ───────────────────────────────────────────────────────────────

/**
 * POST /api/demo-tracker/ghl-links
 * Body: { tasks: TaskRef[] }
 * Returns: { links: Record<taskId, DemoLinkData> }
 *
 * Behaviour:
 * - Returns cached DB rows immediately (< 6h old if no call yet; permanent once call found)
 * - For stale or missing rows: runs GHL contact lookup + calendar check
 * - Processes up to 10 uncached tasks per request (rate-limit protection)
 */
export async function POST(req: NextRequest) {
  const { tasks } = (await req.json()) as { tasks: TaskRef[] };
  if (!tasks?.length) return NextResponse.json({ links: {} });

  const taskIds = tasks.map((t) => t.id);
  const links: Record<string, DemoLinkData> = {};

  // ── 1. Fetch all existing DB records in one query ──
  const existing = await db()
    .select()
    .from(demoGhlLinks)
    .where(inArray(demoGhlLinks.clickupTaskId, taskIds))
    .catch(() => []);

  const cachedById = new Map(existing.map((r) => [r.clickupTaskId, r]));

  // ── 2. Classify which tasks need fresh GHL lookups ──
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  const needsLookup: TaskRef[] = [];

  for (const task of tasks) {
    const cached = cachedById.get(task.id);

    // Already has a call booked — never needs to re-check
    if (cached?.firstCallAt) {
      links[task.id] = {
        ghlContactId: cached.ghlContactId,
        firstCallAt: cached.firstCallAt.toISOString(),
        callStatus: "booked",
        daysToCall: cached.dateSentAt
          ? Math.round(
              (cached.firstCallAt.getTime() - cached.dateSentAt.getTime()) /
                (1000 * 60 * 60 * 24)
            )
          : null,
      };
      continue;
    }

    // Cached within 6h (no call yet but checked recently)
    if (cached && Date.now() - cached.checkedAt.getTime() < SIX_HOURS) {
      const dateSent = cached.dateSentAt ?? new Date(task.dateSent);
      links[task.id] = {
        ghlContactId: cached.ghlContactId,
        firstCallAt: null,
        callStatus: computeCallStatus(cached.ghlContactId, null, dateSent),
        daysToCall: null,
      };
      continue;
    }

    needsLookup.push(task);
  }

  // ── 3. For uncached tasks (max 10 per request), run GHL lookups ──
  const toProcess = needsLookup.slice(0, 10);
  if (toProcess.length > 0) {
    // Find earliest dateSent to know how far back to fetch calendar events
    const earliestSent = toProcess.reduce((min, t) => {
      const d = new Date(t.dateSent);
      return d < min ? d : min;
    }, new Date());

    // Fetch calendar events for the whole range in one call
    const calendarEvents = await fetchCalendarEvents(earliestSent);

    // Process each task in parallel
    await Promise.all(
      toProcess.map(async (task) => {
        const dateSent = new Date(task.dateSent);

        const ghlContactId = await findGhlContact(task);
        let firstCallAt: Date | null = null;

        if (ghlContactId) {
          firstCallAt = await findFirstCall(ghlContactId, dateSent, calendarEvents);
        }

        // Upsert DB record
        await db()
          .insert(demoGhlLinks)
          .values({
            clickupTaskId: task.id,
            ghlContactId,
            dateSentAt: dateSent,
            firstCallAt,
            linkedAt: new Date(),
            checkedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: demoGhlLinks.clickupTaskId,
            set: {
              ghlContactId,
              dateSentAt: dateSent,
              firstCallAt,
              checkedAt: new Date(),
            },
          })
          .catch((err) => console.error("[ghl-links] upsert failed:", err));

        links[task.id] = {
          ghlContactId,
          firstCallAt: firstCallAt?.toISOString() ?? null,
          callStatus: computeCallStatus(ghlContactId, firstCallAt, dateSent),
          daysToCall: firstCallAt
            ? Math.round(
                (firstCallAt.getTime() - dateSent.getTime()) / (1000 * 60 * 60 * 24)
              )
            : null,
        };
      })
    );
  }

  return NextResponse.json({ links });
}
