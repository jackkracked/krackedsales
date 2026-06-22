import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { demoBoards, demoBoardComments, users } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { desc, sql, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/boards  (team only)
 * The Boards command center: every board with its rep/designer, stage, key
 * timestamps, comment count, and engagement flags — enough to sort, filter, and
 * spot who's booked at a glance.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const boards = await db().select().from(demoBoards).orderBy(desc(demoBoards.lastActivityAt), desc(demoBoards.createdAt));

    // Comment counts per board (shared = client-facing conversation volume).
    const counts = await db()
      .select({
        boardId: demoBoardComments.boardId,
        total: sql<number>`count(*)::int`,
      })
      .from(demoBoardComments)
      .groupBy(demoBoardComments.boardId);
    const countMap = new Map(counts.map((c) => [c.boardId, c.total]));

    // Resolve rep + designer names in one pass.
    const ids = Array.from(
      new Set(boards.flatMap((b) => [b.repId, b.designerId]).filter(Boolean) as string[]),
    );
    const people = ids.length
      ? await db().select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))
      : [];
    const nameMap = new Map(people.map((p) => [p.id, p.name]));

    const rows = boards.map((b) => ({
      id: b.id,
      contactName: b.contactName,
      referenceCode: b.referenceCode,
      title: b.title,
      status: b.status,
      repName: b.repId ? nameMap.get(b.repId) ?? null : null,
      designerName: b.designerId ? nameMap.get(b.designerId) ?? null : null,
      sentChannel: b.sentChannel,
      sentAt: b.sentAt,
      firstOpenedAt: b.firstOpenedAt,
      bookedAt: b.bookedAt,
      lastActivityAt: b.lastActivityAt,
      createdAt: b.createdAt,
      comments: countMap.get(b.id) ?? 0,
    }));

    return NextResponse.json({ boards: rows });
  } catch (err) {
    console.error("[GET /api/boards]", err);
    return NextResponse.json({ error: "Failed to load boards" }, { status: 500 });
  }
}
