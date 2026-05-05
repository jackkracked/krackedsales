import { NextResponse } from "next/server";
import { businessGet, getTiktokSettings } from "@/lib/tiktok/client";

export const dynamic = "force-dynamic";

// ─── TikTok Business API response types ──────────────────────────────────────

interface TikTokVideo {
  video_id: string;
  video_name: string;
  create_time: number;
}

interface TikTokVideoListResponse {
  data?: {
    list?: TikTokVideo[];
  };
}

interface TikTokComment {
  comment_id: string;
  text: string;
  username: string;
  unique_id: string;
  create_time: number;
  reply_count: number;
}

interface TikTokCommentListResponse {
  data?: {
    comments?: TikTokComment[];
  };
}

// ─── GET — list comments across recent videos ─────────────────────────────────

export async function GET() {
  let advertiserId: string;

  try {
    const settings = await getTiktokSettings();

    if (!settings.businessAccessToken) {
      return NextResponse.json({ comments: [], notConfigured: true });
    }

    advertiserId = settings.advertiserId ?? "";
  } catch (err) {
    console.error("[TikTok /comments] Settings not configured:", err);
    return NextResponse.json({ comments: [], notConfigured: true });
  }

  try {
    // Step 1: fetch up to 20 recent videos
    const videoRes = (await businessGet("/video/list/", {
      advertiser_id: advertiserId,
      fields: '["video_id","video_name","create_time"]',
      page_size: "20",
    })) as TikTokVideoListResponse;

    const videos = (videoRes.data?.list ?? []).slice(0, 10);

    // Step 2: fetch comments for each video in parallel
    const commentsByVideo = await Promise.all(
      videos.map(async (video) => {
        try {
          const commentRes = (await businessGet("/comment/list/", {
            advertiser_id: advertiserId,
            video_id: video.video_id,
            fields:
              '["comment_id","text","username","unique_id","create_time","reply_count"]',
            count: "20",
          })) as TikTokCommentListResponse;

          return (commentRes.data?.comments ?? []).map((comment) => ({
            id: comment.comment_id,
            videoId: video.video_id,
            videoTitle: video.video_name,
            text: comment.text,
            authorName: comment.username || comment.unique_id,
            authorId: comment.unique_id,
            createdAt: new Date(comment.create_time * 1000).toISOString(),
            replyCount: comment.reply_count,
          }));
        } catch (err) {
          console.error(
            `[TikTok /comments] Failed to fetch comments for video ${video.video_id}:`,
            err
          );
          return [];
        }
      })
    );

    // Flatten all comments and sort newest first
    const comments = commentsByVideo
      .flat()
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

    return NextResponse.json(
      { comments },
      { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=30" } }
    );
  } catch (err) {
    console.error("[TikTok /comments] GET failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch comments" },
      { status: 500 }
    );
  }
}
