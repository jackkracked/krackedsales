/**
 * GET /api/ghl/sync/status
 *
 * Returns record counts for all local GHL tables and the 10 most recent
 * sync log entries.
 *
 * Returns:
 *   {
 *     counts: { pipelines: N, contacts: N, opportunities: N, conversations: N, messages: N },
 *     recentLogs: GhlSyncLog[]
 *   }
 */
import { NextResponse } from "next/server";
import { count, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  localPipelines,
  localContacts,
  localOpportunities,
  localConversations,
  localMessages,
  ghlSyncLog,
} from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const client = db();

    const [
      [pipelinesRow],
      [contactsRow],
      [opportunitiesRow],
      [conversationsRow],
      [messagesRow],
      recentLogs,
    ] = await Promise.all([
      client.select({ value: count() }).from(localPipelines),
      client.select({ value: count() }).from(localContacts),
      client.select({ value: count() }).from(localOpportunities),
      client.select({ value: count() }).from(localConversations),
      client.select({ value: count() }).from(localMessages),
      client
        .select()
        .from(ghlSyncLog)
        .orderBy(desc(ghlSyncLog.completedAt))
        .limit(10),
    ]);

    return NextResponse.json({
      counts: {
        pipelines: pipelinesRow?.value ?? 0,
        contacts: contactsRow?.value ?? 0,
        opportunities: opportunitiesRow?.value ?? 0,
        conversations: conversationsRow?.value ?? 0,
        messages: messagesRow?.value ?? 0,
      },
      recentLogs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/ghl/sync/status]", message);
    return NextResponse.json({ error: "Failed to fetch sync status" }, { status: 500 });
  }
}
