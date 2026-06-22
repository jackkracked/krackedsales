import { NextRequest, NextResponse } from "next/server";
import { getBoardByToken, logBoardEvent, recordBoardOpen } from "@/lib/demo-boards/queries";

export const dynamic = "force-dynamic";

/** Events the public board is allowed to log. Anything else is ignored (no trust in the client). */
const ALLOWED = new Set([
  "opened",
  "viewed",
  "time_on_design",
  "scrolled_bottom",
  "forwarded",
  "booking_opened",
]);

/**
 * Tracking beacon for the prospect view. The client fires these (keepalive) as the
 * prospect engages: opened (once on mount), viewed (design actually in view),
 * time_on_design (heartbeat), scrolled_bottom, forwarded. Open is special-cased so
 * it advances the funnel + stamps firstOpenedAt exactly once.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const body = await req.json().catch(() => ({}));
    const type = String(body?.type ?? "");
    if (!ALLOWED.has(type)) {
      return NextResponse.json({ ok: false, error: "unknown_event" }, { status: 400 });
    }

    const board = await getBoardByToken(token);
    if (!board) return NextResponse.json({ ok: false }, { status: 404 });

    if (type === "opened") {
      await recordBoardOpen(board, "prospect");
    } else {
      await logBoardEvent({
        boardId: board.id,
        type,
        actor: "prospect",
        metadata: body?.metadata && typeof body.metadata === "object" ? body.metadata : null,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/boards/public/[token]/track]", err);
    // Tracking must never surface an error to the prospect's page.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
