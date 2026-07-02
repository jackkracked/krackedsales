import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { logActivity } from "@/lib/activity/logger";
import { dispatchWorkflowEvent, buildProposalPayload } from "@/lib/workflows/triggers";
import { settleDeposits } from "@/lib/proposals/deposit-billing";

export const dynamic = "force-dynamic";

/**
 * POST /api/proposals/[id]/deposit-paid
 *
 * Admin "sync deposit from Stripe" action. It reconciles the deposit instalments
 * against their real Stripe invoices: it marks paid ONLY what Stripe has actually
 * collected, records the true collected total, and creates the subscription ONLY when
 * the full deposit is genuinely paid. It never fabricates payment state.
 *
 * (Previously this blindly marked every deposit paid and started the subscription on a
 * single click, which is how a partial deposit ended up shown as fully paid.)
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    // Reconcile against Stripe (money-safe: only marks what actually cleared).
    const result = await settleDeposits(id);

    logActivity({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      action: "proposal.deposit_reconcile",
      entityType: "proposal",
      entityId: proposal.id,
      entityName: proposal.contactName,
      metadata: {
        paid_total: result.paidTotal,
        deposit_total: result.depositTotal,
        fully_paid: result.fullyPaid,
        subscription_id: result.subscriptionId,
      },
    });

    if (result.justCompleted) {
      buildProposalPayload(id).then((payload) =>
        dispatchWorkflowEvent("proposal.paid", payload)
      ).catch(() => {});
    }

    const message = result.fullyPaid
      ? "Deposit is fully collected in Stripe. Subscription is active."
      : `Only ${formatMoney(result.paidTotal, proposal.currency)} of ${formatMoney(result.depositTotal, proposal.currency)} has cleared in Stripe. Marked what actually paid; the rest is still outstanding.`;

    return NextResponse.json({
      success: true,
      fullyPaid: result.fullyPaid,
      paidTotal: result.paidTotal,
      depositTotal: result.depositTotal,
      subscriptionId: result.subscriptionId,
      message,
    });
  } catch (err) {
    console.error("[POST /api/proposals/[id]/deposit-paid]", err);
    const msg = err instanceof Error ? err.message : "Failed to reconcile deposit";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency || "usd").toUpperCase(),
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount} ${(currency || "").toUpperCase()}`.trim();
  }
}
