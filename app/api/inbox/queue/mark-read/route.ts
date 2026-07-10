/**
 * POST /api/inbox/queue/mark-read
 *
 * Marks one or more conversations "read / handled" so they drop off the dashboard
 * awaiting-reply strip. Persisted in conversation_reads (per channel + conversation) and
 * best-effort mirrored to GHL. A newer inbound message re-surfaces the conversation (the
 * queue compares read_at against the last message time).
 *
 * Body: { items: [{ channel, id }], read?: boolean }   (read defaults to true; false = undo)
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { conversationReads } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { ghl, locationId } from "@/lib/ghl/client";

export const dynamic = "force-dynamic";

type Channel = "GHL" | "Meta" | "TikTok";
interface MarkItem {
  channel: Channel;
  id: string;
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { items?: MarkItem[]; read?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const items = (Array.isArray(body.items) ? body.items : []).filter(
    (it): it is MarkItem =>
      !!it && typeof it.id === "string" && ["GHL", "Meta", "TikTok"].includes(it.channel),
  );
  const read = body.read !== false; // default: mark read. false = undo.
  if (!items.length) return NextResponse.json({ error: "No conversations given" }, { status: 400 });

  try {
    if (read) {
      // Upsert one marker per conversation (bump read_at on repeat).
      for (const it of items) {
        await db()
          .insert(conversationReads)
          .values({ channel: it.channel, conversationId: it.id, readBy: user.id })
          .onConflictDoUpdate({
            target: [conversationReads.channel, conversationReads.conversationId],
            set: { readAt: new Date(), readBy: user.id },
          });
      }
    } else {
      // Undo: clear the markers so the conversations come back.
      for (const it of items) {
        await db()
          .delete(conversationReads)
          .where(and(eq(conversationReads.channel, it.channel), eq(conversationReads.conversationId, it.id)));
      }
    }
  } catch (err) {
    console.error("[inbox/queue/mark-read] db write failed:", err);
    return NextResponse.json({ error: "Couldn't save read state" }, { status: 500 });
  }

  // Best-effort: mirror read state to GHL so its own inbox agrees. Never blocks or fails
  // the response — if GHL rejects the field or errors, we keep the app-side state.
  if (read) {
    for (const it of items) {
      if (it.channel !== "GHL") continue;
      try {
        await ghl.put(`/conversations/${it.id}`, { locationId: locationId(), unreadCount: 0 });
      } catch (err) {
        console.error(`[inbox/queue/mark-read] GHL push failed for ${it.id}:`, err);
      }
    }
  }

  return NextResponse.json({ ok: true, count: items.length });
}
