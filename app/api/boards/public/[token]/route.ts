import { NextRequest, NextResponse } from "next/server";
import { getBoardByToken, getLatestDesign, getBoardComments } from "@/lib/demo-boards/queries";
import {
  PLACEHOLDER_TITLE,
  PLACEHOLDER_BODY,
} from "@/lib/demo-boards/integration-config";

export const dynamic = "force-dynamic";

/**
 * Public board payload for the prospect view. Read-only: tracking (opened/viewed/
 * scrolled) goes through the POST /track beacon so a react-query refetch never
 * double-logs an open. Before a board is sent, only admin preview (?preview=1) can
 * see it; a prospect hitting an unsent link gets a soft status, not a 404 leak.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const preview = req.nextUrl.searchParams.get("preview") === "1";

    const board = await getBoardByToken(token);
    if (!board) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const isSent = ["sent", "opened", "engaged", "booked", "closed"].includes(board.status);
    if (!isSent && !preview) {
      return NextResponse.json({ status: board.status, contactName: board.contactName });
    }

    const [design, comments] = await Promise.all([
      getLatestDesign(board.id),
      // The prospect only ever sees shared comments. Internal team notes stay invisible here.
      getBoardComments(board.id, "shared"),
    ]);

    return NextResponse.json({
      preview,
      board: {
        id: board.id,
        token: board.token,
        referenceCode: board.referenceCode,
        contactName: board.contactName,
        title: board.title,
        builtOn: board.builtOn,
        status: board.status,
        repId: board.repId,
        bookedAt: board.bookedAt,
        createdAt: board.createdAt,
      },
      design: design
        ? {
            id: design.id,
            url: design.blobUrl,
            mimeType: design.mimeType,
            width: design.width,
            height: design.height,
            version: design.version,
          }
        : null,
      placeholder: { title: PLACEHOLDER_TITLE, body: PLACEHOLDER_BODY },
      comments: comments.map((c) => ({
        id: c.id,
        parentId: c.parentId,
        x: c.x,
        y: c.y,
        body: c.body,
        authorType: c.authorType,
        authorName: c.authorName,
        resolvedAt: c.resolvedAt,
        createdAt: c.createdAt,
      })),
    });
  } catch (err) {
    console.error("[GET /api/boards/public/[token]]", err);
    return NextResponse.json({ error: "Failed to load board" }, { status: 500 });
  }
}
