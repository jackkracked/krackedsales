import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { commentLeads, keywordTriggers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { meta, pageId } from "@/lib/meta/client";

export const dynamic = "force-dynamic";
// Long-running — give it up to 5 minutes
export const maxDuration = 300;

interface FBPost {
  id: string;
  created_time: string;
}

interface FBComment {
  id: string;
  message: string;
  from?: { id: string; name: string };
  created_time: string;
}

interface FBPaginatedResponse<T> {
  data: T[];
  paging?: { next?: string; cursors?: { after?: string } };
}

/** Fetch all pages of a Meta endpoint, following paging.next */
async function paginateAll<T>(
  path: string,
  params: Record<string, string>
): Promise<T[]> {
  const results: T[] = [];
  const token = process.env.META_PAGE_ACCESS_TOKEN!;
  const base = "https://graph.facebook.com/v25.0";

  let url: string | null = (() => {
    const u = new URL(`${base}${path}`);
    u.searchParams.set("access_token", token);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  })();

  while (url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[backfill] Meta API error on ${url}: ${body}`);
      break;
    }
    const page = (await res.json()) as FBPaginatedResponse<T>;
    results.push(...(page.data ?? []));
    url = page.paging?.next ?? null;
  }

  return results;
}

export async function POST(req: NextRequest) {
  // Allow scoping to a custom since date; default = Jan 1 of this year
  const body = await req.json().catch(() => ({})) as { since?: string };
  const since = body.since ?? `${new Date().getFullYear()}-01-01`;
  const sinceUnix = Math.floor(new Date(since).getTime() / 1000);

  const client = await db();

  // Load active keywords
  const activeKeywords = await client
    .select()
    .from(keywordTriggers)
    .where(eq(keywordTriggers.active, true));

  if (!activeKeywords.length) {
    return NextResponse.json({ error: "No active keywords configured" }, { status: 400 });
  }

  // Load already-imported commentIds so we can skip duplicates
  const existing = await client.select({ commentId: commentLeads.commentId }).from(commentLeads);
  const existingIds = new Set(existing.map((r) => r.commentId).filter(Boolean) as string[]);

  const pid = pageId();

  // Fetch all posts since the start of the year
  console.log(`[backfill] Fetching posts for page ${pid} since ${since}`);
  const posts = await paginateAll<FBPost>(`/${pid}/posts`, {
    fields: "id,created_time",
    since: String(sinceUnix),
    limit: "100",
  });

  console.log(`[backfill] Found ${posts.length} posts — scanning comments...`);

  let totalChecked = 0;
  let totalMatched = 0;
  let totalInserted = 0;
  let totalSkipped = 0;

  // Debug: sample comments from first post and return in response
  let debugSample: unknown = null;
  if (posts.length > 0) {
    const sampleId = posts[0].id;
    const sampleUrl = `https://graph.facebook.com/v25.0/${sampleId}/comments?fields=id,message,from%7Bid,name%7D,created_time&limit=5&access_token=${process.env.META_PAGE_ACCESS_TOKEN}`;
    const sampleRes = await fetch(sampleUrl, { cache: "no-store" });
    const sampleText = await sampleRes.text();
    try { debugSample = JSON.parse(sampleText); } catch { debugSample = sampleText.slice(0, 300); }
    console.log(`[backfill] Sample comments for post ${sampleId}:`, sampleText.slice(0, 500));
  }

  for (const post of posts) {
    // Fetch all comments on this post (top-level only; filter=stream requires extra permissions)
    const comments = await paginateAll<FBComment>(`/${post.id}/comments`, {
      fields: "id,message,from{id,name},created_time",
      limit: "100",
    });

    totalChecked += comments.length;

    for (const comment of comments) {
      const lowerMessage = comment.message?.toLowerCase() ?? "";

      // Check if this comment matches any active keyword
      const matchedKeyword = activeKeywords.find((kw) =>
        lowerMessage.includes(kw.keyword.toLowerCase())
      );
      if (!matchedKeyword) continue;

      totalMatched++;

      // Skip if already imported
      if (existingIds.has(comment.id)) {
        totalSkipped++;
        continue;
      }

      const commenterName = comment.from?.name ?? "Unknown";
      const commenterId = comment.from?.id ?? null;
      const postId = post.id;

      try {
        await client.insert(commentLeads).values({
          name: commenterName,
          platform: "facebook",
          commentText: comment.message,
          keyword: matchedKeyword.keyword,
          commentId: comment.id,
          postId,
          commenterId,
          email: null,
          phone: null,
          website: null,
          notes: null,
          createdAt: new Date(comment.created_time),
        });
        existingIds.add(comment.id);
        totalInserted++;
      } catch (err) {
        console.error(`[backfill] Failed to insert comment ${comment.id}:`, err);
      }
    }

    // Small delay between posts to avoid hitting rate limits
    await new Promise((r) => setTimeout(r, 50));
  }

  const summary = {
    since,
    posts: posts.length,
    commentsChecked: totalChecked,
    keywordMatches: totalMatched,
    inserted: totalInserted,
    alreadyExisted: totalSkipped,
    debugSample,
  };

  console.log("[backfill] Done:", summary);
  return NextResponse.json(summary);
}
