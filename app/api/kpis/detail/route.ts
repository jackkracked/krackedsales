import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, calls, softwareCosts, manualExpenses, users } from "@/lib/db/schema";
import { and, eq, isNotNull, inArray, desc } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { stripe, hasStripe } from "@/lib/stripe/client";
import Stripe from "stripe";
import { ghl, locationId } from "@/lib/ghl/client";
import type { GHLOpportunity } from "@/lib/ghl/types";
import { getMetricEntry, type DetailSource } from "@/lib/kpi/metric-catalog";
import { loadMetaAdSpend } from "@/lib/kpi/meta-series";

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
  const unit = item.price.unit_amount ?? 0;
  const interval = item.price.recurring?.interval ?? "month";
  const count = item.price.recurring?.interval_count ?? 1;
  switch (interval) {
    case "year":  return unit / (12 * count) / 100;
    case "week":  return (unit * 52) / (12 * count) / 100;
    case "day":   return (unit * 365) / (12 * count) / 100;
    default:      return unit / count / 100;
  }
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

    // ── Stripe: past-due open invoices (snapshot) ────────────────────────────
    case "open_invoices_pastdue": {
      if (!hasStripe()) return { unit: "currency", rows: [], periodSum: 0, periodCount: 0 };
      type EI = Stripe.Invoice & { customer: Stripe.Customer | Stripe.DeletedCustomer | string | null };
      const open = await paginateAll<EI>((after) =>
        stripe().invoices.list({ status: "open", expand: ["data.customer"], limit: 100, ...(after ? { starting_after: after } : {}) }) as Promise<{ data: EI[]; has_more: boolean }>,
      );
      const nowUnix = Math.floor(Date.now() / 1000);
      const pastDue = open.filter((inv) => inv.due_date != null && inv.due_date < nowUnix).sort((a, b) => (a.due_date ?? 0) - (b.due_date ?? 0));
      let periodSum = 0;
      const rows = pastDue.map((inv) => {
        const amt = (inv.amount_remaining ?? 0) / 100;
        periodSum += amt;
        const days = inv.due_date ? Math.floor((nowUnix - inv.due_date) / 86400) : 0;
        return { label: customerName(inv.customer), sublabel: `${inv.number ?? inv.id} · ${days}d overdue`, amount: amt, date: inv.due_date ? new Date(inv.due_date * 1000).toISOString() : undefined, inPeriod: true };
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
      subs.sort((a, b) => (b.items.data[0] ? toMonthlyDollars(b.items.data[0]) : 0) - (a.items.data[0] ? toMonthlyDollars(a.items.data[0]) : 0));
      let periodSum = 0;
      const rows = subs.map((s) => {
        const item = s.items.data[0];
        const amt = item ? toMonthlyDollars(item) : 0;
        periodSum += amt;
        return { label: customerName(s.customer), sublabel: item?.price.nickname || "Subscription", amount: amt, date: new Date(s.created * 1000).toISOString(), inPeriod: true };
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
      if (params.scoped && ctx.userId) baseConds.push(eq(proposals.createdBy, ctx.userId));

      if (dateField) {
        // "Sent"/"Lost"/"Paid" are defined by that date field being set (regardless
        // of the proposal's *current* status) — matches how the KPI card counts them.
        const colMap = { sentAt: proposals.sentAt, lostAt: proposals.lostAt, paidAt: proposals.paidAt };
        const col = colMap[dateField];
        const conds = [...baseConds, isNotNull(col)];
        const results = await db().select().from(proposals).where(and(...conds)).orderBy(desc(col)).limit(1000);
        let periodSum = 0, periodCount = 0;
        const rows = results.map((p) => {
          const d = p[dateField];
          const ip = inRange(d ? new Date(d).getTime() : NaN, range);
          if (ip) { periodSum += p.totalAmount; periodCount++; }
          return { label: p.contactName || "Unknown Client", sublabel: p.status, amount: p.totalAmount, date: d ? new Date(d).toISOString() : undefined, inPeriod: ip };
        });
        return { unit: "currency", rows, periodSum, periodCount };
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

    // ── DB: calls ───────────────────────────────────────────────────────────────
    case "calls": {
      const conds = [];
      if (params.scoped && ctx.email) conds.push(eq(calls.repEmail, ctx.email));
      const results = await db().select().from(calls).where(conds.length ? and(...conds) : undefined).orderBy(desc(calls.startedAt)).limit(1000);
      let periodCount = 0;
      const rows = results.map((c) => {
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
          { fields: "spend", time_range: JSON.stringify({ since, until }), time_increment: "1" },
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

    const entry = getMetricEntry(metricKey);
    const range = parseRange(searchParams);
    const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0);
    const u = user as { id?: string; email?: string; ghlUserId?: string | null };
    const ctx = {
      userId: searchParams.get("userId") ?? u.id ?? "",
      email: searchParams.get("email") ?? u.email ?? "",
      ghlUserId: searchParams.get("ghlUserId") ?? u.ghlUserId ?? "",
    };

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
      const [sw, manual, metaSpend] = await Promise.all([
        db().select({ c: softwareCosts.monthlyCost }).from(softwareCosts).where(eq(softwareCosts.active, true)),
        db().select({ a: manualExpenses.amount }).from(manualExpenses).where(eq(manualExpenses.month, `${range.start.getUTCFullYear()}-${String(range.start.getUTCMonth() + 1).padStart(2, "0")}`)),
        loadMetaAdSpend(range.start, range.end),
      ]);
      const swTotal = sw.reduce((s, r) => s + r.c, 0);
      const manualTotal = manual.reduce((s, r) => s + r.a, 0);
      const adSpend = metaSpend.spendInRange(range.start, range.end);
      const breakdown = [
        { label: "Software subscriptions", value: `$${Math.round(swTotal).toLocaleString()}` },
        { label: "Manual expenses", value: `$${Math.round(manualTotal).toLocaleString()}` },
        { label: "Ad spend (Meta)", value: `$${Math.round(adSpend).toLocaleString()}` },
        { label: "Stripe fees + refunds", value: "see Stripe section" },
      ];
      return NextResponse.json({ title: entry.label, explanation: entry.explanation, kind: "breakdown", breakdown, rows: [], periodSum: null, periodCount: 0, unit: "currency", nextOffset: null });
    }

    // List sources: snapshots don't need a range; period-scoped ones do.
    const SNAPSHOT: DetailSource[] = ["open_invoices_pastdue", "subs_active", "software_costs"];
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
