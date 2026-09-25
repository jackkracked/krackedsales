import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, proposalInstalments, softwareCosts, manualExpenses, projectStatuses, teamSalaries } from "@/lib/db/schema";
import { and, eq, gte, lt, inArray, isNotNull, sql } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { stripe, hasStripe } from "@/lib/stripe/client";
import type Stripe from "stripe";
import { eachDayOfInterval, startOfDay, endOfDay, format } from "date-fns";
import { listConfigs, getMetricValues } from "@/lib/kpi/engine";
import { legacyChargesLocal, legacyPaidInvoicesLocal, legacySubsLocal, legacyRefundsLocal, legacyOpenInvoicesLocal } from "@/lib/kpi/engine/datasets/stripe-local";
import { monthlyAmount } from "@/lib/stripe/cycle";

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
  // Shared helper: a 30-day cycle is the monthly retainer, not 1.0139 months. See lib/stripe/cycle.ts.
  return monthlyAmount(item.price.unit_amount, item.price.recurring?.interval, item.price.recurring?.interval_count);
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser();
    // Admin-only: this powers the /kpis page (company-wide KPIs incl. revenue/MRR). Reps get
    // rep-scoped KPIs on their own dashboard via /api/dashboard/kpis and never reach here.
    if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const range = parseRange(searchParams);
    if (!range) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
    }

    const { start, end } = range;
    // Stripe read source: "local" computes from the local_stripe_* mirror (fast); default "live"
    // hits Stripe's API. Rollout flag with parity proof — flip the default only once proven.
    const stripeSource: "live" | "local" = searchParams.get("stripeSource") === "local" ? "local" : "live";
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
    let outstandingInvoiceCount = 0;

    if (stripeSource === "local" || hasStripe()) {
      let periodCharges: (Stripe.Charge & { balance_transaction: Stripe.BalanceTransaction | null })[];
      let paidInvoices: Stripe.Invoice[];
      let activeSubs: Stripe.Subscription[];
      let cancelledSubs: Stripe.Subscription[];
      let refundList: Stripe.Refund[];
      let openInvoices: Stripe.Invoice[];

      if (stripeSource === "local") {
        // Read the same universes from the local Stripe mirror (no live Stripe calls). The
        // reductions below are byte-identical — only the source changes.
        [periodCharges, paidInvoices, activeSubs, cancelledSubs, refundList, openInvoices] = await Promise.all([
          legacyChargesLocal(start, end),
          legacyPaidInvoicesLocal(start, end),
          legacySubsLocal("active"),
          legacySubsLocal("canceled"),
          legacyRefundsLocal(start, end),
          legacyOpenInvoicesLocal(),
        ]);
      } else {
        const s = stripe();
        // Fetch every Stripe universe we need CONCURRENTLY. Each is best-effort: a failure
        // yields [] so one bad call can't 500 the page.
        const [pc, pi, subsPair, rl, oi] = await Promise.all([
          paginateAll<Stripe.Charge & { balance_transaction: Stripe.BalanceTransaction | null }>((after) =>
            s.charges.list({
              created: { gte: startUnix, lt: endUnix },
              expand: ["data.balance_transaction"],
              limit: 100,
              ...(after ? { starting_after: after } : {}),
            }) as Promise<{ data: (Stripe.Charge & { balance_transaction: Stripe.BalanceTransaction | null })[]; has_more: boolean }>
          ).catch((e) => { console.error("[kpis/metrics] Charges fetch failed:", e); return [] as (Stripe.Charge & { balance_transaction: Stripe.BalanceTransaction | null })[]; }),
          paginateAll<Stripe.Invoice>((after) =>
            s.invoices.list({ status: "paid", created: { gte: startUnix, lt: endUnix }, limit: 100, ...(after ? { starting_after: after } : {}) })
          ).catch((e) => { console.error("[kpis/metrics] Paid invoices fetch failed:", e); return [] as Stripe.Invoice[]; }),
          (Promise.all([
            paginateAll<Stripe.Subscription>((after) =>
              s.subscriptions.list({ status: "active", limit: 100, ...(after ? { starting_after: after } : {}) })
            ),
            paginateAll<Stripe.Subscription>((after) =>
              s.subscriptions.list({ status: "canceled", limit: 100, ...(after ? { starting_after: after } : {}) })
            ),
          ]) as Promise<[Stripe.Subscription[], Stripe.Subscription[]]>).catch((e) => { console.error("[kpis/metrics] Subscription fetch failed:", e); return [[], []] as [Stripe.Subscription[], Stripe.Subscription[]]; }),
          paginateAll<Stripe.Refund>((after) =>
            s.refunds.list({ created: { gte: startUnix, lt: endUnix }, limit: 100, ...(after ? { starting_after: after } : {}) })
          ).catch((e) => { console.error("[kpis/metrics] Refunds fetch failed:", e); return [] as Stripe.Refund[]; }),
          paginateAll<Stripe.Invoice>((after) =>
            s.invoices.list({ status: "open", limit: 100, ...(after ? { starting_after: after } : {}) })
          ).catch((e) => { console.error("[kpis/metrics] Open invoices fetch failed:", e); return [] as Stripe.Invoice[]; }),
        ]);
        periodCharges = pc; paidInvoices = pi; [activeSubs, cancelledSubs] = subsPair; refundList = rl; openInvoices = oi;
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
      const isSubInvoice = (inv: Stripe.Invoice) => inv.parent?.type === "subscription_details";

      const projectCustomerIds = new Set(
        paidInvoices.filter((inv) => !isSubInvoice(inv))
          .map((inv) => (typeof inv.customer === "string" ? inv.customer : (inv.customer as Stripe.Customer)?.id ?? ""))
          .filter(Boolean)
      );
      newProjectCount = projectCustomerIds.size;
      newProjectValue = paidInvoices.filter((inv) => !isSubInvoice(inv))
        .reduce((sum, inv) => sum + (inv.amount_paid ?? 0), 0) / 100;

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

      // New management clients in period. A subscription that started AND was
      // cancelled is not new recurring revenue, so canceled subs are excluded (the
      // authoritative `newManagementMrr` engine config applies the same status filter).
      const newSubs = activeSubs.filter(
        (sub) => sub.created >= startUnix && sub.created < endUnix
      );
      const newMgmtIds = new Set(newSubs.map((sub) => typeof sub.customer === "string" ? sub.customer : sub.customer.id));
      newManagementCount = newMgmtIds.size;
      // New Management MRR is an MRR figure — normalize to the monthly run-rate, same as
      // total/churned MRR (so a prepaid or multi-month sub isn't shown as its full term value).
      newManagementValue = newSubs.reduce((sum, sub) => {
        const item = sub.items.data[0];
        return item ? sum + toMonthlyCents(item) : sum;
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

      // Refunds (already fetched concurrently above)
      refundsTotal = refundList.reduce((sum, r) => sum + r.amount, 0) / 100;

      // Outstanding payments — ALL open (finalized-unpaid) invoices: money owed across one-off
      // billing AND subscriptions (a past-due/unpaid subscription is itself an open invoice), whether
      // due soon or already overdue. Live snapshot, not period-scoped. (Fetched concurrently above.)
      outstandingInvoiceCount = openInvoices.length;
      outstandingPayments = openInvoices.reduce((sum, inv) => sum + (inv.amount_remaining ?? 0), 0) / 100;
    }

    // ─── Proposal metrics (shared across sections) ────────────────────────────
    // Fetch with dates so we can build daily series
    const [
      outstandingRows,
      mgmtLostRows,
      projLostRows,
      projPaidRows,
      openProposalRows,
    ] = await Promise.all([
      db().select({ totalAmount: proposals.totalAmount }).from(proposals)
        .where(inArray(proposals.status, ["sent", "signed", "partial"])),
      db().select({ totalAmount: proposals.totalAmount, lostAt: proposals.lostAt }).from(proposals)
        .where(and(eq(proposals.type, "management"), isNotNull(proposals.lostAt), gte(proposals.lostAt, start), lt(proposals.lostAt, end))),
      db().select({ totalAmount: proposals.totalAmount, lostAt: proposals.lostAt }).from(proposals)
        .where(and(eq(proposals.type, "project"), isNotNull(proposals.lostAt), gte(proposals.lostAt, start), lt(proposals.lostAt, end))),
      // Won projects (deposit OR full payment received), keyed on signed date, counted at
      // full value — matches the newProjectValue config (partials were previously missed).
      db().select({ totalAmount: proposals.totalAmount, signedAt: proposals.signedAt }).from(proposals)
        .where(and(eq(proposals.type, "project"), inArray(proposals.status, ["paid", "partial"]), isNotNull(proposals.signedAt), gte(proposals.signedAt, start), lt(proposals.signedAt, end))),
      // Every SENT proposal (draft has no sentAt), any type — the universe for the
      // as-of "Proposal Value Outstanding" balance, reconstructed in JS below.
      db().select({ type: proposals.type, totalAmount: proposals.totalAmount, sentAt: proposals.sentAt, paidAt: proposals.paidAt, lostAt: proposals.lostAt, status: proposals.status }).from(proposals)
        .where(isNotNull(proposals.sentAt)),
    ]);

    const outstanding = outstandingRows.reduce((sum, r) => sum + r.totalAmount, 0);
    const mgmtProposalValueLost = mgmtLostRows.reduce((sum, r) => sum + r.totalAmount, 0);
    const projProposalValueLost = projLostRows.reduce((sum, r) => sum + r.totalAmount, 0);

    // ─── Proposal Value Outstanding — a BALANCE as of the period end, not a flow ──
    // Value of proposals SENT but not yet paid/lost, photographed on the last day of
    // the window (today, for the current month), so it's comparable month-to-month.
    // Reconstructed from timestamps. Void excluded (no reliable void timestamp; all
    // current voids are legacy test deals). Partials count at full value (not yet paid).
    const asOfDate = new Date(Math.min(end.getTime(), now.getTime()));
    const liveProposals = openProposalRows.filter((r) => r.status !== "void");
    const outstandingAsOf = (type: "management" | "project", d: Date): number => {
      const dm = d.getTime();
      return liveProposals.reduce((sum, r) => {
        if (r.type !== type || !r.sentAt) return sum;
        if (new Date(r.sentAt).getTime() > dm) return sum;               // not sent yet, as of d
        if (r.paidAt && new Date(r.paidAt).getTime() <= dm) return sum;  // already paid by d
        if (r.lostAt && new Date(r.lostAt).getTime() <= dm) return sum;  // already lost by d
        return sum + r.totalAmount;
      }, 0);
    };
    const mgmtProposalValueSent = outstandingAsOf("management", asOfDate);
    const projProposalValueSent = outstandingAsOf("project", asOfDate);

    // New Project Value/Count = project-type proposals marked PAID in our system
    // (overrides the earlier Stripe one-off-invoice definition, per product spec).
    newProjectValue = projPaidRows.reduce((sum, r) => sum + r.totalAmount, 0);
    newProjectCount = projPaidRows.length;

    // Build daily series for proposal metrics
    const sparkDays = eachDayOfInterval({ start, end: new Date(Math.min(end.getTime(), Date.now())) }).slice(0, 31);
    function buildDailySeries(rows: { totalAmount: number; sentAt?: Date | null; lostAt?: Date | null; paidAt?: Date | null; signedAt?: Date | null }[], dateField: "sentAt" | "lostAt" | "paidAt" | "signedAt") {
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

    // Outstanding is a balance: each point is the balance AS OF the end of that day (capped at now).
    const outstandingSeries = (type: "management" | "project") =>
      sparkDays.map((day) => ({
        date: format(day, "MMM d"),
        value: outstandingAsOf(type, new Date(Math.min(endOfDay(day).getTime(), asOfDate.getTime()))),
      }));
    const mgmtSentSeries = outstandingSeries("management");
    const projSentSeries = outstandingSeries("project");
    const projPaidSeries = buildDailySeries(projPaidRows, "signedAt");

    // ─── Expenses (software costs + manual expenses) ──────────────────────────
    const [softwareCostRows, manualExpenseRows] = await Promise.all([
      db().select({ monthlyCost: softwareCosts.monthlyCost }).from(softwareCosts)
        .where(eq(softwareCosts.active, true)),
      db().select({ amount: manualExpenses.amount }).from(manualExpenses)
        .where(eq(manualExpenses.month, periodMonth)),
    ]);

    const softwareCostTotal = softwareCostRows.reduce((sum, r) => sum + r.monthlyCost, 0);
    const manualExpenseTotal = manualExpenseRows.reduce((sum, r) => sum + r.amount, 0);

    // ─── Team salaries — monthly total pro-rated by % of the month elapsed in this window ──
    const teamSalaryRows = await db().select({ monthlyAmount: teamSalaries.monthlyAmount }).from(teamSalaries).where(eq(teamSalaries.active, true));
    const teamSalaryMonthly = teamSalaryRows.reduce((sum, r) => sum + r.monthlyAmount, 0);
    const dayMs = 86400000;
    const daysInStartMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
    const endOfTodayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + dayMs;
    const windowEnd = Math.min(end.getTime(), endOfTodayUtc); // never count future days
    const elapsedDays = Math.max(0, Math.round((windowEnd - start.getTime()) / dayMs));
    const teamCostTotal = teamSalaryMonthly * (elapsedDays / daysInStartMonth);

    // ─── Ad spend (total from Meta + TikTok) ─────────────────────────────────
    // Computed before totalExpenses because ad spend is an expense in that total.
    let metaAdSpend = 0;
    const tiktokAdSpend = 0;

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
    // Mirrors the configured `totalExpenses` combine (software + manual + ad spend +
    // Stripe fees + team). Refunds are tracked separately and intentionally excluded.
    const totalExpenses = softwareCostTotal + manualExpenseTotal + processingFees + totalAdSpend + teamCostTotal;
    const netPL = cashCollected - totalExpenses;

    // Total MRR = active Stripe subscriptions only (software is a COST, not recurring revenue).
    mrr = managementMrr;

    // ─── Active Projects ──────────────────────────────────────────────────────
    // A project is ACTIVE the moment its proposal is paid, and stays active until
    // it's MANUALLY marked complete (project_statuses). So active = paid project
    // proposals minus the ones marked complete. No status row = active.
    let activeProjects = 0;
    try {
      const rows = await db()
        .select({ id: proposals.id, pstatus: projectStatuses.status })
        .from(proposals)
        .leftJoin(projectStatuses, eq(projectStatuses.proposalId, proposals.id))
        .where(and(eq(proposals.type, "project"), eq(proposals.status, "paid")));
      activeProjects = rows.filter((r) => (r.pstatus ?? "active") !== "complete").length;
    } catch {
      // fallback to 0
    }

    // ─── Response ─────────────────────────────────────────────────────────────
    const body = {
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
        teamCosts: teamCostTotal,
        teamSalaryMonthly,
        newManagementCount,
        newProjectCount,
        clientChurnCount,
        outstandingInvoiceCount,
      },
    };

    // ─── Configurable-KPI overlay ─────────────────────────────────────────────
    // If an admin has WIRED a KPI on /kpis, its configured value (from the engine)
    // overrides the legacy number for that key. Unconfigured metrics keep the legacy
    // compute — nothing regresses until a KPI is explicitly configured. Non-fatal.
    try {
      const enabled = (await listConfigs()).filter((c) => c.enabled);
      if (enabled.length) {
        const engineVals = await getMetricValues(
          enabled.map((c) => c.metricKey),
          { start, end },
          { isAdmin: true, userId: user.id, stripeSource },
        );
        const overrides: Record<string, number> = {};
        for (const [k, r] of Object.entries(engineVals)) {
          if (r && !r.unconfigured) overrides[k] = r.value;
        }
        // Churned Management MRR is a LAGGING metric: it shows the calendar month immediately BEFORE
        // the one you're viewing (viewing July → June's churn; viewing April → March's), so you can
        // analyse churn month-to-month and never see an incomplete in-progress month. (New MRR stays live.)
        try {
          const prevStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
          const prevEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
          const churnPrev = await getMetricValues(["churnedManagementMrr"], { start: prevStart, end: prevEnd }, { isAdmin: true, userId: user.id, stripeSource });
          const cv = churnPrev.churnedManagementMrr;
          if (cv && !cv.unconfigured) overrides.churnedManagementMrr = cv.value;
        } catch (e) {
          console.error("[kpis/metrics] churn previous-month override failed", e);
        }
        // "Proposal Value Outstanding" is an as-of-period-end BALANCE (see the as-of block above),
        // which the generic engine (a period-range flow sum) can't express. Force our reconstructed
        // balance to win over the engine's current-snapshot for these two keys.
        overrides.mgmtProposalValueSent = mgmtProposalValueSent;
        overrides.projProposalValueSent = projProposalValueSent;
        for (const section of [body.business, body.management, body.project, body.sales] as Record<string, unknown>[]) {
          for (const key of Object.keys(section)) {
            if (key in overrides) section[key] = overrides[key];
          }
        }
        // Flat map of EVERY configured metric → value, so the client can surface
        // configured values for any KPI (incl. funnel + derived) regardless of section.
        (body as Record<string, unknown>).configured = overrides;
      }
    } catch (overlayErr) {
      console.error("[kpis/metrics] config overlay failed", overlayErr);
    }

    return NextResponse.json(body);
  } catch (err) {
    console.error("[GET /api/kpis/metrics]", err);
    return NextResponse.json({ error: "Failed to load metrics" }, { status: 500 });
  }
}
