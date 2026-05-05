import { NextRequest, NextResponse } from "next/server";
import { meta } from "@/lib/meta/client";

export const dynamic = "force-dynamic";

interface ReplyBody {
  commentId?: string;
  recipientId: string;
  text: string;
  platform: "facebook" | "instagram";
}

export async function POST(req: NextRequest) {
  let body: ReplyBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { commentId, recipientId, text, platform } = body;

  if (!recipientId || !text) {
    return NextResponse.json({ error: "recipientId and text are required" }, { status: 400 });
  }

  try {
    // For Facebook with a commentId, use private_replies — creates a Messenger conversation
    // linked to the comment. Falls back to direct message if no commentId.
    if (platform === "facebook" && commentId) {
      const res = await meta.post<{ id: string }>(`/${commentId}/private_replies`, {
        message: text,
      });
      return NextResponse.json({ messageId: res.id });
    }

    // Fallback: direct Messenger/IG message to the recipient
    const res = await meta.post<{ message_id: string }>("/me/messages", {
      recipient: { id: recipientId },
      message: { text },
    });
    return NextResponse.json({ messageId: res.message_id });
  } catch (err) {
    console.error("[Meta /comment-reply] POST failed:", err);
    return NextResponse.json({ error: "Failed to send reply" }, { status: 500 });
  }
}
