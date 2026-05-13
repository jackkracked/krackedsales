import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { messageIndex } from "@/lib/db/schema";
import { ilike, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ results: [] });

  // One result per conversation — the most recent message matching the query
  const raw = await db()
    .selectDistinctOn([messageIndex.conversationId], {
      conversationId: messageIndex.conversationId,
      contactId: messageIndex.contactId,
      contactName: messageIndex.contactName,
      body: messageIndex.body,
      channel: messageIndex.channel,
      direction: messageIndex.direction,
      dateAdded: messageIndex.dateAdded,
    })
    .from(messageIndex)
    .where(ilike(messageIndex.body, `%${q}%`))
    .orderBy(messageIndex.conversationId, desc(messageIndex.dateAdded))
    .limit(50);

  // Re-sort by recency after DISTINCT ON collapses duplicates
  const results = raw.sort(
    (a, b) => new Date(b.dateAdded ?? 0).getTime() - new Date(a.dateAdded ?? 0).getTime()
  );

  return NextResponse.json({ results });
}
