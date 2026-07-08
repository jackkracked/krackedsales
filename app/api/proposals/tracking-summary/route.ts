import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposalEvents } from "@/lib/db/schema";
import { count, max } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Per-proposal engagement rollup for the proposals list: how many reliable views + clicks
 * + genuine opens, and when they were last active. Keyed by proposalId. Staff-only.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db()
    .select({
      proposalId: proposalEvents.proposalId,
      type: proposalEvents.type,
      classification: proposalEvents.classification,
      n: count(),
      lastAt: max(proposalEvents.createdAt),
    })
    .from(proposalEvents)
    .groupBy(proposalEvents.proposalId, proposalEvents.type, proposalEvents.classification);

  const summary: Record<string, { views: number; clicks: number; genuineOpens: number; lastAt: string | null }> = {};
  for (const r of rows) {
    const m = (summary[r.proposalId] ??= { views: 0, clicks: 0, genuineOpens: 0, lastAt: null });
    if (r.type === "viewed") m.views += Number(r.n);
    else if (r.type === "clicked") m.clicks += Number(r.n);
    else if (r.type === "email_opened" && r.classification === "genuine") m.genuineOpens += Number(r.n);
    const at = r.lastAt ? new Date(r.lastAt as unknown as string).toISOString() : null;
    if (at && (!m.lastAt || at > m.lastAt)) m.lastAt = at;
  }

  return NextResponse.json({ summary });
}
