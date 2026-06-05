import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, proposalInstalments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { dispatchWorkflowEvent } from "@/lib/workflows/triggers";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [proposal] = await db().select().from(proposals).where(eq(proposals.id, id)).limit(1);
    if (!proposal) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const instalments = await db()
      .select()
      .from(proposalInstalments)
      .where(eq(proposalInstalments.proposalId, id));

    return NextResponse.json({ proposal: { ...proposal, instalments } });
  } catch (err) {
    console.error("[GET /api/proposals/[id]]", err);
    return NextResponse.json({ error: "Failed to fetch proposal" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await req.json() as Record<string, unknown>;

    // Convert any timestamp strings to Date objects — Drizzle requires Date for timestamp columns
    const sanitized: Record<string, unknown> = { ...body, updatedAt: new Date() };
    for (const key of ["paidAt", "sentAt", "signedAt", "expiresAt", "startDate", "endDate", "cancelledAt", "lostAt"]) {
      if (typeof sanitized[key] === "string") {
        sanitized[key] = new Date(sanitized[key] as string);
      }
    }

    const [updated] = await db()
      .update(proposals)
      .set(sanitized)
      .where(eq(proposals.id, id))
      .returning();

    // Fire workflow trigger when manually marked as paid
    if (body.status === "paid") {
      dispatchWorkflowEvent("proposal.paid", {
        proposalId: updated.id,
        manuallyMarkedPaid: true,
        contactName: updated.contactName,
        contactEmail: updated.contactEmail ?? null,
        contactId: updated.ghlContactId,
        opportunityId: updated.opportunityId ?? null,
        proposalTitle: updated.title,
        proposalType: updated.type,
        totalAmount: updated.totalAmount,
        currency: updated.currency,
        serviceDescription: updated.serviceDescription ?? null,
        paymentStructure: updated.paymentStructure,
        signerTitle: updated.signerTitle ?? null,
        paidAt: updated.paidAt?.toISOString() ?? new Date().toISOString(),
        signedAt: updated.signedAt?.toISOString() ?? null,
        stripeCustomerId: updated.stripeCustomerId ?? null,
        stripeSubscriptionId: updated.stripeSubscriptionId ?? null,
      }).catch(() => {});
    }

    return NextResponse.json({ proposal: updated });
  } catch (err) {
    console.error("[PATCH /api/proposals/[id]]", err);
    return NextResponse.json({ error: "Failed to update proposal" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    // proposalInstalments cascade-deletes automatically (FK onDelete: cascade)
    await db().delete(proposals).where(eq(proposals.id, id));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/proposals/[id]]", err);
    return NextResponse.json({ error: "Failed to delete proposal" }, { status: 500 });
  }
}
