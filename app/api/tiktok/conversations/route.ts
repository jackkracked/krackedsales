import { NextResponse } from "next/server";
import { openGet, getTiktokSettings } from "@/lib/tiktok/client";

export const dynamic = "force-dynamic";

// ─── TikTok Open Platform response types ─────────────────────────────────────

interface TikTokParticipant {
  open_id: string;
  display_name: string;
  avatar_url: string;
}

interface TikTokLatestMessage {
  text?: string;
}

interface TikTokConversation {
  conversation_id: string;
  participants: TikTokParticipant[];
  latest_message?: TikTokLatestMessage;
  unread_count: number;
  create_time: number;
  update_time: number;
}

interface TikTokConversationListResponse {
  data?: {
    conversations?: TikTokConversation[];
  };
}

// ─── GET — list conversations ─────────────────────────────────────────────────

export async function GET() {
  let myOpenId: string;

  try {
    const settings = await getTiktokSettings();
    myOpenId = settings.openId ?? "";
  } catch (err) {
    console.error("[TikTok /conversations] Settings not configured:", err);
    return NextResponse.json({ conversations: [], notConfigured: true });
  }

  try {
    const res = (await openGet("/dm/conversation/list/", {
      fields:
        "conversation_id,participants,latest_message,unread_count,create_time,update_time",
    })) as TikTokConversationListResponse;

    const rawConversations = res.data?.conversations ?? [];

    const conversations = rawConversations.map((conv) => {
      // The other participant is the one who is not us
      const other = conv.participants.find((p) => p.open_id !== myOpenId);

      return {
        id: conv.conversation_id,
        participantName: other?.display_name ?? "Unknown",
        participantAvatar: other?.avatar_url ?? "",
        lastMessage: conv.latest_message?.text ?? "",
        updatedAt: new Date(conv.update_time * 1000).toISOString(),
        unreadCount: conv.unread_count,
      };
    });

    return NextResponse.json({ conversations });
  } catch (err) {
    console.error("[TikTok /conversations] GET failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch conversations" },
      { status: 500 }
    );
  }
}
