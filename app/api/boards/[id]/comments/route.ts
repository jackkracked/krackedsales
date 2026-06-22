import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { demoBoards, demoBoardDesigns, demoBoardComments } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { logBoardEvent } from "@/lib/demo-boards/queries";
import { eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * POST /api/boards/[id]/comments  (team only)
 * A team member leaves a comment. `visibility` decides whether the prospect can see
 * it: "internal" (team-only) or "shared" (client-visible). Top-level comments carry
 * a pin (x,y); replies pass parentId.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const [board] = await db().select().from(demoBoards).where(eq(demoBoards.id, id)).limit(1);
    if (!board) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const text = String(body?.body ?? "").trim();
    if (!text) return NextResponse.json({ error: "Comment can’t be empty." }, { status: 400 });

    const visibility = body?.visibility === "shared" ? "shared" : "internal";
    const parentId = body?.parentId ? String(body.parentId) : null;
    const x = parentId ? null : clampFraction(body?.x);
    const y = parentId ? null : clampFraction(body?.y);

    const [latest] = await db()
      .select({ id: demoBoardDesigns.id })
      .from(demoBoardDesigns)
      .where(eq(demoBoardDesigns.boardId, id))
      .orderBy(desc(demoBoardDesigns.version))
      .limit(1);

    const [comment] = await db()
      .insert(demoBoardComments)
      .values({
        boardId: id,
        designId: latest?.id ?? null,
        parentId,
        x,
        y,
        body: text,
        authorType: "team",
        authorId: user.id,
        authorName: user.name,
        visibility,
      })
      .returning();

    await logBoardEvent({
      boardId: id,
      type: "team_comment",
      actor: user.name,
      metadata: { visibility },
    });

    return NextResponse.json({ ok: true, comment });
  } catch (err) {
    console.error("[POST /api/boards/[id]/comments]", id, err);
    return NextResponse.json({ error: "Couldn’t post the comment." }, { status: 500 });
  }
}

function clampFraction(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}
