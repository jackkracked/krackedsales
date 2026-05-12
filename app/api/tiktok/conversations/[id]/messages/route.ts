import { NextRequest, NextResponse } from "next/server";
import { openGet, openPost, getTiktokSettings } from "@/lib/tiktok/client";
import { db } from "@/lib/db";
import { platformReplies } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

// ─── TikTok Open Platform response types ─────────────────────────────────────

interface TikTokMessage {
  message_id: string;
  sender_open_id: string;
  create_time: number;
  content: {
    text?: string;
  };
}

interface TikTokMessageListResponse {
  data?: {
    messages?: TikTokMessage[];
  };
}

interface TikTokSendMessageResponse {
  data?: {
    message_id?: string;
  };
}

interface SendMessageBody {
  text: string;
}

// ─── GET — fetch messages in a conversation ───────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let myOpenId: string;

  try {
    const settings = await getTiktokSettings();
    myOpenId = settings.openId ?? "";
  } catch (err) {
    console.error(
      `[TikTok /conversations/${id}/messages] Settings not configured:`,
      err
    );
    return NextResponse.json(
      { error: "TikTok not configured" },
      { status: 503 }
    );
  }

  try {
    const res = (await openGet("/dm/conversation/message/list/", {
      conversation_id: id,
      fields: "message_id,sender_open_id,create_time,content",
    })) as TikTokMessageListResponse;

    const rawMessages = res.data?.messages ?? [];

    const messages = rawMessages.map((msg) => ({
      id: msg.message_id,
      text: msg.content?.text ?? "",
      direction:
        msg.sender_open_id !== myOpenId ? "inbound" : "outbound",
      createdAt: new Date(msg.create_time * 1000).toISOString(),
    }));

    return NextResponse.json({ messages });
  } catch (err) {
    console.error(
      `[TikTok /conversations/${id}/messages] GET failed:`,
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
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: SendMessageBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { text } = body;

  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  try {
    const res = (await openPost("/dm/message/send/", {
      conversation_id: id,
      message: {
        message_type: "text",
        content: { text },
      },
    })) as TikTokSendMessageResponse;

    const messageId = res.data?.message_id ?? "";

    // Track reply time for the reply queue
    const client = db();
    const existing = await client
      .select({ id: platformReplies.id })
      .from(platformReplies)
      .where(and(eq(platformReplies.platform, "tiktok"), eq(platformReplies.externalId, id)))
      .limit(1);
    if (existing.length > 0) {
      await client
        .update(platformReplies)
        .set({ repliedAt: new Date() })
        .where(eq(platformReplies.id, existing[0].id));
    } else {
      await client
        .insert(platformReplies)
        .values({ platform: "tiktok", externalId: id, repliedAt: new Date() });
    }

    return NextResponse.json({ messageId });
  } catch (err) {
    console.error(
      `[TikTok /conversations/${id}/messages] POST failed:`,
      err
    );
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 }
    );
  }
}
