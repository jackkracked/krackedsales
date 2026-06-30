import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { socialLeads } from "@/lib/db/schema";
import { desc, or, isNotNull, ne } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const client = await db();
    // Only real comment leads belong in this inbox. DM-origin rows (created when contact
    // data is attached from a DM thread) have no commentId and an empty keyword — exclude
    // them so a DM never surfaces here as a fake "comment".
    const leads = await client
      .select()
      .from(socialLeads)
      .where(or(isNotNull(socialLeads.commentId), ne(socialLeads.keyword, "")))
      .orderBy(desc(socialLeads.createdAt))
      .limit(100);

    return NextResponse.json({ leads });
  } catch (err) {
    console.error("[/api/comment-leads/inbox] Failed:", err);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}
