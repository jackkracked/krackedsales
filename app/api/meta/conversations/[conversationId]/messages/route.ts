import { NextRequest, NextResponse } from "next/server";
import { meta, pageId } from "@/lib/meta/client";

export const dynamic = "force-dynamic";

interface MetaMessage {
  id: string;
  message: string;
  from: { id: string; name?: string; email?: string };
  to?: { data: Array<{ id: string; name?: string }> };
  created_time: string;
}

interface MetaMessagesResponse {
  data: MetaMessage[];
}

interface SendMessageBody {
  recipientId: string;
  text: string;
  platform: "facebook" | "instagram";
}

// ─── GET — fetch messages in a conversation ──────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params;

  try {
    const res = await meta.get<MetaMessagesResponse>(
      `/${conversationId}/messages`,
      { fields: "message,from,created_time,to", limit: "50" }
    );

    let myPageId: string;
    try {
      myPageId = pageId();
    } catch {
      myPageId = "";
    }

    const messages = (res.data ?? []).map((msg) => ({
      id: msg.id,
      text: msg.message,
      from: {
        id: msg.from.id,
        name: msg.from.name ?? msg.from.email ?? "Unknown",
      },
      createdAt: msg.created_time,
      direction: msg.from.id === myPageId ? "outbound" : "inbound",
    }));

    // Meta returns newest-first — reverse so oldest is at top, newest at bottom
    return NextResponse.json({ messages: messages.reverse() });
  } catch (err) {
    console.error(
      `[Meta /conversations/${conversationId}/messages] GET failed:`,
      err
    );
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}

// ─── POST — send a message ────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params: _params }: { params: Promise<{ conversationId: string }> }
) {
  let body: SendMessageBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { recipientId, text } = body;

  if (!recipientId || !text) {
    return NextResponse.json(
      { error: "recipientId and text are required" },
      { status: 400 }
    );
  }

  try {
    const res = await meta.post<{ message_id: string }>("/me/messages", {
      recipient: { id: recipientId },
      message: { text },
    });

    return NextResponse.json({ messageId: res.message_id });
  } catch (err) {
    console.error("[Meta /messages] POST send failed:", err);
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 }
    );
  }
}
