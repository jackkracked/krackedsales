import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { todayItems } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/**
 * Record a rep's decision about one Today item: done, snoozed, or undone.
 *
 * This is the ONLY thing about the list that persists. The list itself is rebuilt from live data
 * on every load, so a decision has to be keyed on the item's stable `sourceKey` rather than on a
 * stored row, or it would be forgotten the moment the list recomputes.
 *
 * Upsert, not insert: marking the same thing done twice is one fact, not two rows.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sourceKey: string }> },
) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sourceKey: rawKey } = await params;
  const sourceKey = decodeURIComponent(rawKey).slice(0, 200);
  if (!sourceKey) return NextResponse.json({ error: "Missing item" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { action?: string; days?: number };
  const action = body.action;

  try {
    if (action === "done") {
      await db()
        .insert(todayItems)
        .values({ userId: user.id, sourceKey, completedAt: new Date() })
        .onConflictDoUpdate({
          target: [todayItems.userId, todayItems.sourceKey],
          set: { completedAt: new Date(), snoozedUntil: null, updatedAt: new Date() },
        });
      return NextResponse.json({ ok: true, state: "done" });
    }

    if (action === "snooze") {
      // Default to tomorrow. Snoozing is permission to defer, not a failure state, so it is a
      // first-class action rather than something buried behind a menu.
      const days = Math.min(Math.max(Number(body.days ?? 1), 1), 30);
      const until = new Date();
      until.setDate(until.getDate() + days);
      await db()
        .insert(todayItems)
        .values({ userId: user.id, sourceKey, snoozedUntil: until })
        .onConflictDoUpdate({
          target: [todayItems.userId, todayItems.sourceKey],
          set: { snoozedUntil: until, completedAt: null, updatedAt: new Date() },
        });
      return NextResponse.json({ ok: true, state: "snoozed", until: until.toISOString() });
    }

    if (action === "undo") {
      // "__all__" un-snoozes everything the rep has deferred. It exists because the snoozed
      // count is the one standalone number on the screen, and a number you cannot act on is
      // exactly what this feature set out to remove — so clicking it has to undo them.
      if (sourceKey === "__all__") {
        await db()
          .delete(todayItems)
          .where(and(eq(todayItems.userId, user.id), isNotNull(todayItems.snoozedUntil), isNull(todayItems.completedAt)));
        return NextResponse.json({ ok: true, state: "unsnoozed-all" });
      }
      await db()
        .delete(todayItems)
        .where(and(eq(todayItems.userId, user.id), eq(todayItems.sourceKey, sourceKey)));
      return NextResponse.json({ ok: true, state: "cleared" });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("[POST /api/today/[sourceKey]]", err);
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
}
