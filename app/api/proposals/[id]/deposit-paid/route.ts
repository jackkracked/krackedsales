import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, proposalInstalments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { hasStripe, stripe } from "@/lib/stripe/client";
import { logActivity } from "@/lib/activity/logger";
import { dispatchWorkflowEvent, buildProposalPayload } from "@/lib/workflows/triggers";
import type Stripe from "stripe";

export const dynamic = "force-dynamic";

/**
 * POST /api/proposals/[id]/deposit-paid
 * Admin override: mark all remaining deposit instalments as paid and trigger subscription creation.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const [proposal] = await db().select().from(proposals).where(eq(proposals.id, id)).limit(1);
    if (!proposal) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!proposal.hasDeposit) {
      return NextResponse.json({ error: "This proposal does not have deposits" }, { status: 400 });
    }
    if (proposal.subscriptionCreatedAt) {
      return NextResponse.json({ error: "Subscription already created" }, { status: 400 });
    }

    // Mark all unpaid deposit instalments as paid
    const allInstalments = await db()
      .select()
      .from(proposalInstalments)
      .where(eq(proposalInstalments.proposalId, id));

    const depositInstalments = allInstalments.filter(i => i.isDeposit);
    for (const inst of depositInstalments) {
      if (inst.status !== "paid") {
        await db()
          .update(proposalInstalments)
          .set({ status: "paid", paidAt: new Date() })
          .where(eq(proposalInstalments.id, inst.id));
      }
    }

    const depositTotal = proposal.depositTotal ?? proposal.totalAmount;

    // Create the Stripe subscription if Stripe is configured
    let subscriptionId: string | null = null;
    if (hasStripe() && proposal.stripeCustomerId) {
      const interval = (proposal.billingInterval ?? "month") as "day" | "week" | "month" | "year";
      const intervalCount = proposal.billingIntervalCount ?? 1;
      const startDate = proposal.startDate ?? new Date();
      const now = new Date();

      // trial_end = startDate + one billing cycle
      const trialEnd = new Date(startDate);
      if (interval === "day") trialEnd.setDate(trialEnd.getDate() + intervalCount);
      else if (interval === "week") trialEnd.setDate(trialEnd.getDate() + intervalCount * 7);
      else if (interval === "month") trialEnd.setMonth(trialEnd.getMonth() + intervalCount);
      else if (interval === "year") trialEnd.setFullYear(trialEnd.getFullYear() + intervalCount);

      const trialEndUnix = Math.max(
        Math.floor(trialEnd.getTime() / 1000),
        Math.floor(Date.now() / 1000) + 86400
      );

      const price = await stripe().prices.create({
        currency: proposal.currency,
        unit_amount: Math.round(proposal.totalAmount * 100),
        recurring: { interval, interval_count: intervalCount },
        product_data: {
          name: proposal.title,
          metadata: { proposal_id: proposal.id },
        },
      });

      const subParams: Stripe.SubscriptionCreateParams = {
        customer: proposal.stripeCustomerId,
        items: [{ price: price.id }],
        trial_end: trialEndUnix,
        metadata: { proposal_id: proposal.id },
      };

      if (startDate > now) {
        subParams.billing_cycle_anchor = Math.floor(startDate.getTime() / 1000);
        subParams.proration_behavior = "none";
      }

      const subscription = await stripe().subscriptions.create(subParams);
      subscriptionId = subscription.id;
    }

    await db()
      .update(proposals)
      .set({
        status: "paid",
        paidAt: new Date(),
        depositsPaidTotal: depositTotal,
        subscriptionCreatedAt: new Date(),
        stripeSubscriptionId: subscriptionId,
        updatedAt: new Date(),
      })
      .where(eq(proposals.id, id));

    logActivity({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      action: "proposal.deposit_override",
      entityType: "proposal",
      entityId: proposal.id,
      entityName: proposal.contactName,
      metadata: { deposit_total: depositTotal },
    });

    buildProposalPayload(id).then((payload) =>
      dispatchWorkflowEvent("proposal.paid", payload)
    ).catch(() => {});

    return NextResponse.json({ success: true, subscriptionId });
  } catch (err) {
    console.error("[POST /api/proposals/[id]/deposit-paid]", err);
    const msg = err instanceof Error ? err.message : "Failed to process deposit override";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
