import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, proposalInstalments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

/**
 * POST /api/proposals/[id]/lost
 * Mark a proposal as lost with a required reason.
 * Voids any unpaid Stripe invoices tied to the proposal.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const { reason } = body;

  if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
    return NextResponse.json(
      { error: "A reason is required to mark a proposal as lost" },
      { status: 400 }
    );
  }

  // Fetch the proposal
  const [proposal] = await db()
    .select()
    .from(proposals)
    .where(eq(proposals.id, id))
    .limit(1);

  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  // Don't allow marking already-lost proposals
  if (proposal.status === "lost") {
    return NextResponse.json({ error: "Proposal is already marked as lost" }, { status: 400 });
  }

  // Void unpaid Stripe invoices
  const voidResults: string[] = [];

  try {
    // Void the main invoice if it exists and isn't paid
    if (proposal.stripeInvoiceId) {
      await voidInvoiceIfUnpaid(proposal.stripeInvoiceId, voidResults);
    }

    // Void instalment invoices that aren't paid
    const instalments = await db()
      .select()
      .from(proposalInstalments)
      .where(eq(proposalInstalments.proposalId, id));

    for (const inst of instalments) {
      if (inst.stripeInvoiceId && inst.status !== "paid") {
        await voidInvoiceIfUnpaid(inst.stripeInvoiceId, voidResults);
      }
    }

    // Cancel subscription if exists
    if (proposal.stripeSubscriptionId) {
      try {
        await stripe.subscriptions.cancel(proposal.stripeSubscriptionId);
        voidResults.push(`subscription:${proposal.stripeSubscriptionId}`);
      } catch {
        // Subscription may already be cancelled
      }
    }
  } catch (err) {
    console.error("[proposals/lost] Stripe void error (non-blocking):", err);
    // Continue — marking as lost is more important than voiding
  }

  // Update proposal
  const now = new Date();
  const [updated] = await db()
    .update(proposals)
    .set({
      status: "lost",
      lostAt: now,
      lostReason: reason.trim(),
      lostBy: user.name,
      updatedAt: now,
    })
    .where(eq(proposals.id, id))
    .returning();

  return NextResponse.json({
    proposal: updated,
    voided: voidResults,
  });
}

async function voidInvoiceIfUnpaid(invoiceId: string, results: string[]) {
  try {
    const invoice = await stripe.invoices.retrieve(invoiceId);
    // Only void if open or draft (not paid, void, or uncollectible)
    if (invoice.status === "open" || invoice.status === "draft") {
      await stripe.invoices.voidInvoice(invoiceId);
      results.push(`invoice:${invoiceId}`);
    }
  } catch {
    // Invoice may not exist or already voided
  }
}
