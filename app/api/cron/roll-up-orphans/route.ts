import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import { db } from "@/lib/db";
import { localConversations, localContacts } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { logActivity } from "@/lib/activity/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Gage roll-up — the 24h backstop for the shared-pool model.
 *
 * Any conversation that has sat UNCLAIMED for >24h (no rep assigned, no rep ever
 * personally responded, still awaiting a reply) is reassigned to Gage (the main
 * account) in GHL so it lands on his overview and never silently rots.
 *
 * Conservative by design: only touches truly orphaned, stale, awaiting threads;
 * capped per run; skips anything already assigned (so it can't fight a rep's
 * claim or loop on its own webhook echo). Pass ?dryRun=1 to preview counts only.
 *
 * Protected by CRON_SECRET (this path is public in proxy.ts so the cron runner
 * can reach it). Supports GET (Vercel cron / manual preview) and POST.
 */
const STALE_MS = 24 * 60 * 60 * 1000;
const MAX_PER_RUN = 25;

interface GHLConv {
  id: string;
  contactId?: string;
  contactName?: string;
  lastMessageDirection?: "inbound" | "outbound";
  unreadCount?: number;
  dateUpdated?: string;
  dateLastMessage?: string;
  lastMessageDate?: string;
  assignedTo?: string;
}

async function rollUp(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const gage = process.env.GHL_GAGE_USER_ID;
  if (!gage) {
    return NextResponse.json({ error: "GHL_GAGE_USER_ID not set" }, { status: 500 });
  }
  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";

  let scanned = 0;
  let orphanCount = 0;
  let assigned = 0;
  const failures: string[] = [];

  try {
    const loc = locationId();
    const data = await ghl.get<{ conversations?: GHLConv[] }>(
      `/conversations/search?locationId=${loc}&limit=100&sortBy=last_message_date&sortOrder=desc`
    );
    const convs = data.conversations ?? [];
    scanned = convs.length;

    // Who has personally responded to each thread (our local source of truth)
    const ids = convs.map((c) => c.id);
    const respondedIds = new Set<string>();
    if (ids.length > 0) {
      const rows = await db()
        .select({
          id: localConversations.id,
          lastResponderUserId: localConversations.lastResponderUserId,
        })
        .from(localConversations)
        .where(inArray(localConversations.id, ids));
      for (const r of rows) if (r.lastResponderUserId) respondedIds.add(r.id);
    }

    const now = Date.now();
    const orphans = convs.filter((c) => {
      const awaiting = c.lastMessageDirection === "inbound" || (c.unreadCount ?? 0) > 0;
      const unassigned = !c.assignedTo;
      const noResponder = !respondedIds.has(c.id);
      const lastStr = c.dateLastMessage ?? c.lastMessageDate ?? c.dateUpdated;
      const stale = lastStr ? now - new Date(lastStr).getTime() > STALE_MS : false;
      return awaiting && unassigned && noResponder && stale && !!c.contactId;
    });
    orphanCount = orphans.length;

    const batch = orphans.slice(0, MAX_PER_RUN);
    for (const c of batch) {
      if (dryRun || !c.contactId) continue;
      try {
        // GHL owns assignment at the contact level; conversations inherit it.
        await ghl.put(`/contacts/${c.contactId}`, { assignedTo: gage });
        await db()
          .update(localConversations)
          .set({ assignedTo: gage, updatedAt: new Date() })
          .where(eq(localConversations.id, c.id));
        await db()
          .update(localContacts)
          .set({ assignedUserId: gage, updatedAt: new Date() })
          .where(eq(localContacts.id, c.contactId));
        logActivity({
          userId: "system",
          userName: "Roll-up (cron)",
          userEmail: "system@krackedretention.com",
          action: "contact.assigned",
          entityType: "contact",
          entityId: c.contactId,
          entityName: c.contactName,
          metadata: { assignedTo: gage, reason: "unclaimed_24h_roll_up", conversationId: c.id },
        });
        assigned++;
      } catch (err) {
        failures.push(`${c.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    console.error("[cron/roll-up-orphans]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "roll-up failed", scanned },
      { status: 500 }
    );
  }

  return NextResponse.json({
    scanned,
    orphans: orphanCount,
    assigned,
    capped: orphanCount > MAX_PER_RUN,
    dryRun,
    failures,
  });
}

export const GET = rollUp;
export const POST = rollUp;
