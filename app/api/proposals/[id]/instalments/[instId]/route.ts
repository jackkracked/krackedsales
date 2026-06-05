import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, proposalInstalments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; instId: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: proposalId, instId } = await params;
    const body = await req.json() as { status: "paid" | "pending"; paidAt?: string };

    const paidAt = body.status === "paid"
      ? (body.paidAt ? new Date(body.paidAt) : new Date())
      : null;

    await db()
      .update(proposalInstalments)
      .set({ status: body.status, paidAt: paidAt ?? undefined, })
      .where(eq(proposalInstalments.id, instId));

    // Recompute parent proposal status
    const allInstalments = await db()
      .select()
      .from(proposalInstalments)
      .where(eq(proposalInstalments.proposalId, proposalId));

    const allPaid = allInstalments.every((i) => i.status === "paid");
    const anyPaid = allInstalments.some((i) => i.status === "paid");

    const newStatus = allPaid ? "paid" : anyPaid ? "partial" : "signed";
    const paidAtUpdate = allPaid ? new Date() : null;

    await db()
      .update(proposals)
      .set({
        status: newStatus,
        ...(paidAtUpdate ? { paidAt: paidAtUpdate } : {}),
        updatedAt: new Date(),
      })
      .where(eq(proposals.id, proposalId));

    return NextResponse.json({ ok: true, proposalStatus: newStatus });
  } catch (err) {
    console.error("[PATCH /api/proposals/[id]/instalments/[instId]]", err);
    return NextResponse.json({ error: "Failed to update instalment" }, { status: 500 });
  }
}
