import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { keywordTriggers, commentLeads } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { pusherTrigger } from "@/lib/pusher/server";

export const dynamic = "force-dynamic";

// ─── GET — Meta webhook verification ────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

// ─── POST — Meta webhook event handler ──────────────────────────────────────

export async function POST(req: NextRequest) {
  // Always return 200 immediately — Meta retries on non-200
  const body = await req.json().catch(() => ({}));

  // Process async — fire and forget so we respond instantly
  handleMetaEvent(body).catch((err) =>
    console.error("[Meta Webhook] Unhandled error:", err)
  );

  return NextResponse.json({ ok: true }, { status: 200 });
}

// ─── Event dispatcher ───────────────────────────────────────────────────────

async function handleMetaEvent(body: Record<string, unknown>) {
  const object = body.object as string | undefined;
  const entries = (body.entry as Record<string, unknown>[]) ?? [];

  for (const entry of entries) {
    // Handle DMs (Facebook and Instagram)
    const messaging = (entry.messaging as Record<string, unknown>[]) ?? [];
    for (const msg of messaging) {
      const platform = object === "instagram" ? "instagram" : "facebook";
      await handleDirectMessage(msg, platform);
    }

    // Handle feed / comment changes
    const changes = (entry.changes as Record<string, unknown>[]) ?? [];
    for (const change of changes) {
      const field = change.field as string;
      const value = change.value as Record<string, unknown>;

      if (field === "feed" && value?.item === "comment" && value?.verb === "add") {
        await handleFacebookComment(value);
      }

      if (field === "comments") {
        await handleInstagramComment(value);
      }
    }
  }
}

// ─── A/B: Direct messages ────────────────────────────────────────────────────

async function handleDirectMessage(
  msg: Record<string, unknown>,
  platform: "facebook" | "instagram"
) {
  const sender = msg.sender as Record<string, unknown>;
  const message = msg.message as Record<string, unknown>;

  if (!sender || !message) return;

  const senderId = sender.id as string;
  const text = (message.text as string) ?? "";
  const messageId = (message.mid as string) ?? "";
  const timestamp = (msg.timestamp as number) ?? Date.now();

  try {
    await pusherTrigger("meta-inbox", "message.received", {
      platform,
      senderId,
      senderName: platform === "instagram" ? "Instagram User" : "Facebook User",
      text,
      messageId,
      timestamp,
    });
  } catch (err) {
    // Pusher is optional — log but don't fail
    console.error("[Meta Webhook] Pusher trigger failed:", err);
  }
}

// ─── C: Facebook feed comments ───────────────────────────────────────────────

async function handleFacebookComment(value: Record<string, unknown>) {
  const from = value.from as Record<string, string>;
  const commentText = (value.message as string) ?? "";
  const commentId = value.comment_id as string;
  const postId = value.post_id as string;

  if (!from || !commentText) return;

  const commenterName = from.name ?? "Unknown";
  const commenterId = from.id ?? "";

  const matchedKeyword = await findMatchingKeyword(commentText);
  if (!matchedKeyword) return;

  console.log(
    `[Meta Webhook] Facebook comment matched keyword "${matchedKeyword}" — comment ${commentId} on post ${postId}`
  );

  await saveCommentLead({
    name: commenterName,
    platform: "facebook",
    commentText,
    keyword: matchedKeyword,
    commentId,
    postId,
    commenterId,
  });

  await pusherTrigger("meta-inbox", "comment.received", {
    platform: "facebook",
    name: commenterName,
    keyword: matchedKeyword,
  });
}

// ─── D: Instagram comments ───────────────────────────────────────────────────

async function handleInstagramComment(value: Record<string, unknown>) {
  const commentText = (value.text as string) ?? "";
  const from = value.from as Record<string, string>;
  const commentId = value.id as string;

  if (!commentText) return;

  const username = from?.username ?? "instagram_user";
  const commenterId = from?.id ?? "";

  const matchedKeyword = await findMatchingKeyword(commentText);
  if (!matchedKeyword) return;

  console.log(
    `[Meta Webhook] Instagram comment matched keyword "${matchedKeyword}" — comment ${commentId}`
  );

  await saveCommentLead({
    name: username,
    platform: "instagram",
    commentText,
    keyword: matchedKeyword,
    commentId,
    postId: undefined,
    commenterId,
  });

  await pusherTrigger("meta-inbox", "comment.received", {
    platform: "instagram",
    name: username,
    keyword: matchedKeyword,
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Loads active keywords from DB and returns the first match, or null */
async function findMatchingKeyword(text: string): Promise<string | null> {
  try {
    const client = await db();
    const activeKeywords = await client
      .select()
      .from(keywordTriggers)
      .where(eq(keywordTriggers.active, true));

    const lowerText = text.toLowerCase();

    for (const row of activeKeywords) {
      if (lowerText.includes(row.keyword.toLowerCase())) {
        return row.keyword;
      }
    }

    return null;
  } catch (err) {
    console.error("[Meta Webhook] Failed to load keyword triggers:", err);
    return null;
  }
}

/** Saves a comment lead to our database */
async function saveCommentLead({
  name,
  platform,
  commentText,
  keyword,
  commentId,
  postId,
  commenterId,
}: {
  name: string;
  platform: "facebook" | "instagram";
  commentText: string;
  keyword: string;
  commentId?: string;
  postId?: string;
  commenterId?: string;
}) {
  try {
    const client = await db();
    await client.insert(commentLeads).values({
      name,
      platform,
      commentText,
      keyword,
      commentId: commentId ?? null,
      postId: postId ?? null,
      commenterId: commenterId ?? null,
    });
    console.log(`[Meta Webhook] Saved ${platform} comment lead: "${name}" (keyword: "${keyword}")`);
  } catch (err) {
    console.error("[Meta Webhook] Failed to save comment lead:", err);
  }
}
