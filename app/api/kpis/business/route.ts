import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, proposalInstalments } from "@/lib/db/schema";
import { and, eq, gte, lt, isNotNull, inArray, or, isNull } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { stripe, hasStripe } from "@/lib/stripe/client";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

function parsePeriod(period: string): { start: Date; end: Date } | null {
  const match = period.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  return { start, end };
}

function parseRange(searchParams: URLSearchParams): { start: Date; end: Date } | null {
  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");
  if (startParam && endParam) {
    const start = new Date(startParam + "T00:00:00.000Z");
    const end = new Date(endParam + "T00:00:00.000Z");
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) return null;
    return { start, end };
  }
  return parsePeriod(searchParams.get("period") ?? "");
}

// Paginate through all pages of a Stripe list
async function paginateAll<T extends { id: string }>(
  fetcher: (startingAfter?: string) => Promise<{ data: T[]; has_more: boolean }>
): Promise<T[]> {
  const all: T[] = [];
  let startingAfter: string | undefined;
  while (true) {
    const page = await fetcher(startingAfter);
    all.push(...page.data);
    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return all;
}

// Normalise a subscription price to monthly amount in dollars
function toMonthlyCents(item: Stripe.SubscriptionItem): number {
  const unitAmount = item.price.unit_amount ?? 0;
  const interval = item.price.recurring?.interval ?? "month";
  const count = item.price.recurring?.interval_count ?? 1;
  switch (interval) {
    case "year":  return unitAmount / (12 * count);
    case "week":  return (unitAmount * 52) / (12 * count);
    case "day":   return (unitAmount * 365) / (12 * count);
    default:      return unitAmount / count; // month
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const range = parseRange(searchParams);
    if (!range) {
      return NextResponse.json(
        { error: "Invalid date range — use ?start=YYYY-MM-DD&end=YYYY-MM-DD or ?period=YYYY-MM" },
        { status: 400 }
      );
    }
    const { start, end } = range;
    const now = new Date();

    // ─── Proposals-only metrics (outstanding, failed, overdue, sent value) ────
    const [outstandingRows, failedRows, overdueInstalments, proposalsSentInPeriod] = await Promise.all([
      db().select({ totalAmount: proposals.totalAmount }).from(proposals).where(
        inArray(proposals.status, ["sent", "signed"])
      ),
      db().select({ totalAmount: proposals.totalAmount }).from(proposals).where(
        eq(proposals.status, "failed")
      ),
      db().select({ amount: proposalInstalments.amount }).from(proposalInstalments).where(
        and(eq(proposalInstalments.status, "pending"), lt(proposalInstalments.dueDate, now))
      ),
      db().select({ totalAmount: proposals.totalAmount }).from(proposals).where(
        and(isNotNull(proposals.sentAt), gte(proposals.sentAt, start), lt(proposals.sentAt, end))
      ),
    ]);

    const outstanding = outstandingRows.reduce((sum, r) => sum + r.totalAmount, 0);
    const outstandingOverdue = overdueInstalments.reduce((sum, r) => sum + r.amount, 0);
    const failedPayments = failedRows.reduce((sum, r) => sum + r.totalAmount, 0);
    const valueOfProposalsSent = proposalsSentInPeriod.reduce((sum, r) => sum + r.totalAmount, 0);

    // ─── All Stripe-sourced metrics ───────────────────────────────────────────
    let cashCollected = 0;
    let mrr = 0;
    let managementClients = 0;
    let newManagementCount = 0;
    let newManagementValue = 0;
    let newProjectCount = 0;
    let newProjectValue = 0;
    let clientChurnCount = 0;
    let clientChurnValue = 0;
    let processingFees = 0;
    let refunds = 0;

    if (hasStripe()) {
      const stripeClient = stripe();
      const startUnix = Math.floor(start.getTime() / 1000);
      const endUnix = Math.floor(end.getTime() / 1000);

      // 1. Paid invoices in period → cash collected, new project clients
      const paidInvoices = await paginateAll<Stripe.Invoice>((after) =>
        stripeClient.invoices.list({
          status: "paid",
          created: { gte: startUnix, lt: endUnix },
          limit: 100,
          ...(after ? { starting_after: after } : {}),
        })
      );

      cashCollected = paidInvoices.reduce((sum, inv) => sum + (inv.amount_paid ?? 0), 0) / 100;

      // New project clients = distinct customers on one-time (non-subscription) paid invoices
      const projectCustomerIds = new Set(
        paidInvoices
          .filter((inv) => !inv.subscription)
          .map((inv) => (typeof inv.customer === "string" ? inv.customer : inv.customer?.id ?? ""))
          .filter(Boolean)
      );
      newProjectCount = projectCustomerIds.size;
      newProjectValue = paidInvoices
        .filter((inv) => !inv.subscription)
        .reduce((sum, inv) => sum + (inv.amount_paid ?? 0), 0) / 100;

      // 2. All active subscriptions → MRR, management client count
      const activeSubscriptions = await paginateAll<Stripe.Subscription>((after) =>
        stripeClient.subscriptions.list({
          status: "active",
          limit: 100,
          ...(after ? { starting_after: after } : {}),
        })
      );

      mrr = activeSubscriptions.reduce((sum, sub) => {
        const item = sub.items.data[0];
        if (!item) return sum;
        return sum + toMonthlyCents(item);
      }, 0) / 100;

      managementClients = new Set(
        activeSubscriptions.map((sub) =>
          typeof sub.customer === "string" ? sub.customer : sub.customer.id
        )
      ).size;

      // 3. New subscriptions created in period → new management clients
      const newSubscriptions = activeSubscriptions.filter(
        (sub) => sub.created >= startUnix && sub.created < endUnix
      );
      // Also check canceled subscriptions created in the period
      const newCanceledSubs = await paginateAll<Stripe.Subscription>((after) =>
        stripeClient.subscriptions.list({
          status: "canceled",
          created: { gte: startUnix, lt: endUnix },
          limit: 100,
          ...(after ? { starting_after: after } : {}),
        })
      );
      const allNewSubs = [...newSubscriptions, ...newCanceledSubs];

      const newManagementCustomerIds = new Set(
        allNewSubs.map((sub) =>
          typeof sub.customer === "string" ? sub.customer : sub.customer.id
        )
      );
      newManagementCount = newManagementCustomerIds.size;
      newManagementValue = allNewSubs.reduce((sum, sub) => {
        const item = sub.items.data[0];
        if (!item) return sum;
        return sum + (item.price.unit_amount ?? 0);
      }, 0) / 100;

      // 4. Subscriptions cancelled in period → client churn
      // Use events API to find cancellations that happened in the period
      const cancelEvents = await paginateAll<Stripe.Event>((after) =>
        stripeClient.events.list({
          type: "customer.subscription.deleted",
          created: { gte: startUnix, lt: endUnix },
          limit: 100,
          ...(after ? { starting_after: after } : {}),
        })
      );

      const churnedCustomerIds = new Set(
        cancelEvents.map((evt) => {
          const sub = evt.data.object as Stripe.Subscription;
          return typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        })
      );
      clientChurnCount = churnedCustomerIds.size;
      clientChurnValue = cancelEvents.reduce((sum, evt) => {
        const sub = evt.data.object as Stripe.Subscription;
        const item = sub.items?.data?.[0];
        if (!item) return sum;
        return sum + toMonthlyCents(item);
      }, 0) / 100;

      // 5. Processing fees from balance transactions
      try {
        const txns = await paginateAll<Stripe.BalanceTransaction>((after) =>
          stripeClient.balanceTransactions.list({
            type: "charge",
            created: { gte: startUnix, lt: endUnix },
            limit: 100,
            ...(after ? { starting_after: after } : {}),
          })
        );
        processingFees = txns.reduce((sum, t) => sum + t.fee, 0) / 100;
      } catch (e) {
        console.error("[kpis/business] Balance transactions failed:", e);
      }

      // 6. Refunds
      try {
        const refundList = await paginateAll<Stripe.Refund>((after) =>
          stripeClient.refunds.list({
            created: { gte: startUnix, lt: endUnix },
            limit: 100,
            ...(after ? { starting_after: after } : {}),
          })
        );
        refunds = refundList.reduce((sum, r) => sum + r.amount, 0) / 100;
      } catch (e) {
        console.error("[kpis/business] Refunds fetch failed:", e);
      }
    }

    const totalValueAddLoss = newProjectValue + newManagementValue - clientChurnValue - refunds;

    return NextResponse.json({
      // Revenue
      cashCollected,
      mrr,
      processingFees,
      refunds,
      totalValueAddLoss,
      // Client counts
      managementClients,
      activeProjectClients: newProjectCount,
      newManagementCount,
      newManagementValue,
      newProjectCount,
      newProjectValue,
      clientChurnCount,
      clientChurnValue,
      // Pipeline (proposals-only — will be 0 until real proposals exist)
      outstanding,
      outstandingOverdue,
      failedPayments,
      valueOfProposalsSent,
    });
  } catch (err) {
    console.error("[GET /api/kpis/business]", err);
    return NextResponse.json({ error: "Failed to load business metrics" }, { status: 500 });
  }
}
