import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { conversationFlags } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

type BulkAction = "read" | "unread" | "star" | "unstar" | "delete" | "restore";
const ACTIONS: BulkAction[] = ["read", "unread", "star", "unstar", "delete", "restore"];

/**
 * Bulk conversation actions for the inbox (GHL-style multi-select): mark read / unread,
 * add / remove star, delete / restore. Writes ONLY to conversation_flags (never the GHL
 * mirror), so a sync can't undo the user's intent. Idempotent per conversation via upsert.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { ids?: unknown; action?: unknown };
  const action = body.action as BulkAction;
  if (!ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  // De-dupe, keep strings, cap the batch so a runaway request can't hammer the DB.
  const ids = Array.from(
    new Set((Array.isArray(body.ids) ? body.ids : []).filter((v): v is string => typeof v === "string" && v.length > 0)),
  ).slice(0, 500);
  if (ids.length === 0) {
    return NextResponse.json({ error: "No conversations provided" }, { status: 400 });
  }

  // What each action sets on a NEW row, and which column to overwrite on conflict.
  const now = new Date();
  const base = { updatedAt: now, updatedBy: user.id ?? null };
  const perAction: Record<BulkAction, { values: Record<string, unknown>; set: Record<string, unknown> }> = {
    star:    { values: { starred: true },  set: { starred: sql`excluded.starred` } },
    unstar:  { values: { starred: false }, set: { starred: sql`excluded.starred` } },
    read:    { values: { readState: "read" },   set: { readState: sql`excluded.read_state` } },
    unread:  { values: { readState: "unread" }, set: { readState: sql`excluded.read_state` } },
    delete:  { values: { deletedAt: now },  set: { deletedAt: sql`excluded.deleted_at` } },
    restore: { values: { deletedAt: null }, set: { deletedAt: sql`excluded.deleted_at` } },
  };

  const { values, set } = perAction[action];

  try {
    await db()
      .insert(conversationFlags)
      .values(ids.map((conversationId) => ({ conversationId, ...values, ...base })))
      .onConflictDoUpdate({
        target: conversationFlags.conversationId,
        set: { ...set, updatedAt: now, updatedBy: user.id ?? null },
      });
    return NextResponse.json({ ok: true, action, count: ids.length });
  } catch (err) {
    console.error("[POST /api/inbox/conversations/bulk]", err);
    return NextResponse.json({ error: "Failed to update conversations" }, { status: 500 });
  }
}
