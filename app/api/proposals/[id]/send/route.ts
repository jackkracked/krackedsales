import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, proposalInstalments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { hasStripe, stripe } from "@/lib/stripe/client";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const [proposal] = await db().select().from(proposals).where(eq(proposals.id, id)).limit(1);
    if (!proposal) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (proposal.status !== "draft") {
      return NextResponse.json({ error: "Proposal already sent" }, { status: 400 });
    }

    // Finalize Stripe invoices if available
    if (hasStripe()) {
      if (proposal.paymentStructure === "single" && proposal.stripeInvoiceId) {
        await stripe().invoices.finalizeInvoice(proposal.stripeInvoiceId, { auto_advance: false });
      } else if (proposal.paymentStructure === "instalment") {
        const instalments = await db()
          .select()
          .from(proposalInstalments)
          .where(eq(proposalInstalments.proposalId, id));
        for (const inst of instalments) {
          if (inst.stripeInvoiceId) {
            await stripe().invoices.finalizeInvoice(inst.stripeInvoiceId, { auto_advance: false });
          }
        }
      }
      // Subscription: will be created when client pays after signing
    }

    await db()
      .update(proposals)
      .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
      .where(eq(proposals.id, id));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[POST /api/proposals/[id]/send]", err);
    return NextResponse.json({ error: "Failed to send proposal" }, { status: 500 });
  }
}
