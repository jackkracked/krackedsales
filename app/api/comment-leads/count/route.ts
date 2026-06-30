import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { socialLeads } from "@/lib/db/schema";
import { and, gte, lte, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since");
  const until = req.nextUrl.searchParams.get("until");

  try {
    const client = await db();

    const conditions = [];
    if (since) conditions.push(gte(socialLeads.createdAt, new Date(since)));
    // until is end-of-day
    if (until) conditions.push(lte(socialLeads.createdAt, new Date(`${until}T23:59:59Z`)));

    const rows = await client
      .select({ count: sql<number>`count(*)::int` })
      .from(socialLeads)
      .where(conditions.length ? and(...conditions) : undefined);

    const count = rows[0]?.count ?? 0;
    return NextResponse.json({ count });
  } catch (err) {
    console.error("[/api/comment-leads/count]", err);
    return NextResponse.json({ count: 0 }, { status: 500 });
  }
}
