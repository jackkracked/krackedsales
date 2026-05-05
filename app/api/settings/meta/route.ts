import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { metaPages } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db().select().from(metaPages);

  const pages = rows.map((row) => ({
    pageId: row.pageId,
    pageName: row.pageName,
    pageAvatar: row.pageAvatar,
    instagramHandle: row.instagramHandle,
    instagramAvatar: row.instagramAvatar,
    connectedAt: row.connectedAt.toISOString(),
    // Never expose the full token — show only a preview for UI confirmation
    tokenPreview: row.pageAccessToken.slice(0, 8) + "...",
  }));

  return NextResponse.json({ pages });
}
