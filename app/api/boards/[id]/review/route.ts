import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { demoBoards, demoBoardDesigns, users } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { logBoardEvent } from "@/lib/demo-boards/queries";
import { moveTaskToStage } from "@/lib/demo-boards/clickup-adapter";
import { notifySlack } from "@/lib/demo-boards/slack-adapter";
import { clickupConfig } from "@/lib/demo-boards/integration-config";
import { boardUrl } from "@/lib/demo-boards/urls";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * POST /api/boards/[id]/review  (team only)
 * "Send for review": gated on a design existing. Moves the board to in_review,
 * drives the ClickUp task to Internal QA, and pings Slack. Idempotent-ish: safe to
 * call again (it just re-stamps in_review + re-notifies).
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const [board] = await db().select().from(demoBoards).where(eq(demoBoards.id, id)).limit(1);
    if (!board) return NextResponse.json({ error: "not_found" }, { status: 404 });

    // Gate: a design must exist before review.
    const [design] = await db()
      .select({ id: demoBoardDesigns.id })
      .from(demoBoardDesigns)
      .where(eq(demoBoardDesigns.boardId, id))
      .limit(1);
    if (!design) {
      return NextResponse.json(
        { error: "Upload a design before sending it for review." },
        { status: 409 },
      );
    }

    await db()
      .update(demoBoards)
      .set({ status: "in_review", updatedAt: new Date() })
      .where(eq(demoBoards.id, id));

    await logBoardEvent({ boardId: id, type: "sent_for_review", actor: user.name });

    // External effects (each a safe no-op when unconfigured).
    await moveTaskToStage(board.clickupTaskId, clickupConfig.stages.inReview);
    const repName = board.repId
      ? (await db().select({ name: users.name }).from(users).where(eq(users.id, board.repId)).limit(1))[0]?.name ?? "—"
      : "—";
    await notifySlack.readyForReview(board.contactName, repName, boardUrl(board.token));

    return NextResponse.json({ ok: true, status: "in_review" });
  } catch (err) {
    console.error("[POST /api/boards/[id]/review]", id, err);
    return NextResponse.json({ error: "Failed to send for review." }, { status: 500 });
  }
}
