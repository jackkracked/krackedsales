import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { proposals, proposalInstalments } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    // Only GHL contacts have proposals (matched by ghlContactId)
    if (!id.startsWith("ghl_")) {
      return NextResponse.json({ proposals: [], instalments: {}, ltv: 0, paidCount: 0 });
    }

    const ghlContactId = id.slice(4);

    const contactProposals = await db()
      .select()
      .from(proposals)
      .where(eq(proposals.ghlContactId, ghlContactId))
      .orderBy(proposals.createdAt);

    // Fetch instalments for all proposals in one query
    const instalmentsMap: Record<string, typeof proposalInstalments.$inferSelect[]> = {};
    if (contactProposals.length > 0) {
      for (const p of contactProposals) {
        const rows = await db()
          .select()
          .from(proposalInstalments)
          .where(eq(proposalInstalments.proposalId, p.id))
          .orderBy(proposalInstalments.instalmentNumber);
        instalmentsMap[p.id] = rows;
      }
    }

    // LTV = sum of all paid proposal amounts
    const ltv = contactProposals
      .filter((p) => p.status === "paid")
      .reduce((sum, p) => sum + p.totalAmount, 0);

    const paidCount = contactProposals.filter((p) => p.status === "paid").length;

    return NextResponse.json({ proposals: contactProposals, instalments: instalmentsMap, ltv, paidCount });
  } catch (err) {
    console.error("[GET /api/contacts/[id]/proposals]", err);
    return NextResponse.json({ error: "Failed to fetch proposals" }, { status: 500 });
  }
}
