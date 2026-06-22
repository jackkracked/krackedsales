import { db } from "@/lib/db";
import {
  demoBoards,
  demoBoardDesigns,
  demoBoardComments,
  demoBoardEvents,
} from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";

export type BoardRow = typeof demoBoards.$inferSelect;
export type DesignRow = typeof demoBoardDesigns.$inferSelect;
export type CommentRow = typeof demoBoardComments.$inferSelect;

/** Look up a board by its public token. Returns null if not found. */
export async function getBoardByToken(token: string): Promise<BoardRow | null> {
  const [board] = await db()
    .select()
    .from(demoBoards)
    .where(eq(demoBoards.token, token))
    .limit(1);
  return board ?? null;
}

/** The current (highest-version) design for a board, or null while awaiting upload. */
export async function getLatestDesign(boardId: string): Promise<DesignRow | null> {
  const [design] = await db()
    .select()
    .from(demoBoardDesigns)
    .where(eq(demoBoardDesigns.boardId, boardId))
    .orderBy(desc(demoBoardDesigns.version))
    .limit(1);
  return design ?? null;
}

/**
 * Comments for a board, filtered by visibility.
 * The public board passes `"shared"` so a prospect NEVER sees internal team notes.
 * The admin view passes `undefined` to get everything.
 */
export async function getBoardComments(
  boardId: string,
  visibility?: "shared" | "internal",
): Promise<CommentRow[]> {
  const where = visibility
    ? and(eq(demoBoardComments.boardId, boardId), eq(demoBoardComments.visibility, visibility))
    : eq(demoBoardComments.boardId, boardId);
  return db()
    .select()
    .from(demoBoardComments)
    .where(where)
    .orderBy(demoBoardComments.createdAt);
}

/**
 * Append a board event AND bump the board's lastActivityAt in one call.
 * This is the single funnel every tracking signal flows through (opened, viewed,
 * scrolled_bottom, commented, booked, ...). Fire-and-forget safe: never throws
 * out — a tracking failure must never break the prospect's view of the board.
 */
export async function logBoardEvent(input: {
  boardId: string;
  type: string;
  actor?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await db().insert(demoBoardEvents).values({
      boardId: input.boardId,
      type: input.type,
      actor: input.actor ?? null,
      metadata: input.metadata ?? null,
    });
    await db()
      .update(demoBoards)
      .set({ lastActivityAt: new Date(), updatedAt: new Date() })
      .where(eq(demoBoards.id, input.boardId));
  } catch (err) {
    console.error("[logBoardEvent]", input.type, err);
  }
}

/**
 * Record the FIRST open of a board (sets firstOpenedAt + advances status from
 * sent → opened) and always logs an "opened"/"reopened" event. Idempotent on the
 * timestamp: only the first call stamps firstOpenedAt and flips the status.
 */
export async function recordBoardOpen(board: BoardRow, actor?: string | null): Promise<void> {
  const isFirstOpen = !board.firstOpenedAt;
  await logBoardEvent({
    boardId: board.id,
    type: isFirstOpen ? "opened" : "reopened",
    actor: actor ?? "prospect",
  });
  if (isFirstOpen) {
    await db()
      .update(demoBoards)
      .set({
        firstOpenedAt: new Date(),
        // Only advance the funnel forward — never knock a booked/engaged board back to "opened".
        status: board.status === "sent" ? "opened" : board.status,
        updatedAt: new Date(),
      })
      .where(eq(demoBoards.id, board.id));
  }
}
