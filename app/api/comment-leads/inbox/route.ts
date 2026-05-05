import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { commentLeads } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const client = await db();
    const leads = await client
      .select()
      .from(commentLeads)
      .orderBy(desc(commentLeads.createdAt))
      .limit(100);

    return NextResponse.json({ leads });
  } catch (err) {
    console.error("[/api/comment-leads/inbox] Failed:", err);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}
