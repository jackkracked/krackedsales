import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { demoBoards, demoBoardComments } from "@/lib/db/schema";
import {
  getBoardByToken,
  getLatestDesign,
  logBoardEvent,
} from "@/lib/demo-boards/queries";
import { notifySlack } from "@/lib/demo-boards/slack-adapter";
import { mirrorCommentToTask } from "@/lib/demo-boards/clickup-adapter";
import { boardUrl } from "@/lib/demo-boards/urls";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const VIEWABLE = ["sent", "opened", "engaged", "booked", "closed"];

/**
 * POST /api/boards/public/[token]/comments
 * The prospect leaves a comment (or reply) on their board. Always shared + authored
 * as the prospect — the tokenized link already identifies them, so no name prompt.
 * A new top-level comment can carry a pin (x,y fractions). Replies pass parentId.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const board = await getBoardByToken(token);
    if (!board) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (!VIEWABLE.includes(board.status)) {
      return NextResponse.json({ error: "Board isn’t open for comments." }, { status: 409 });
    }

    const body = await req.json().catch(() => ({}));
    const text = String(body?.body ?? "").trim();
    if (!text) return NextResponse.json({ error: "Comment can’t be empty." }, { status: 400 });
    if (text.length > 4000) {
      return NextResponse.json({ error: "Comment is too long." }, { status: 400 });
    }

    const x = clampFraction(body?.x);
    const y = clampFraction(body?.y);
    const parentId = body?.parentId ? String(body.parentId) : null;
    const design = await getLatestDesign(board.id);

    const [comment] = await db()
      .insert(demoBoardComments)
      .values({
        boardId: board.id,
        designId: design?.id ?? null,
        parentId,
        x: parentId ? null : x, // only top-level comments carry a pin
        y: parentId ? null : y,
        body: text,
        authorType: "prospect",
        authorName: board.contactName,
        visibility: "shared",
      })
      .returning();

    await logBoardEvent({ boardId: board.id, type: "commented", actor: "prospect" });

    // Advance an opened/sent board to "engaged" once the prospect interacts.
    if (board.status === "sent" || board.status === "opened") {
      await db().update(demoBoards).set({ status: "engaged", updatedAt: new Date() }).where(eq(demoBoards.id, board.id));
    }

    // External notifications (safe no-ops when unconfigured).
    const snippet = text.length > 90 ? `${text.slice(0, 90)}…` : text;
    await notifySlack.prospectCommented(board.contactName, snippet, boardUrl(board.token));
    await mirrorCommentToTask(board.clickupTaskId, `💬 ${board.contactName} on the demo board: "${text}"`);

    return NextResponse.json({
      ok: true,
      comment: {
        id: comment.id,
        parentId: comment.parentId,
        x: comment.x,
        y: comment.y,
        body: comment.body,
        authorType: comment.authorType,
        authorName: comment.authorName,
        resolvedAt: comment.resolvedAt,
        createdAt: comment.createdAt,
      },
    });
  } catch (err) {
    console.error("[POST /api/boards/public/[token]/comments]", err);
    return NextResponse.json({ error: "Couldn’t post your comment." }, { status: 500 });
  }
}

/**
 * PATCH /api/boards/public/[token]/comments
 * Reposition a pin the prospect placed. Body: { commentId, x, y } (fractions).
 * Only prospect-authored pins on this board may move — team pins are off-limits.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const board = await getBoardByToken(token);
    if (!board) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (!VIEWABLE.includes(board.status)) {
      return NextResponse.json({ error: "Board isn’t open for comments." }, { status: 409 });
    }

    const body = await req.json().catch(() => ({}));
    const commentId = body?.commentId ? String(body.commentId) : null;
    const x = clampFraction(body?.x);
    const y = clampFraction(body?.y);
    if (!commentId || x == null || y == null) {
      return NextResponse.json({ error: "Missing pin position." }, { status: 400 });
    }

    // Scope the update: this board + this comment + prospect-authored only.
    const [moved] = await db()
      .update(demoBoardComments)
      .set({ x, y })
      .where(
        and(
          eq(demoBoardComments.id, commentId),
          eq(demoBoardComments.boardId, board.id),
          eq(demoBoardComments.authorType, "prospect"),
        ),
      )
      .returning();

    if (!moved) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true, x: moved.x, y: moved.y });
  } catch (err) {
    console.error("[PATCH /api/boards/public/[token]/comments]", err);
    return NextResponse.json({ error: "Couldn’t move the pin." }, { status: 500 });
  }
}

function clampFraction(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}
