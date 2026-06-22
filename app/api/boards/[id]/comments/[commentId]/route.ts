import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { demoBoardComments } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { logBoardEvent } from "@/lib/demo-boards/queries";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/boards/[id]/comments/[commentId]  (team only)
 * Two shapes:
 *  - Resolve/reopen a thread:        { resolved: boolean }
 *  - Reposition a pin on the design: { x: number, y: number }  (fractions, clamped 0..1)
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, commentId } = await params;
  try {
    const body = await req.json().catch(() => ({}));

    // Pin reposition: present iff both x and y are finite numbers.
    const x = clampFraction(body?.x);
    const y = clampFraction(body?.y);
    if (x != null && y != null) {
      const [moved] = await db()
        .update(demoBoardComments)
        .set({ x, y })
        .where(and(eq(demoBoardComments.id, commentId), eq(demoBoardComments.boardId, id)))
        .returning();

      if (!moved) return NextResponse.json({ error: "not_found" }, { status: 404 });
      return NextResponse.json({ ok: true, x: moved.x, y: moved.y });
    }

    const resolved = Boolean(body?.resolved);

    const [updated] = await db()
      .update(demoBoardComments)
      .set({ resolvedAt: resolved ? new Date() : null })
      .where(and(eq(demoBoardComments.id, commentId), eq(demoBoardComments.boardId, id)))
      .returning();

    if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });

    await logBoardEvent({
      boardId: id,
      type: resolved ? "comment_resolved" : "comment_reopened",
      actor: user.name,
    });

    return NextResponse.json({ ok: true, resolvedAt: updated.resolvedAt });
  } catch (err) {
    console.error("[PATCH /api/boards/[id]/comments/[commentId]]", err);
    return NextResponse.json({ error: "Couldn’t update the comment." }, { status: 500 });
  }
}

/** Coerce an unknown value to a 0..1 fraction, or null if it isn't a finite number. */
function clampFraction(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}

/**
 * DELETE /api/boards/[id]/comments/[commentId]  (team only)
 * Remove a comment (and any of its replies). Used to clean up internal notes.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, commentId } = await params;
  try {
    // Remove replies first, then the thread root.
    await db()
      .delete(demoBoardComments)
      .where(and(eq(demoBoardComments.parentId, commentId), eq(demoBoardComments.boardId, id)));
    const [deleted] = await db()
      .delete(demoBoardComments)
      .where(and(eq(demoBoardComments.id, commentId), eq(demoBoardComments.boardId, id)))
      .returning();

    if (!deleted) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/boards/[id]/comments/[commentId]]", err);
    return NextResponse.json({ error: "Couldn’t delete the comment." }, { status: 500 });
  }
}
