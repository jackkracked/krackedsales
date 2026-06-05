import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { callPreps, users } from "@/lib/db/schema";
import { eq, isNotNull } from "drizzle-orm";
import { ghl, locationId } from "@/lib/ghl/client";
import { orchestrateCallPrep } from "@/lib/call-prep";
import type { GHLCalendarEvent } from "@/lib/ghl/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface GHLCalendarResponse {
  events?: GHLCalendarEvent[];
}

/**
 * GET /api/cron/call-prep
 * Pre-generates call prep for all calls within the next 48 hours.
 * Runs hourly via Vercel Cron.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const startMs = now.getTime();
  const endMs = now.getTime() + 48 * 60 * 60 * 1000; // 48 hours ahead

  // Get all active reps with GHL user IDs
  const reps = await db()
    .select({ ghlUserId: users.ghlUserId, email: users.email, name: users.name })
    .from(users)
    .where(isNotNull(users.ghlUserId));

  // Fetch upcoming events for all reps
  const allEvents: Array<GHLCalendarEvent & { repEmail?: string }> = [];

  for (const rep of reps) {
    if (!rep.ghlUserId) continue;
    try {
      const data = await ghl.get<GHLCalendarResponse>(
        `/calendars/events?locationId=${locationId()}&userId=${rep.ghlUserId}&startTime=${startMs}&endTime=${endMs}`
      );
      for (const event of data.events ?? []) {
        allEvents.push({ ...event, repEmail: rep.email });
      }
    } catch (err) {
      console.error(`[cron/call-prep] Failed to fetch events for ${rep.email}:`, err);
    }
  }

  // Deduplicate by event ID
  const unique = new Map<string, (typeof allEvents)[number]>();
  for (const e of allEvents) {
    if (!unique.has(e.id)) unique.set(e.id, e);
  }

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const event of unique.values()) {
    if (!event.contactId) {
      skipped++;
      continue;
    }

    // Check if already generated and not expired
    const [existing] = await db()
      .select({ status: callPreps.status, expiresAt: callPreps.expiresAt })
      .from(callPreps)
      .where(eq(callPreps.calendarEventId, event.id))
      .limit(1);

    if (existing?.status === "ready" && existing.expiresAt && existing.expiresAt > now) {
      skipped++;
      continue;
    }

    try {
      await orchestrateCallPrep({
        calendarEventId: event.id,
        contactId: event.contactId,
        contactName: event.contactName,
      });
      generated++;
    } catch (err) {
      console.error(`[cron/call-prep] Failed for event ${event.id}:`, err);
      failed++;
    }
  }

  console.log(`[cron/call-prep] Done: ${generated} generated, ${skipped} skipped, ${failed} failed`);
  return NextResponse.json({ generated, skipped, failed });
}
