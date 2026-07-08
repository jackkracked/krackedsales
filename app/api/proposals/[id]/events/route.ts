import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposalEvents } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** The engagement events for one proposal, newest first — powers the activity timeline. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const rows = await db()
    .select({
      type: proposalEvents.type,
      classification: proposalEvents.classification,
      createdAt: proposalEvents.createdAt,
    })
    .from(proposalEvents)
    .where(eq(proposalEvents.proposalId, id))
    .orderBy(desc(proposalEvents.createdAt))
    .limit(200);

  return NextResponse.json({ events: rows });
}
