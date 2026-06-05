import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, proposalInstalments, softwareCosts, manualExpenses, kpiOverrides } from "@/lib/db/schema";
import { and, eq, gte, lt, inArray, isNotNull, sql } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { stripe, hasStripe } from "@/lib/stripe/client";
import type Stripe from "stripe";
import { eachDayOfInterval, startOfDay, endOfDay, format } from "date-fns";

export const dynamic = "force-dynamic";

// ─── Date parsing helpers ─────────────────────────────────────────────────────

function parseRange(searchParams: URLSearchParams): { start: Date; end: Date } | null {
  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");
  if (startParam && endParam) {
    const start = new Date(startParam + "T00:00:00.000Z");
    const end = new Date(endParam + "T00:00:00.000Z");
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) return null;
    return { start, end };
  }
  const period = searchParams.get("period");
  if (period) {
    const match = period.match(/^(\d{4})-(\d{2})$/);
    if (!match) return null;
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    return { start: new Date(Date.UTC(year, month, 1)), end: new Date(Date.UTC(year, month + 1, 1)) };
  }
  return null;
}

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

function toMonthlyCents(item: Stripe.SubscriptionItem): number {
  const unitAmount = item.price.unit_amount ?? 0;
  const interval = item.price.recurring?.interval ?? "month";
  const count = item.price.recurring?.interval_count ?? 1;
  switch (interval) {
    case "year":  return unitAmount / (12 * count);
    case "week":  return (unitAmount * 52) / (12 * count);
    case "day":   return (unitAmount * 365) / (12 * count);
    default:      return unitAmount / count;
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const range = parseRange(searchParams);
    if (!range) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
    }

    const { start, end } = range;
    const startUnix = Math.floor(start.getTime() / 1000);
    const endUnix = Math.floor(end.getTime() / 1000);
    const now = new Date();
    const periodMonth = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;

    // ─── Stripe data (shared across Business + Management sections) ─────────
    let cashCollected = 0;
    let cashSeries: { date: string; value: number }[] = [];
    let mrr = 0;
    let managementMrr = 0;
    let managementClients = 0;
    let newManagementCount = 0;
    let newManagementValue = 0;
    let newProjectCount = 0;
    let newProjectValue = 0;
    let clientChurnCount = 0;
    let clientChurnValue = 0;
    let failedPayments = 0;
    let processingFees = 0;
    let refundsTotal = 0;
    let retentionRate = 0;
    let activeSubsAtPeriodStart = 0;
    let outstandingPayments = 0;
    let pastDueInvoiceCount = 0;

    if (hasStripe()) {
      const s = stripe();

      // Charges for cash collected
      let periodCharges: (Stripe.Charge & { balance_transaction: Stripe.BalanceTransaction | null })[] = [];
      try {
        periodCharges = await paginateAll<Stripe.Charge & { balance_transaction: Stripe.BalanceTransaction | null }>((after) =>
          s.charges.list({
            created: { gte: startUnix, lt: endUnix },
            expand: ["data.balance_transaction"],
            limit: 100,
            ...(after ? { starting_after: after } : {}),
          }) as Promise<{ data: (Stripe.Charge & { balance_transaction: Stripe.BalanceTransaction | null })[]; has_more: boolean }>
        );
      } catch (e) {
        console.error("[kpis/metrics] Charges fetch failed:", e);
      }

      const succeededCharges = periodCharges.filter((c) => c.status === "succeeded");
      cashCollected = succeededCharges.reduce((sum, c) => sum + c.amount, 0) / 100;

      // Daily cash series with dates
      const days = eachDayOfInterval({ start, end: new Date(Math.min(end.getTime(), Date.now())) });
      cashSeries = days.slice(0, 31).map((day) => {
        const dayStart = Math.floor(startOfDay(day).getTime() / 1000);
        const dayEnd = Math.floor(endOfDay(day).getTime() / 1000);
        return {
          date: format(day, "MMM d"),
          value: succeededCharges
            .filter((c) => c.created >= dayStart && c.created <= dayEnd)
            .reduce((sum, c) => sum + c.amount, 0) / 100,
        };
      });

      // Paid invoices for project client detection
      const paidInvoices = await paginateAll<Stripe.Invoice>((after) =>
        s.invoices.list({
          status: "paid",
          created: { gte: startUnix, lt: endUnix },
          limit: 100,
          ...(after ? { starting_after: after } : {}),
        })
      );

      const isSubInvoice = (inv: Stripe.Invoice) => inv.parent?.type === "subscription_details";

      const projectCustomerIds = new Set(
        paidInvoices.filter((inv) => !isSubInvoice(inv))
          .map((inv) => (typeof inv.customer === "string" ? inv.customer : (inv.customer as Stripe.Customer)?.id ?? ""))
          .filter(Boolean)
      );
      newProjectCount = projectCustomerIds.size;
      newProjectValue = paidInvoices.filter((inv) => !isSubInvoice(inv))
        .reduce((sum, inv) => sum + (inv.amount_paid ?? 0), 0) / 100;

      // Subscriptions
      let activeSubs: Stripe.Subscription[] = [];
      let cancelledSubs: Stripe.Subscription[] = [];
      try {
        [activeSubs, cancelledSubs] = await Promise.all([
          paginateAll<Stripe.Subscription>((after) =>
            s.subscriptions.list({ status: "active", limit: 100, ...(after ? { starting_after: after } : {}) })
          ),
          paginateAll<Stripe.Subscription>((after) =>
            s.subscriptions.list({ status: "canceled", limit: 100, ...(after ? { starting_after: after } : {}) })
          ),
        ]);
      } catch (e) {
        console.error("[kpis/metrics] Subscription fetch failed:", e);
      }

      // Management client count (current active)
      managementClients = new Set(
        activeSubs.map((sub) => typeof sub.customer === "string" ? sub.customer : sub.customer.id)
      ).size;

      // MRR from active subs
      managementMrr = activeSubs.reduce((sum, sub) => {
        const item = sub.items.data[0];
        return item ? sum + toMonthlyCents(item) : sum;
      }, 0) / 100;
      mrr = managementMrr; // Total MRR includes management + software (added below)

      // New management clients in period
      const newSubs = [...activeSubs, ...cancelledSubs].filter(
        (sub) => sub.created >= startUnix && sub.created < endUnix
      );
      const newMgmtIds = new Set(newSubs.map((sub) => typeof sub.customer === "string" ? sub.customer : sub.customer.id));
      newManagementCount = newMgmtIds.size;
      newManagementValue = newSubs.reduce((sum, sub) => {
        const item = sub.items.data[0];
        return item ? sum + (item.price.unit_amount ?? 0) : sum;
      }, 0) / 100;

      // Churned management MRR
      const churnedSubs = cancelledSubs.filter(
        (sub) => sub.canceled_at != null && sub.canceled_at >= startUnix && sub.canceled_at < endUnix
      );
      const churnedIds = new Set(churnedSubs.map((sub) => typeof sub.customer === "string" ? sub.customer : sub.customer.id));
      clientChurnCount = churnedIds.size;
      clientChurnValue = churnedSubs.reduce((sum, sub) => {
        const item = sub.items.data[0];
        return item ? sum + toMonthlyCents(item) : sum;
      }, 0) / 100;

      // Client retention rate: exclude new clients from numerator to measure true retention
      // retained = currentActive - newInPeriod; startOfPeriod = retained + churned
      const retainedClients = managementClients - newManagementCount;
      activeSubsAtPeriodStart = retainedClients + clientChurnCount;
      retentionRate = activeSubsAtPeriodStart > 0
        ? Math.round((retainedClients / activeSubsAtPeriodStart) * 1000) / 10
        : 100;

      // Failed payments + processing fees
      failedPayments = periodCharges.filter((c) => c.status === "failed").reduce((sum, c) => sum + c.amount, 0) / 100;
      processingFees = periodCharges
        .filter((c) => c.status === "succeeded" && c.balance_transaction)
        .reduce((sum, c) => sum + (c.balance_transaction?.fee ?? 0), 0) / 100;

      // Refunds
      try {
        const refundList = await paginateAll<Stripe.Refund>((after) =>
          s.refunds.list({ created: { gte: startUnix, lt: endUnix }, limit: 100, ...(after ? { starting_after: after } : {}) })
        );
        refundsTotal = refundList.reduce((sum, r) => sum + r.amount, 0) / 100;
      } catch (e) {
        console.error("[kpis/metrics] Refunds fetch failed:", e);
      }

      // Outstanding payments — open invoices that are past their due date
      // (Stripe's "Past due" filter = status `open` with a due_date in the past).
      // This is a live snapshot of money owed, not period-scoped.
      try {
        const openInvoices = await paginateAll<Stripe.Invoice>((after) =>
          s.invoices.list({ status: "open", limit: 100, ...(after ? { starting_after: after } : {}) })
        );
        const nowUnix = Math.floor(now.getTime() / 1000);
        const pastDue = openInvoices.filter((inv) => inv.due_date != null && inv.due_date < nowUnix);
        pastDueInvoiceCount = pastDue.length;
        outstandingPayments = pastDue.reduce((sum, inv) => sum + (inv.amount_remaining ?? 0), 0) / 100;
      } catch (e) {
        console.error("[kpis/metrics] Open invoices fetch failed:", e);
      }
    }

    // ─── Proposal metrics (shared across sections) ────────────────────────────
    // Fetch with dates so we can build daily series
    const [
      outstandingRows,
      mgmtSentRows,
      mgmtLostRows,
      projSentRows,
      projLostRows,
      projPaidRows,
    ] = await Promise.all([
      db().select({ totalAmount: proposals.totalAmount }).from(proposals)
        .where(inArray(proposals.status, ["sent", "signed", "partial"])),
      db().select({ totalAmount: proposals.totalAmount, sentAt: proposals.sentAt }).from(proposals)
        .where(and(eq(proposals.type, "management"), isNotNull(proposals.sentAt), gte(proposals.sentAt, start), lt(proposals.sentAt, end))),
      db().select({ totalAmount: proposals.totalAmount, lostAt: proposals.lostAt }).from(proposals)
        .where(and(eq(proposals.type, "management"), isNotNull(proposals.lostAt), gte(proposals.lostAt, start), lt(proposals.lostAt, end))),
      db().select({ totalAmount: proposals.totalAmount, sentAt: proposals.sentAt }).from(proposals)
        .where(and(eq(proposals.type, "project"), isNotNull(proposals.sentAt), gte(proposals.sentAt, start), lt(proposals.sentAt, end))),
      db().select({ totalAmount: proposals.totalAmount, lostAt: proposals.lostAt }).from(proposals)
        .where(and(eq(proposals.type, "project"), isNotNull(proposals.lostAt), gte(proposals.lostAt, start), lt(proposals.lostAt, end))),
      db().select({ totalAmount: proposals.totalAmount, paidAt: proposals.paidAt }).from(proposals)
        .where(and(eq(proposals.type, "project"), isNotNull(proposals.paidAt), gte(proposals.paidAt, start), lt(proposals.paidAt, end))),
    ]);

    const outstanding = outstandingRows.reduce((sum, r) => sum + r.totalAmount, 0);
    const mgmtProposalValueSent = mgmtSentRows.reduce((sum, r) => sum + r.totalAmount, 0);
    const mgmtProposalValueLost = mgmtLostRows.reduce((sum, r) => sum + r.totalAmount, 0);
    const projProposalValueSent = projSentRows.reduce((sum, r) => sum + r.totalAmount, 0);
    const projProposalValueLost = projLostRows.reduce((sum, r) => sum + r.totalAmount, 0);

    // New Project Value/Count = project-type proposals marked PAID in our system
    // (overrides the earlier Stripe one-off-invoice definition, per product spec).
    newProjectValue = projPaidRows.reduce((sum, r) => sum + r.totalAmount, 0);
    newProjectCount = projPaidRows.length;

    // Build daily series for proposal metrics
    const sparkDays = eachDayOfInterval({ start, end: new Date(Math.min(end.getTime(), Date.now())) }).slice(0, 31);
    function buildDailySeries(rows: { totalAmount: number; sentAt?: Date | null; lostAt?: Date | null; paidAt?: Date | null }[], dateField: "sentAt" | "lostAt" | "paidAt") {
      return sparkDays.map((day) => {
        const dayS = startOfDay(day).getTime();
        const dayE = endOfDay(day).getTime();
        const total = rows.filter((r) => {
          const d = r[dateField];
          if (!d) return false;
          const t = new Date(d).getTime();
          return t >= dayS && t <= dayE;
        }).reduce((sum, r) => sum + r.totalAmount, 0);
        return { date: format(day, "MMM d"), value: total };
      });
    }

    const mgmtSentSeries = buildDailySeries(mgmtSentRows, "sentAt");
    const projSentSeries = buildDailySeries(projSentRows, "sentAt");
    const projPaidSeries = buildDailySeries(projPaidRows, "paidAt");

    // ─── Expenses (software costs + manual expenses) ──────────────────────────
    const [softwareCostRows, manualExpenseRows] = await Promise.all([
      db().select({ monthlyCost: softwareCosts.monthlyCost }).from(softwareCosts)
        .where(eq(softwareCosts.active, true)),
      db().select({ amount: manualExpenses.amount }).from(manualExpenses)
        .where(eq(manualExpenses.month, periodMonth)),
    ]);

    const softwareCostTotal = softwareCostRows.reduce((sum, r) => sum + r.monthlyCost, 0);
    const manualExpenseTotal = manualExpenseRows.reduce((sum, r) => sum + r.amount, 0);

    // ─── Ad spend (total from Meta + TikTok) ─────────────────────────────────
    // Computed before totalExpenses because ad spend is an expense in that total.
    let metaAdSpend = 0;
    let tiktokAdSpend = 0;

    try {
      const adAccountId = process.env.META_AD_ACCOUNT_ID;
      if (adAccountId) {
        const sinceStr = start.toISOString().slice(0, 10);
        const untilStr = new Date(end.getTime() - 86400000).toISOString().slice(0, 10);
        const { meta } = await import("@/lib/meta/client");
        const res = await meta.get<{ data: Array<{ spend?: string }> }>(
          `/${adAccountId}/insights`,
          { fields: "spend", time_range: JSON.stringify({ since: sinceStr, until: untilStr }) }
        );
        metaAdSpend = (res.data ?? []).reduce((sum, d) => sum + parseFloat(d.spend ?? "0"), 0);
      }
    } catch (e) {
      console.error("[kpis/metrics] Meta ad spend failed:", e);
    }

    // TikTok ad spend — placeholder, will integrate when API is wired
    // tiktokAdSpend = 0;

    const totalAdSpend = metaAdSpend + tiktokAdSpend;

    // Ad spend is part of total expenses (and therefore reduces net P/L).
    const totalExpenses = softwareCostTotal + manualExpenseTotal + processingFees + refundsTotal + totalAdSpend;
    const netPL = cashCollected - totalExpenses;

    // Total MRR = management MRR + software costs
    mrr = managementMrr + softwareCostTotal;

    // ─── Active Projects (auto-calculated, manual override takes precedence) ──
    let activeProjects = 0;
    try {
      const [override] = await db().select({ value: kpiOverrides.value }).from(kpiOverrides)
        .where(and(
          eq(kpiOverrides.metricKey, "active_projects"),
          eq(kpiOverrides.period, periodMonth),
        )).limit(1);
      if (override) {
        activeProjects = override.value;
      } else {
        // Auto-calculate: project-type proposals in active states (sent, signed, or paid without an end date in the past)
        const activeProjectRows = await db()
          .select({ id: proposals.id })
          .from(proposals)
          .where(and(
            eq(proposals.type, "project"),
            inArray(proposals.status, ["sent", "signed", "paid"]),
          ));
        activeProjects = activeProjectRows.length;
      }
    } catch {
      // fallback to 0
    }

    // ─── Response ─────────────────────────────────────────────────────────────
    return NextResponse.json({
      // Business Metrics
      business: {
        cashCollected,
        cashSeries,
        outstanding,
        outstandingPayments,
        totalMrr: mrr,
        totalExpenses,
        netPL,
      },
      // Management Metrics
      management: {
        managementMrr,
        newManagementMrr: newManagementValue,
        churnedManagementMrr: clientChurnValue,
        managementClients,
        clientRetentionRate: retentionRate,
      },
      // Project Metrics
      project: {
        newProjectValue,
        newProjectValueSeries: projPaidSeries,
        activeProjects,
      },
      // Sales Metrics
      sales: {
        mgmtProposalValueSent,
        mgmtProposalValueSentSeries: mgmtSentSeries,
        mgmtProposalValueLost,
        projProposalValueSent,
        projProposalValueSentSeries: projSentSeries,
        projProposalValueLost,
        adSpend: totalAdSpend,
        adSpendMeta: metaAdSpend,
        adSpendTiktok: tiktokAdSpend,
      },
      // Raw data for sparklines / detail
      _raw: {
        processingFees,
        refunds: refundsTotal,
        failedPayments,
        softwareCosts: softwareCostTotal,
        manualExpenses: manualExpenseTotal,
        newManagementCount,
        newProjectCount,
        clientChurnCount,
        pastDueInvoiceCount,
      },
    });
  } catch (err) {
    console.error("[GET /api/kpis/metrics]", err);
    return NextResponse.json({ error: "Failed to load metrics" }, { status: 500 });
  }
}
