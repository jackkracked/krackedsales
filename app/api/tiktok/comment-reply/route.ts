import { NextRequest, NextResponse } from "next/server";
import { businessPost, getTiktokSettings } from "@/lib/tiktok/client";

export const dynamic = "force-dynamic";

// ─── TikTok Business API response types ──────────────────────────────────────

interface ReplyBody {
  commentId: string;
  videoId: string;
  text: string;
}

// ─── POST — reply to a comment ────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: ReplyBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { commentId, videoId, text } = body;

  if (!commentId || !videoId || !text) {
    return NextResponse.json(
      { error: "commentId, videoId, and text are required" },
      { status: 400 }
    );
  }

  let advertiserId: string;
  try {
    const settings = await getTiktokSettings();
    advertiserId = settings.advertiserId ?? "";
  } catch (err) {
    console.error("[TikTok /comment-reply] Settings not configured:", err);
    return NextResponse.json(
      { error: "TikTok not configured" },
      { status: 503 }
    );
  }

  try {
    await businessPost("/comment/reply/", {
      advertiser_id: advertiserId,
      video_id: videoId,
      comment_id: commentId,
      content: text,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[TikTok /comment-reply] POST failed:", err);
    return NextResponse.json(
      { error: "Failed to send reply" },
      { status: 500 }
    );
  }
}
