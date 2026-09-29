import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, calls, softwareCosts, manualExpenses, users, projectStatuses, teamSalaries } from "@/lib/db/schema";
import { and, eq, isNotNull, inArray, desc, sql } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { stripe, hasStripe } from "@/lib/stripe/client";
import Stripe from "stripe";
import { ghl, locationId } from "@/lib/ghl/client";
import type { GHLOpportunity } from "@/lib/ghl/types";
import { getMetricEntry, type DetailSource } from "@/lib/kpi/metric-catalog";
import { loadMetaAdSpend } from "@/lib/kpi/meta-series";
import { getRepCommissionEvents, getPayoutTiming, commissionDetailRows } from "@/lib/kpi/rep-proposal-commission";
import { getConfig, getMetricValue } from "@/lib/kpi/engine";
import { isTakenCall } from "@/lib/calls/taken";
import { monthlyAmount } from "@/lib/stripe/cycle";
import { closerSql } from "@/lib/proposals/credit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE_SIZE = 50;

interface DetailRow {
  label: string;
  sublabel?: string;
  amount?: number;
  date?: string;
  inPeriod: boolean;
}

interface SourceResult {
  unit: "currency" | "count";
  /** Full ordered list (newest first). The route slices this into pages. */
  rows: DetailRow[];
  periodSum: number;
  periodCount: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseRange(searchParams: URLSearchParams): { start: Date; end: Date } | null {
  const s = searchParams.get("start");
  const e = searchParams.get("end");
  if (!s || !e) return null;
  const start = new Date(s + "T00:00:00.000Z");
  const end = new Date(e + "T00:00:00.000Z");
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) return null;
  return { start, end };
}

async function paginateAll<T extends { id: string }>(
  fetcher: (startingAfter?: string) => Promise<{ data: T[]; has_more: boolean }>,
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

function customerName(c: string | Stripe.Customer | Stripe.DeletedCustomer | null): string {
  if (!c) return "Unknown";
  if (typeof c === "string") return c;
  if (c.deleted) return (c as Stripe.DeletedCustomer).id;
  return (c as Stripe.Customer).name || (c as Stripe.Customer).email || c.id;
}

function toMonthlyDollars(item: Stripe.SubscriptionItem): number {
  // Shared helper: a 30-day cycle is the monthly retainer, not 1.0139 months. See lib/stripe/cycle.ts.
  return monthlyAmount(item.price.unit_amount, item.price.recurring?.interval, item.price.recurring?.interval_count) / 100;
}

const inRange = (t: number, r: { start: Date; end: Date } | null) =>
  !!r && t >= r.start.getTime() && t < r.end.getTime();

async function fetchAllOpps(scopedGhlUserId?: string): Promise<GHLOpportunity[]> {
  const base = `/opportunities/search?location_id=${locationId()}${scopedGhlUserId ? `&assigned_to=${scopedGhlUserId}` : ""}`;
  const all: GHLOpportunity[] = [];
  // Page until a short page — GHL's v1 search often omits meta.total, so don't
  // trust it (trusting it silently drops everything past page 1).
  for (let page = 1; page <= 50; page++) {
    const res = await ghl.get<{ opportunities: GHLOpportunity[] }>(`${base}&limit=100&page=${page}`);
    const opps = res.opportunities ?? [];
    all.push(...opps);
    if (opps.length < 100) break;
  }
  return all;
}

// ── Source builders ─────────────────────────────────────────────────────────

async function buildSource(
  source: DetailSource,
  params: Record<string, string>,
  range: { start: Date; end: Date } | null,
  ctx: { userId: string; email: string; ghlUserId: string },
): Promise<SourceResult> {
  switch (source) {
    // ── Stripe: succeeded charges (cash) ─────────────────────────────────────
    case "charges_succeeded": {
      if (!hasStripe()) return { unit: "currency", rows: [], periodSum: 0, periodCount: 0 };
      type EC = Stripe.Charge & { customer: Stripe.Customer | Stripe.DeletedCustomer | string | null };
      const charges = await paginateAll<EC>((after) =>
        stripe().charges.list({ expand: ["data.customer"], limit: 100, ...(after ? { starting_after: after } : {}) }) as Promise<{ data: EC[]; has_more: boolean }>,
      );
      const succeeded = charges.filter((c) => c.status === "succeeded").sort((a, b) => b.created - a.created);
      let periodSum = 0, periodCount = 0;
      const rows = succeeded.map((c) => {
        const ip = inRange(c.created * 1000, range);
        if (ip) { periodSum += c.amount / 100; periodCount++; }
        return { label: customerName(c.customer), sublabel: c.description || undefined, amount: c.amount / 100, date: new Date(c.created * 1000).toISOString(), inPeriod: ip };
      });
      return { unit: "currency", rows, periodSum, periodCount };
    }

    // ── Stripe: all open (unpaid) invoices — one-off + subscription (snapshot) ─
    case "open_invoices": {
      if (!hasStripe()) return { unit: "currency", rows: [], periodSum: 0, periodCount: 0 };
      type EI = Stripe.Invoice & { customer: Stripe.Customer | Stripe.DeletedCustomer | string | null };
      const open = await paginateAll<EI>((after) =>
        stripe().invoices.list({ status: "open", expand: ["data.customer"], limit: 100, ...(after ? { starting_after: after } : {}) }) as Promise<{ data: EI[]; has_more: boolean }>,
      );
      const nowUnix = Math.floor(Date.now() / 1000);
      // Most overdue first, then upcoming by soonest due; no-due-date last.
      open.sort((a, b) => (a.due_date ?? Infinity) - (b.due_date ?? Infinity));
      let periodSum = 0;
      const rows = open.map((inv) => {
        const amt = (inv.amount_remaining ?? 0) / 100;
        periodSum += amt;
        const isSub = (inv.billing_reason ?? "").startsWith("subscription");
        const kind = isSub ? "Subscription" : "One-off invoice";
        const days = inv.due_date != null ? Math.floor((nowUnix - inv.due_date) / 86400) : null;
        const when = days == null ? "no due date" : days > 0 ? `${days}d overdue` : days === 0 ? "due today" : `due in ${-days}d`;
        return { label: customerName(inv.customer), sublabel: `${kind} · ${inv.number ?? inv.id} · ${when}`, amount: amt, date: inv.due_date ? new Date(inv.due_date * 1000).toISOString() : undefined, inPeriod: true };
      });
      return { unit: "currency", rows, periodSum, periodCount: rows.length };
    }

    // ── Stripe: active subscriptions (snapshot) ──────────────────────────────
    case "subs_active": {
      if (!hasStripe()) return { unit: "currency", rows: [], periodSum: 0, periodCount: 0 };
      type ES = Stripe.Subscription & { customer: Stripe.Customer | Stripe.DeletedCustomer | string };
      const subs = await paginateAll<ES>((after) =>
        stripe().subscriptions.list({ status: "active", expand: ["data.customer"], limit: 100, ...(after ? { starting_after: after } : {}) }) as Promise<{ data: ES[]; has_more: boolean }>,
      );
      // Correlate to proposals so paid-in-full (auto-renew OFF) clients are labelled —
      // they count in MRR at their monthly run-rate, so the drill-down explains why.
      const subPropIds = [...new Set(subs.map((s) => s.metadata?.proposal_id).filter((x): x is string => !!x))];
      const prepaidMap = new Map<string, Date | null>();
      if (subPropIds.length) {
        const props = await db()
          .select({ id: proposals.id, autoRenew: proposals.autoRenew, endDate: proposals.endDate })
          .from(proposals)
          .where(inArray(proposals.id, subPropIds));
        for (const p of props) if (p.autoRenew === false) prepaidMap.set(p.id, p.endDate);
      }
      subs.sort((a, b) => (b.items.data[0] ? toMonthlyDollars(b.items.data[0]) : 0) - (a.items.data[0] ? toMonthlyDollars(a.items.data[0]) : 0));
      let periodSum = 0;
      const rows = subs.map((s) => {
        const item = s.items.data[0];
        const amt = item ? toMonthlyDollars(item) : 0;
        periodSum += amt;
        const pid = s.metadata?.proposal_id;
        const isPrepaid = pid != null && prepaidMap.has(pid);
        const endDate = isPrepaid ? prepaidMap.get(pid!) : null;
        const sublabel = isPrepaid
          ? `Prepaid term${endDate ? ` · ends ${new Date(endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}` : ""}`
          : item?.price.nickname || "Subscription";
        return { label: customerName(s.customer), sublabel, amount: amt, date: new Date(s.created * 1000).toISOString(), inPeriod: true };
      });
      return { unit: "currency", rows, periodSum, periodCount: rows.length };
    }

    // ── Stripe: new subscriptions in range ───────────────────────────────────
    case "subs_new": {
      if (!hasStripe()) return { unit: "currency", rows: [], periodSum: 0, periodCount: 0 };
      type ES = Stripe.Subscription & { customer: Stripe.Customer | Stripe.DeletedCustomer | string };
      const [active, canceled] = await Promise.all([
        paginateAll<ES>((after) => stripe().subscriptions.list({ status: "active", expand: ["data.customer"], limit: 100, ...(after ? { starting_after: after } : {}) }) as Promise<{ data: ES[]; has_more: boolean }>),
        paginateAll<ES>((after) => stripe().subscriptions.list({ status: "canceled", expand: ["data.customer"], limit: 100, ...(after ? { starting_after: after } : {}) }) as Promise<{ data: ES[]; has_more: boolean }>),
      ]);
      const subs = [...active, ...canceled].sort((a, b) => b.created - a.created);
      let periodSum = 0, periodCount = 0;
      const rows = subs.map((s) => {
        const item = s.items.data[0];
        const amt = item ? toMonthlyDollars(item) : 0;
        const ip = inRange(s.created * 1000, range);
        if (ip) { periodSum += amt; periodCount++; }
        return { label: customerName(s.customer), sublabel: item?.price.nickname || "Subscription", amount: amt, date: new Date(s.created * 1000).toISOString(), inPeriod: ip };
      });
      return { unit: "currency", rows, periodSum, periodCount };
    }

    // ── Stripe: canceled subscriptions (churn) ───────────────────────────────
    case "subs_canceled": {
      if (!hasStripe()) return { unit: "currency", rows: [], periodSum: 0, periodCount: 0 };
      type ES = Stripe.Subscription & { customer: Stripe.Customer | Stripe.DeletedCustomer | string };
      const canceled = await paginateAll<ES>((after) =>
        stripe().subscriptions.list({ status: "canceled", expand: ["data.customer"], limit: 100, ...(after ? { starting_after: after } : {}) }) as Promise<{ data: ES[]; has_more: boolean }>,
      );
      const subs = canceled.filter((s) => s.canceled_at != null).sort((a, b) => (b.canceled_at ?? 0) - (a.canceled_at ?? 0));
      let periodSum = 0, periodCount = 0;
      const rows = subs.map((s) => {
        const item = s.items.data[0];
        const amt = item ? toMonthlyDollars(item) : 0;
        const ip = inRange((s.canceled_at ?? 0) * 1000, range);
        if (ip) { periodSum += amt; periodCount++; }
        return { label: customerName(s.customer), sublabel: item?.price.nickname || "Subscription", amount: amt, date: s.canceled_at ? new Date(s.canceled_at * 1000).toISOString() : undefined, inPeriod: ip };
      });
      return { unit: "currency", rows, periodSum, periodCount };
    }

    // ── Stripe: paid one-off (project) invoices ──────────────────────────────
    case "project_invoices_paid": {
      if (!hasStripe()) return { unit: "currency", rows: [], periodSum: 0, periodCount: 0 };
      type EI = Stripe.Invoice & { customer: Stripe.Customer | Stripe.DeletedCustomer | string | null };
      const paid = await paginateAll<EI>((after) =>
        stripe().invoices.list({ status: "paid", expand: ["data.customer"], limit: 100, ...(after ? { starting_after: after } : {}) }) as Promise<{ data: EI[]; has_more: boolean }>,
      );
      const project = paid.filter((inv) => inv.parent?.type !== "subscription_details").sort((a, b) => b.created - a.created);
      let periodSum = 0, periodCount = 0;
      const rows = project.map((inv) => {
        const amt = (inv.amount_paid ?? 0) / 100;
        const ip = inRange(inv.created * 1000, range);
        if (ip) { periodSum += amt; periodCount++; }
        return { label: customerName(inv.customer), sublabel: inv.description || inv.number || undefined, amount: amt, date: new Date(inv.created * 1000).toISOString(), inPeriod: ip };
      });
      return { unit: "currency", rows, periodSum, periodCount };
    }

    // ── DB: proposals ─────────────────────────────────────────────────────────
    case "proposals": {
      const dateField = params.dateField as "sentAt" | "lostAt" | "paidAt" | undefined;
      const baseConds = [];
      if (params.type) baseConds.push(eq(proposals.type, params.type));
      // The deal's CLOSER, the same person the card above this drawer credits.
      if (params.scoped && ctx.userId) baseConds.push(sql`${closerSql} = ${ctx.userId}`);

      if (dateField) {
        // "Sent"/"Lost"/"Paid" are defined by that date field being set (regardless
        // of the proposal's *current* status) — matches how the KPI card counts them.
        const colMap = { sentAt: proposals.sentAt, lostAt: proposals.lostAt, paidAt: proposals.paidAt };
        const col = colMap[dateField];
        const conds = [...baseConds, isNotNull(col)];
        const results = await db().select().from(proposals).where(and(...conds)).orderBy(desc(col)).limit(1000);
        // asCount: count metric (e.g. Deals Closed) — header shows the count, rows
        // still carry each deal's value for context.
        const asCount = params.asCount === "1";
        let periodSum = 0, periodCount = 0;
        const rows = results.map((p) => {
          const d = p[dateField];
          const ip = inRange(d ? new Date(d).getTime() : NaN, range);
          if (ip) { periodSum += p.totalAmount; periodCount++; }
          return { label: p.contactName || "Unknown Client", sublabel: p.status, amount: p.totalAmount, date: d ? new Date(d).toISOString() : undefined, inPeriod: ip };
        });
        return { unit: asCount ? "count" : "currency", rows, periodSum, periodCount };
      }

      // Snapshot (e.g. Outstanding Proposals) — status-based, not date-scoped.
      if (params.statusIn) baseConds.push(inArray(proposals.status, params.statusIn.split(",")));
      const results = await db().select().from(proposals).where(baseConds.length ? and(...baseConds) : undefined).orderBy(desc(proposals.sentAt)).limit(1000);
      let periodSum = 0;
      const rows = results.map((p) => {
        periodSum += p.totalAmount;
        return { label: p.contactName || "Unknown Client", sublabel: p.status, amount: p.totalAmount, date: p.sentAt ? new Date(p.sentAt).toISOString() : undefined, inPeriod: true };
      });
      return { unit: "currency", rows, periodSum, periodCount: rows.length };
    }

    // ── DB: rep commission (proposal-based, payout-timing aware) ──────────────
    case "rep_commission": {
      if (!ctx.userId || !range) return { unit: "currency", rows: [], periodSum: 0, periodCount: 0 };
      const [u] = await db().select({ pct: users.commissionPct }).from(users).where(eq(users.id, ctx.userId)).limit(1);
      const pct = u?.pct ?? 0;
      const timing = await getPayoutTiming();
      const events = await getRepCommissionEvents({ userId: ctx.userId, commissionPct: pct, payoutTiming: timing });
      const { rows, periodSum, periodCount } = commissionDetailRows(events, range.start, range.end);
      return { unit: "currency", rows, periodSum, periodCount };
    }

    // ── DB: calls ───────────────────────────────────────────────────────────────
    case "calls": {
      const conds = [];
      if (params.scoped && ctx.email) conds.push(eq(calls.repEmail, ctx.email));
      const results = await db().select().from(calls).where(conds.length ? and(...conds) : undefined).orderBy(desc(calls.startedAt)).limit(1000);
      // Only list calls actually taken — never upcoming bookings or missed/unconnected calls.
      const nowMs = Date.now();
      const taken = results.filter((c) => isTakenCall(c, nowMs));
      let periodCount = 0;
      const rows = taken.map((c) => {
        const ip = inRange(new Date(c.startedAt).getTime(), range);
        if (ip) periodCount++;
        return { label: c.contactName || c.repEmail || "Call", sublabel: [c.callType, c.repName].filter(Boolean).join(" · ") || undefined, date: new Date(c.startedAt).toISOString(), inPeriod: ip };
      });
      return { unit: "count", rows, periodSum: 0, periodCount };
    }

    // ── DB: active software costs (snapshot) ─────────────────────────────────
    case "software_costs": {
      const results = await db().select().from(softwareCosts).where(eq(softwareCosts.active, true)).orderBy(desc(softwareCosts.monthlyCost));
      let periodSum = 0;
      const rows = results.map((r) => {
        periodSum += r.monthlyCost;
        return { label: r.name, amount: r.monthlyCost, inPeriod: true };
      });
      return { unit: "currency", rows, periodSum, periodCount: rows.length };
    }

    // ── GHL: opportunities ───────────────────────────────────────────────────
    case "opps": {
      const mode = params.mode ?? "created";
      // Commission applies the rep's rate to each won deal's value.
      const rate = params.rate != null ? Number(params.rate) / 100 : 1;
      const opps = await fetchAllOpps(params.scoped ? ctx.ghlUserId : undefined);
      let periodSum = 0, periodCount = 0;
      let filtered = opps;
      let dateFor: (o: GHLOpportunity) => string | undefined;
      let isCount = false;
      if (mode === "won") {
        filtered = opps.filter((o) => o.status === "won").sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        dateFor = (o) => o.updatedAt;
      } else if (mode === "open") {
        filtered = opps.filter((o) => o.status === "open").sort((a, b) => (b.monetaryValue ?? 0) - (a.monetaryValue ?? 0));
        dateFor = (o) => o.createdAt;
      } else {
        filtered = opps.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        dateFor = (o) => o.createdAt;
        isCount = true; // leads = count metric
      }
      const rows = filtered.map((o) => {
        const d = dateFor(o);
        const ip = mode === "open" ? true : inRange(d ? new Date(d).getTime() : NaN, range);
        const amt = (o.monetaryValue ?? 0) * rate;
        if (ip) { periodSum += amt; periodCount++; }
        return { label: o.name || o.contact?.name || "Opportunity", sublabel: o.pipelineStageId ? undefined : o.status, amount: isCount ? undefined : amt, date: d ? new Date(d).toISOString() : undefined, inPeriod: ip };
      });
      return { unit: isCount ? "count" : "currency", rows, periodSum, periodCount };
    }

    // ── Meta: daily ad spend ───────────────────────────────────────────────────
    case "meta_spend": {
      const adAccountId = process.env.META_AD_ACCOUNT_ID;
      if (!adAccountId || !range) return { unit: "currency", rows: [], periodSum: 0, periodCount: 0 };
      // Pull a wide window (range plus ~6 months of context) for the list.
      const windowStart = new Date(Math.min(range.start.getTime(), Date.now() - 183 * 86400000));
      const since = windowStart.toISOString().slice(0, 10);
      const until = new Date(Math.min(range.end.getTime(), Date.now()) - 86400000).toISOString().slice(0, 10);
      const { meta } = await import("@/lib/meta/client");
      let daily: { date: Date; spend: number }[] = [];
      try {
        const res = await meta.get<{ data: Array<{ spend?: string; date_start?: string }> }>(
          `/${adAccountId}/insights`,
          { fields: "spend", time_range: JSON.stringify({ since, until }), time_increment: "1", limit: "500" },
        );
        daily = (res.data ?? []).filter((d) => d.date_start).map((d) => ({ date: new Date(d.date_start + "T00:00:00.000Z"), spend: parseFloat(d.spend ?? "0") }));
      } catch (e) {
        console.error("[kpis/detail] meta_spend failed:", e);
      }
      daily.sort((a, b) => b.date.getTime() - a.date.getTime());
      let periodSum = 0, periodCount = 0;
      const rows = daily.map((d) => {
        const ip = inRange(d.date.getTime(), range);
        if (ip) { periodSum += d.spend; periodCount++; }
        return { label: d.date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }), amount: d.spend, date: d.date.toISOString(), inPeriod: ip };
      });
      return { unit: "currency", rows, periodSum, periodCount };
    }

    default:
      return { unit: "currency", rows: [], periodSum: 0, periodCount: 0 };
  }
}

// Short-lived in-memory cache so infinite-scroll pages reuse the full fetch
// instead of re-paginating Stripe/GHL on every page request. Keyed by the exact
// inputs; 60s TTL matches the drawer's client-side staleTime.
const _cache = new Map<string, { at: number; val: SourceResult }>();
async function buildSourceCached(
  source: DetailSource,
  params: Record<string, string>,
  range: { start: Date; end: Date } | null,
  ctx: { userId: string; email: string; ghlUserId: string },
): Promise<SourceResult> {
  const key = JSON.stringify({ source, params, start: range?.start ?? null, end: range?.end ?? null, ctx });
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.val;
  const val = await buildSource(source, params, range, ctx);
  _cache.set(key, { at: Date.now(), val });
  if (_cache.size > 50) {
    let oldestKey: string | null = null, oldestAt = Infinity;
    for (const [k, v] of _cache) if (v.at < oldestAt) { oldestAt = v.at; oldestKey = k; }
    if (oldestKey) _cache.delete(oldestKey);
  }
  return val;
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const metricKey = searchParams.get("metric");
    if (!metricKey) return NextResponse.json({ error: "metric param required" }, { status: 400 });

    // Funnel-scoped keys (`offer:{funnelId}:{base}`) borrow the base metric's
    // catalog entry for a friendly title/explanation; the engine still keys the
    // config off the full metricKey below.
    const baseKey = metricKey.startsWith("offer:")
      ? metricKey.split(":").slice(2).join(":")
      : metricKey;
    const entry = getMetricEntry(baseKey);
    let range = parseRange(searchParams);
    // Churn is a lagging metric — its drill-down reflects the calendar month immediately BEFORE the one
    // being viewed (matches the card), so churn can be analysed month-to-month.
    let churnMonthNote: string | null = null;
    if (metricKey === "churnedManagementMrr") {
      const anchor = range?.start ?? new Date(); // the selected month (or now if no range)
      const ps = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 1, 1));
      const pe = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
      range = { start: ps, end: pe };
      churnMonthNote = ps.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    }
    const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0);
    const u = user as { id?: string; email?: string; ghlUserId?: string | null; role?: string };
    // Reps may only ever see their OWN scoped line items — ignore query-param
    // identity for non-admins (prevents reading another rep's deals via ?userId=).
    const isAdmin = u.role === "admin";
    const ctx = {
      userId: (isAdmin ? searchParams.get("userId") ?? u.id : u.id) ?? "",
      email: (isAdmin ? searchParams.get("email") ?? u.email : u.email) ?? "",
      ghlUserId: (isAdmin ? searchParams.get("ghlUserId") ?? u.ghlUserId : u.ghlUserId) ?? "",
    };

    // ─── Active Projects (interactive: mark active/complete) ───────────────────
    // Paid project proposals, each row carrying its status so the drawer can toggle
    // active ↔ complete. Active = not complete; completed rows show muted at the end.
    if (metricKey === "activeProjects") {
      const rows = await db()
        .select({
          id: proposals.id,
          contactName: proposals.contactName,
          amount: proposals.totalAmount,
          paidAt: proposals.paidAt,
          status: projectStatuses.status,
        })
        .from(proposals)
        .leftJoin(projectStatuses, eq(projectStatuses.proposalId, proposals.id))
        .where(and(eq(proposals.type, "project"), eq(proposals.status, "paid")));

      const list = rows
        .map((r) => {
          const status = (r.status ?? "active") as "active" | "complete";
          return {
            id: r.id,
            label: r.contactName || "Project",
            sublabel: status === "complete" ? "Complete" : "Active",
            amount: r.amount,
            status,
            date: r.paidAt ? new Date(r.paidAt).toISOString() : undefined,
            inPeriod: status !== "complete",
          };
        })
        .sort((a, b) => {
          const ac = a.status === "complete" ? 1 : 0;
          const bc = b.status === "complete" ? 1 : 0;
          if (ac !== bc) return ac - bc;
          return (b.amount ?? 0) - (a.amount ?? 0);
        });

      return NextResponse.json({
        title: "Active Projects",
        explanation:
          "Paid project proposals. A project is active the moment it's paid; mark it complete here when the work is done and it drops out of the count.",
        kind: "list",
        editable: "projectStatus",
        rows: list,
        periodSum: null,
        periodCount: list.filter((r) => r.status !== "complete").length,
        unit: "count",
        nextOffset: null,
      });
    }

    // ─── Proposal Value Outstanding (as-of period end + period roll-forward) ────
    // The card is a BALANCE photographed on the last day of the window: value of
    // proposals sent-but-not-paid as of that date. The drill-down lists that balance
    // and shows how it moved this period (opening + sent − paid − lost = closing).
    // Void excluded (no reliable void timestamp; all current voids are legacy tests).
    if (metricKey === "mgmtProposalValueSent" || metricKey === "projProposalValueSent") {
      const dealType = metricKey === "mgmtProposalValueSent" ? "management" : "project";
      const label = dealType === "management" ? "Mgmt Proposal Value Outstanding" : "Project Proposal Value Outstanding";
      const now = new Date();
      const periodStart = range?.start ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const periodEnd = range?.end ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      const asOf = new Date(Math.min(periodEnd.getTime(), now.getTime()));

      const all = await db()
        .select({
          id: proposals.id,
          contactName: proposals.contactName,
          status: proposals.status,
          totalAmount: proposals.totalAmount,
          sentAt: proposals.sentAt,
          paidAt: proposals.paidAt,
          lostAt: proposals.lostAt,
        })
        .from(proposals)
        .where(and(eq(proposals.type, dealType), isNotNull(proposals.sentAt)));

      const live = all.filter((p) => p.status !== "void");
      const outstandingAt = (p: (typeof live)[number], d: Date) => {
        const dm = d.getTime();
        if (!p.sentAt || new Date(p.sentAt).getTime() > dm) return false;
        if (p.paidAt && new Date(p.paidAt).getTime() <= dm) return false;
        if (p.lostAt && new Date(p.lostAt).getTime() <= dm) return false;
        return true;
      };
      const movedInPeriod = (d: Date | null) => {
        if (!d) return false;
        const t = new Date(d).getTime();
        return t > periodStart.getTime() && t <= asOf.getTime();
      };

      const outstandingList = live
        .filter((p) => outstandingAt(p, asOf))
        .sort((a, b) => (b.totalAmount ?? 0) - (a.totalAmount ?? 0))
        .map((p) => ({
          id: p.id,
          label: p.contactName || "Unknown Client",
          sublabel: p.status,
          amount: p.totalAmount,
          date: p.sentAt ? new Date(p.sentAt).toISOString() : undefined,
          inPeriod: true,
        }));

      const closing = outstandingList.reduce((s, r) => s + (r.amount ?? 0), 0);
      const opening = live.filter((p) => outstandingAt(p, periodStart)).reduce((s, p) => s + p.totalAmount, 0);
      const sentIn = live.filter((p) => movedInPeriod(p.sentAt)).reduce((s, p) => s + p.totalAmount, 0);
      const paidIn = live.filter((p) => movedInPeriod(p.paidAt)).reduce((s, p) => s + p.totalAmount, 0);
      const lostIn = live.filter((p) => movedInPeriod(p.lostAt)).reduce((s, p) => s + p.totalAmount, 0);
      const asOfLabel = asOf.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

      return NextResponse.json({
        title: `${label} · as of ${asOfLabel}`,
        explanation: `Value of ${dealType} proposals sent but not yet paid, as it stood on ${asOfLabel}. A proposal counts until it is paid or lost.`,
        kind: "list",
        rollForward: {
          title: "How the balance moved this period",
          rows: [
            { label: "Opening outstanding", amount: opening, tone: "open" },
            { label: "Sent this period", amount: sentIn, tone: "add" },
            { label: "Paid this period", amount: paidIn, tone: "subtract" },
            { label: "Lost this period", amount: lostIn, tone: "subtract" },
            { label: "Closing outstanding", amount: closing, tone: "total" },
          ],
        },
        rows: outstandingList.slice(offset, offset + PAGE_SIZE),
        periodSum: closing,
        periodCount: outstandingList.length,
        totalCount: outstandingList.length,
        unit: "currency",
        nextOffset: offset + PAGE_SIZE < outstandingList.length ? offset + PAGE_SIZE : null,
      });
    }

    // ─── Configurable-KPI overlay ─────────────────────────────────────────────
    // If this metric is WIRED, its drill-down rows come from the engine (the exact
    // records behind the configured number) — the confidence surface. Falls through
    // to the legacy detail path when unconfigured.
    if (range) {
      const cfg = await getConfig(metricKey).catch(() => null);
      if (cfg && cfg.enabled) {
        const mctx = { isAdmin, userId: ctx.userId, ghlUserId: ctx.ghlUserId, repEmail: ctx.email };
        const r = await getMetricValue(metricKey, range, mctx);
        // A combine's own rows are just the term summaries. Recurse into each term so the drill-down
        // shows the underlying RECORDS (the actual clients), which is what the user wants to see.
        let sourceRows = r.rows;
        if (cfg.aggregation.op === "combine") {
          const merged: typeof r.rows = [];
          for (const term of cfg.aggregation.terms) {
            const child = await getConfig(term.metricKey).catch(() => null);
            if (!child || !child.enabled) continue;
            const cr = await getMetricValue(term.metricKey, range, mctx);
            for (const row of cr.rows) merged.push({ ...row, amount: term.sign * (row.amount ?? 0) });
          }
          sourceRows = merged;
        }
        const allRows = sourceRows.map((row) => ({
          label: row.label,
          sublabel: row.sublabel,
          amount: row.amount,
          date: row.date,
          inPeriod: true,
        }));
        const page = allRows.slice(offset, offset + PAGE_SIZE);
        return NextResponse.json({
          title: churnMonthNote ? `${entry?.label ?? metricKey} · ${churnMonthNote}` : (entry?.label ?? metricKey),
          explanation: churnMonthNote ? `Cancellations in ${churnMonthNote} — the last completed month.` : (entry?.explanation ?? "Configured metric."),
          kind: "list",
          rows: page,
          periodSum: r.unit === "currency" ? r.value : null,
          periodCount: allRows.length,
          unit: r.unit === "currency" ? "currency" : "count",
          nextOffset: offset + PAGE_SIZE < allRows.length ? offset + PAGE_SIZE : null,
        });
      }
    }

    // Unknown metric or no catalog entry — return a graceful, explained empty.
    if (!entry) {
      return NextResponse.json({ title: metricKey, explanation: "No description available for this metric yet.", kind: "pending", rows: [], periodSum: null, periodCount: 0, unit: "count", nextOffset: null });
    }

    // Derived metrics, or sources whose line items aren't wired yet → breakdown/explanation only.
    if (entry.pending || !entry.detail) {
      return NextResponse.json({ title: entry.label, explanation: entry.explanation, kind: "pending", rows: [], periodSum: null, periodCount: 0, unit: "count", nextOffset: null });
    }
    if (entry.detail.source === "ratio") {
      const formula = entry.detail.params?.formula ?? "";
      return NextResponse.json({ title: entry.label, explanation: entry.explanation, kind: "breakdown", breakdown: formula ? [{ label: "Formula", value: formula }] : [], rows: [], periodSum: null, periodCount: 0, unit: "ratio", nextOffset: null });
    }
    if (entry.detail.source === "expenses_breakdown") {
      if (!range) return NextResponse.json({ error: "start/end required" }, { status: 400 });
      const [sw, manual, metaSpend, salaries] = await Promise.all([
        db().select({ c: softwareCosts.monthlyCost }).from(softwareCosts).where(eq(softwareCosts.active, true)),
        db().select({ a: manualExpenses.amount }).from(manualExpenses).where(eq(manualExpenses.month, `${range.start.getUTCFullYear()}-${String(range.start.getUTCMonth() + 1).padStart(2, "0")}`)),
        loadMetaAdSpend(range.start, range.end),
        db().select({ m: teamSalaries.monthlyAmount }).from(teamSalaries).where(eq(teamSalaries.active, true)),
      ]);
      const swTotal = sw.reduce((s, r) => s + r.c, 0);
      const manualTotal = manual.reduce((s, r) => s + r.a, 0);
      const adSpend = metaSpend.spendInRange(range.start, range.end);

      // Team salaries — monthly total pro-rated by % of the month elapsed (same math as the metrics route).
      const teamMonthly = salaries.reduce((s, r) => s + r.m, 0);
      const dayMs = 86400000;
      const daysInStartMonth = new Date(Date.UTC(range.start.getUTCFullYear(), range.start.getUTCMonth() + 1, 0)).getUTCDate();
      const nowD = new Date();
      const endOfTodayUtc = Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth(), nowD.getUTCDate()) + dayMs;
      const teamWindowEnd = Math.min(range.end.getTime(), endOfTodayUtc);
      const teamElapsedDays = Math.max(0, Math.round((teamWindowEnd - range.start.getTime()) / dayMs));
      const teamTotal = teamMonthly * (teamElapsedDays / daysInStartMonth);

      // Stripe processing fees (on succeeded charges) + refunds in the period — the
      // actual total, not a pointer. Mirrors the metrics route's computation.
      let stripeFeesRefunds = 0;
      if (hasStripe()) {
        try {
          const s = stripe();
          const startUnix = Math.floor(range.start.getTime() / 1000);
          const endUnix = Math.floor(range.end.getTime() / 1000);
          let fees = 0;
          let after: string | undefined;
          while (true) {
            const page = await s.charges.list({
              created: { gte: startUnix, lt: endUnix },
              expand: ["data.balance_transaction"],
              limit: 100,
              ...(after ? { starting_after: after } : {}),
            });
            for (const c of page.data) {
              const bt = c.balance_transaction;
              if (c.status === "succeeded" && bt && typeof bt !== "string") fees += bt.fee ?? 0;
            }
            if (!page.has_more) break;
            after = page.data[page.data.length - 1].id;
          }
          let refundTotal = 0;
          let rAfter: string | undefined;
          while (true) {
            const page = await s.refunds.list({
              created: { gte: startUnix, lt: endUnix },
              limit: 100,
              ...(rAfter ? { starting_after: rAfter } : {}),
            });
            for (const r of page.data) refundTotal += r.amount;
            if (!page.has_more) break;
            rAfter = page.data[page.data.length - 1].id;
          }
          stripeFeesRefunds = (fees + refundTotal) / 100;
        } catch (e) {
          console.error("[detail/expenses_breakdown] fees fetch failed", e);
        }
      }

      const breakdown = [
        { label: "Team salaries (pro-rated)", value: `$${Math.round(teamTotal).toLocaleString()}` },
        { label: "Software subscriptions", value: `$${Math.round(swTotal).toLocaleString()}` },
        { label: "Manual expenses", value: `$${Math.round(manualTotal).toLocaleString()}` },
        { label: "Ad spend (Meta)", value: `$${Math.round(adSpend).toLocaleString()}` },
        { label: "Stripe fees + refunds", value: `$${Math.round(stripeFeesRefunds).toLocaleString()}` },
      ];
      return NextResponse.json({ title: entry.label, explanation: entry.explanation, kind: "breakdown", breakdown, rows: [], periodSum: null, periodCount: 0, unit: "currency", nextOffset: null });
    }

    // List sources: snapshots don't need a range; period-scoped ones do.
    const SNAPSHOT: DetailSource[] = ["open_invoices", "subs_active", "software_costs"];
    const isSnapshot = SNAPSHOT.includes(entry.detail.source) || (entry.detail.source === "opps" && entry.detail.params?.mode === "open");
    if (!range && !isSnapshot) {
      return NextResponse.json({ error: "start/end params required" }, { status: 400 });
    }

    // Commission applies the rep's personal rate to each won deal's value.
    let detailParams = entry.detail.params ?? {};
    if (metricKey === "commission" && ctx.userId) {
      const [row] = await db().select({ pct: users.commissionPct }).from(users).where(eq(users.id, ctx.userId)).limit(1);
      detailParams = { ...detailParams, rate: String(row?.pct ?? 0) };
    }

    const result = await buildSourceCached(entry.detail.source, detailParams, range, ctx);
    const page = result.rows.slice(offset, offset + PAGE_SIZE);
    const nextOffset = offset + PAGE_SIZE < result.rows.length ? offset + PAGE_SIZE : null;

    return NextResponse.json({
      title: entry.label,
      explanation: entry.explanation,
      kind: "list",
      unit: result.unit,
      periodSum: result.unit === "count" ? null : result.periodSum,
      periodCount: result.periodCount,
      totalCount: result.rows.length,
      isSnapshot,
      rows: page,
      nextOffset,
    });
  } catch (err) {
    console.error("[GET /api/kpis/detail]", err);
    return NextResponse.json({ error: "Failed to load detail" }, { status: 500 });
  }
}
