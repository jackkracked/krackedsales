import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { demoBoards, demoBoardDesigns, demoBoardComments, demoBoardEvents, users } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { boardUrl } from "@/lib/demo-boards/urls";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/boards/[id]  (team only)
 * Full internal view of a board: every design version, every comment (internal +
 * shared), and the event timeline. Powers the admin cockpit.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const [board] = await db().select().from(demoBoards).where(eq(demoBoards.id, id)).limit(1);
    if (!board) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const [designs, comments, events, rep, designer] = await Promise.all([
      db().select().from(demoBoardDesigns).where(eq(demoBoardDesigns.boardId, id)).orderBy(desc(demoBoardDesigns.version)),
      db().select().from(demoBoardComments).where(eq(demoBoardComments.boardId, id)).orderBy(demoBoardComments.createdAt),
      db().select().from(demoBoardEvents).where(eq(demoBoardEvents.boardId, id)).orderBy(desc(demoBoardEvents.createdAt)).limit(100),
      board.repId
        ? db().select({ id: users.id, name: users.name }).from(users).where(eq(users.id, board.repId)).limit(1)
        : Promise.resolve([]),
      board.designerId
        ? db().select({ id: users.id, name: users.name }).from(users).where(eq(users.id, board.designerId)).limit(1)
        : Promise.resolve([]),
    ]);

    return NextResponse.json({
      board: {
        ...board,
        repName: rep[0]?.name ?? null,
        designerName: designer[0]?.name ?? null,
        publicUrl: boardUrl(board.token),
      },
      designs,
      comments,
      events,
    });
  } catch (err) {
    console.error("[GET /api/boards/[id]]", id, err);
    return NextResponse.json({ error: "Failed to load board" }, { status: 500 });
  }
}
