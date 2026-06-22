import { NextRequest, NextResponse } from "next/server";
import { ghl } from "@/lib/ghl/client";
import { db } from "@/lib/db";
import { demoBoards, demoBoardDesigns } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { logBoardEvent } from "@/lib/demo-boards/queries";
import { moveTaskToStage } from "@/lib/demo-boards/clickup-adapter";
import { notifySlack } from "@/lib/demo-boards/slack-adapter";
import { clickupConfig } from "@/lib/demo-boards/integration-config";
import { boardUrl } from "@/lib/demo-boards/urls";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

// Friendly channel → GHL send type. Mirrors the inbox send route's mapping.
const CHANNEL_TO_GHL: Record<string, string> = {
  sms: "SMS",
  email: "Email",
  ig: "IG",
  fb: "FB",
  whatsapp: "WhatsApp",
};

/**
 * POST /api/boards/[id]/send  (team only)
 * "Send to client": delivers the board link to the prospect over a chosen channel
 * (reusing the GHL conversations send API), then advances the board to `sent` and
 * the ClickUp task to Scheduled/Live. The board is only marked sent if the message
 * actually goes out — a GHL failure surfaces and leaves the status untouched.
 * Body: { channel, message, subject? }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const channel = String(body?.channel ?? "").toLowerCase();
    const message = String(body?.message ?? "").trim();
    const subject = body?.subject ? String(body.subject).trim() : undefined;

    const ghlType = CHANNEL_TO_GHL[channel];
    if (!ghlType) {
      return NextResponse.json({ error: "Pick a valid channel." }, { status: 400 });
    }
    if (!message) {
      return NextResponse.json({ error: "Write a message to send." }, { status: 400 });
    }

    const [board] = await db().select().from(demoBoards).where(eq(demoBoards.id, id)).limit(1);
    if (!board) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (!board.ghlContactId) {
      return NextResponse.json(
        { error: "This board has no linked contact to send to." },
        { status: 409 },
      );
    }

    // Gate: don't send an empty board.
    const [design] = await db()
      .select({ id: demoBoardDesigns.id })
      .from(demoBoardDesigns)
      .where(eq(demoBoardDesigns.boardId, id))
      .limit(1);
    if (!design) {
      return NextResponse.json({ error: "Upload a design before sending." }, { status: 409 });
    }

    // Deliver over GHL. Email carries an HTML link; SMS/social carry the plain link.
    const url = boardUrl(board.token);
    const payload: Record<string, string> = {
      type: ghlType,
      contactId: board.ghlContactId,
      message: message.includes(url) ? message : `${message}\n\n${url}`,
    };
    if (ghlType === "Email") {
      payload.subject = subject || `Your custom email design from Kracked`;
      payload.html = `<p>${message.replace(/\n/g, "<br/>")}</p><p><a href="${url}">View your board</a></p>`;
    }

    try {
      await ghl.post(`/conversations/messages`, payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[POST /api/boards/[id]/send] GHL send failed", id, msg);
      return NextResponse.json({ error: `Couldn’t send the message: ${msg}` }, { status: 502 });
    }

    // Message is out — advance the board.
    await db()
      .update(demoBoards)
      .set({ status: "sent", sentChannel: channel, sentAt: new Date(), updatedAt: new Date() })
      .where(eq(demoBoards.id, id));

    await logBoardEvent({ boardId: id, type: "sent", actor: user.name, metadata: { channel } });

    await moveTaskToStage(board.clickupTaskId, clickupConfig.stages.sentToClient);
    await notifySlack.sentToClient(board.contactName, channel);

    return NextResponse.json({ ok: true, status: "sent", channel });
  } catch (err) {
    console.error("[POST /api/boards/[id]/send]", id, err);
    return NextResponse.json({ error: "Failed to send the board." }, { status: 500 });
  }
}
