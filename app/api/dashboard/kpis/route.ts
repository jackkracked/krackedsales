import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  calls, softwareCosts, proposals, proposalInstalments,
  repTargets, users, commissionSettings,
} from "@/lib/db/schema";
import { and, eq, gte, lte, count, isNotNull } from "drizzle-orm";
import { ghl, locationId } from "@/lib/ghl/client";
import type { GHLOpportunity } from "@/lib/ghl/types";
import {
  startOfDay, endOfDay,
  startOfWeek, endOfWeek,
  startOfMonth, endOfMonth,
  addDays,
  subMonths, subWeeks, subDays,
  format,
} from "date-fns";
import { getKpiDef } from "@/lib/dashboard-kpis";

export const dynamic = "force-dynamic";

type Period = "day" | "week" | "month";

function getPeriodRange(period: Period, now: Date): { start: Date; end: Date } {
  if (period === "day") return { start: startOfDay(now), end: endOfDay(now) };
  if (period === "week") return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
  return { start: startOfMonth(now), end: endOfMonth(now) };
}

function getPrevRange(period: Period, now: Date): { start: Date; end: Date } {
  if (period === "day") {
    const prev = subDays(now, 1);
    return { start: startOfDay(prev), end: endOfDay(prev) };
  }
  if (period === "week") {
    const prev = subWeeks(now, 1);
    return { start: startOfWeek(prev, { weekStartsOn: 1 }), end: endOfWeek(prev, { weekStartsOn: 1 }) };
  }
  const prev = subMonths(now, 1);
  return { start: startOfMonth(prev), end: endOfMonth(prev) };
}

/**
 * Fetch ALL GHL opportunities for a query base, paginating past the 100-item limit.
 */
async function fetchAllGhlOpps(queryBase: string): Promise<GHLOpportunity[]> {
  const all: GHLOpportunity[] = [];
  try {
    const first = await ghl.get<{
      opportunities: GHLOpportunity[];
      meta?: { total?: number };
    }>(`${queryBase}&limit=100&page=1`);

    all.push(...(first.opportunities ?? []));

    const total = first.meta?.total ?? first.opportunities?.length ?? 0;
    const pages = Math.ceil(total / 100);

    if (pages > 1) {
      const rest = await Promise.all(
        Array.from({ length: pages - 1 }, (_, i) =>
          ghl.get<{ opportunities: GHLOpportunity[] }>(`${queryBase}&limit=100&page=${i + 2}`)
        )
      );
      for (const page of rest) all.push(...(page.opportunities ?? []));
    }
  } catch (err) {
    console.error("[dashboard/kpis] GHL fetch failed:", err);
  }
  return all;
}

/**
 * Compute commission earned by a rep for a specific date range.
 * Uses the same logic as /api/kpi/rep-metrics.
 */
async function computeCommission(
  userId: string,
  commissionPct: number,
  payoutTiming: string,
  periodStart: Date,
  periodEnd: Date
): Promise<number> {
  if (!userId || commissionPct <= 0) return 0;
  let total = 0;

  try {
    if (payoutTiming === "split") {
      const rows = await db()
        .select({ amount: proposalInstalments.amount })
        .from(proposalInstalments)
        .innerJoin(proposals, eq(proposalInstalments.proposalId, proposals.id))
        .where(and(
          eq(proposals.createdBy, userId),
          isNotNull(proposalInstalments.paidAt),
          gte(proposalInstalments.paidAt, periodStart),
          lte(proposalInstalments.paidAt, periodEnd)
        ));
      for (const r of rows) total += r.amount * commissionPct / 100;

      const singles = await db()
        .select({ totalAmount: proposals.totalAmount })
        .from(proposals)
        .where(and(
          eq(proposals.createdBy, userId),
          eq(proposals.paymentStructure, "single"),
          isNotNull(proposals.paidAt),
          gte(proposals.paidAt, periodStart),
          lte(proposals.paidAt, periodEnd)
        ));
      for (const p of singles) total += p.totalAmount * commissionPct / 100;

    } else if (payoutTiming === "first_instalment") {
      const rows = await db()
        .select({ totalAmount: proposals.totalAmount })
        .from(proposalInstalments)
        .innerJoin(proposals, eq(proposalInstalments.proposalId, proposals.id))
        .where(and(
          eq(proposals.createdBy, userId),
          eq(proposalInstalments.instalmentNumber, 1),
          isNotNull(proposalInstalments.paidAt),
          gte(proposalInstalments.paidAt, periodStart),
          lte(proposalInstalments.paidAt, periodEnd)
        ));
      for (const r of rows) total += r.totalAmount * commissionPct / 100;

      const singles = await db()
        .select({ totalAmount: proposals.totalAmount })
        .from(proposals)
        .where(and(
          eq(proposals.createdBy, userId),
          eq(proposals.paymentStructure, "single"),
          isNotNull(proposals.paidAt),
          gte(proposals.paidAt, periodStart),
          lte(proposals.paidAt, periodEnd)
        ));
      for (const p of singles) total += p.totalAmount * commissionPct / 100;

    } else {
      // full_paid
      const rows = await db()
        .select({ totalAmount: proposals.totalAmount })
        .from(proposals)
        .where(and(
          eq(proposals.createdBy, userId),
          isNotNull(proposals.paidAt),
          gte(proposals.paidAt, periodStart),
          lte(proposals.paidAt, periodEnd)
        ));
      for (const p of rows) total += p.totalAmount * commissionPct / 100;
    }
  } catch (err) {
    console.error("[dashboard/kpis] Commission calculation failed:", err);
  }

  return Math.round(total * 100) / 100;
}

export interface KpiMetricResult {
  value: number;
  prev: number;
  target?: number;
  periodNote?: string;
}

/**
 * GET /api/dashboard/kpis
 *
 * Query params:
 *   period    = "day" | "week" | "month"  (default: "month")
 *   keys[]    = metric keys to compute
 *   userId    = user ID (for rep-specific metrics)
 *   ghlUserId = GHL user ID (for rep pipeline)
 *   email     = rep email (for rep call queries)
 *   role      = "admin" | "rep"
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const origin = new URL(req.url).origin;
  const period = (searchParams.get("period") ?? "month") as Period;
  const keys = searchParams.getAll("keys[]");
  const userId = searchParams.get("userId") ?? "";
  const ghlUserId = searchParams.get("ghlUserId") ?? "";
  const repEmail = searchParams.get("email") ?? "";
  const role = (searchParams.get("role") ?? "admin") as "admin" | "rep";

  if (!keys.length) return NextResponse.json({ metrics: {} });

  const now = new Date();
  const { start, end } = getPeriodRange(period, now);
  const { start: prevStart, end: prevEnd } = getPrevRange(period, now);
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const prevMonthStart = startOfMonth(subMonths(now, 1));
  const prevMonthEnd = endOfMonth(subMonths(now, 1));

  const thisMonth = format(now, "yyyy-MM");
  const prevMonth = format(subMonths(now, 1), "yyyy-MM");

  // ── Prefetch GHL opportunities (paginated) ───────────────────────────────
  // cash now comes from Stripe (business endpoint), not GHL
  const needsAdminOpps = role === "admin" && keys.some((k) => ["leads", "pipeline_value_admin"].includes(k));
  const needsRepOpps = keys.some((k) => ["deals_won", "revenue_won", "pipeline_count", "pipeline_value"].includes(k));
  const locId = locationId();

  const [adminOpps, repOpps] = await Promise.all([
    needsAdminOpps
      ? fetchAllGhlOpps(`/opportunities/search?location_id=${locId}`)
      : Promise.resolve([] as GHLOpportunity[]),
    needsRepOpps && ghlUserId
      ? fetchAllGhlOpps(`/opportunities/search?location_id=${locId}&assigned_to=${ghlUserId}`)
      : Promise.resolve([] as GHLOpportunity[]),
  ]);

  // ── Prefetch rep targets + commission settings ───────────────────────────
  const needsRepTargets = keys.some((k) => ["deals_won", "calls_rep"].includes(k));
  const needsCommission = keys.includes("commission");

  const [repTargetRows, commissionRows, repUserRows] = await Promise.all([
    needsRepTargets && userId
      ? db().select().from(repTargets).where(eq(repTargets.userId, userId)).limit(1)
      : Promise.resolve([]),
    needsCommission
      ? db().select({ payoutTiming: commissionSettings.payoutTiming }).from(commissionSettings).limit(1)
      : Promise.resolve([]),
    needsCommission && userId
      ? db().select({ commissionPct: users.commissionPct }).from(users).where(eq(users.id, userId)).limit(1)
      : Promise.resolve([]),
  ]);

  const repTarget = repTargetRows[0] ?? null;
  const payoutTiming = commissionRows[0]?.payoutTiming ?? "full_paid";
  const commissionPct = repUserRows[0]?.commissionPct ?? 0;

  // ── Prefetch offer + business data once if needed ────────────────────────
  // These reuse the existing /api/kpis/* routes which already have correct logic.
  // We use the request's own origin — guaranteed correct in all environments.
  const needsOffer = keys.some((k) => ["roas", "ad_spend"].includes(k));
  // business endpoint needed for: mrr, cash (Stripe), and roas (Stripe cash / Meta spend)
  const needsBiz = keys.some((k) => ["mrr", "cash", "roas"].includes(k));

  type OfferData = { adSpend?: number };
  type BizData = { mrr?: number; cashCollected?: number };

  const fetchJson = <T>(url: string): Promise<T> =>
    fetch(url, { cache: "no-store" }).then((r) => r.ok ? r.json() as Promise<T> : ({} as T)).catch(() => ({} as T));

  // Business endpoint uses exclusive end date (?start=inclusive&end=exclusive)
  const bizStart = format(startOfDay(start), "yyyy-MM-dd");
  const bizEnd   = format(addDays(startOfDay(end), 1), "yyyy-MM-dd");
  const bizPrevStart = format(startOfDay(prevStart), "yyyy-MM-dd");
  const bizPrevEnd   = format(addDays(startOfDay(prevEnd), 1), "yyyy-MM-dd");

  const [offerData, prevOfferData, bizData, prevBizData] = await Promise.all([
    needsOffer  ? fetchJson<OfferData>(`${origin}/api/kpis/offer?period=${thisMonth}`)                             : Promise.resolve({} as OfferData),
    needsOffer  ? fetchJson<OfferData>(`${origin}/api/kpis/offer?period=${prevMonth}`)                             : Promise.resolve({} as OfferData),
    needsBiz    ? fetchJson<BizData>(`${origin}/api/kpis/business?start=${bizStart}&end=${bizEnd}`)                : Promise.resolve({} as BizData),
    needsBiz    ? fetchJson<BizData>(`${origin}/api/kpis/business?start=${bizPrevStart}&end=${bizPrevEnd}`)        : Promise.resolve({} as BizData),
  ]);

  // ── Compute each metric ──────────────────────────────────────────────────
  const metrics: Record<string, KpiMetricResult> = {};

  for (const key of keys) {
    const def = getKpiDef(key);
    if (!def) continue;

    const effectiveStart = def.periodAware ? start : monthStart;
    const effectiveEnd = def.periodAware ? end : monthEnd;
    const effectivePrevStart = def.periodAware ? prevStart : prevMonthStart;
    const effectivePrevEnd = def.periodAware ? prevEnd : prevMonthEnd;
    const periodNote = !def.periodAware && period !== "month" ? "monthly" : undefined;

    try {
      switch (key) {

        // ── Admin: Cash Collected (Stripe paid invoices via business endpoint) ─
        case "cash": {
          metrics[key] = {
            value: bizData.cashCollected ?? 0,
            prev: prevBizData.cashCollected ?? 0,
            periodNote,
          };
          break;
        }

        // ── Admin: New Leads (GHL new opportunities) ─────────────────────────
        case "leads": {
          const filter = (o: GHLOpportunity, s: Date, e: Date) =>
            new Date(o.createdAt) >= s && new Date(o.createdAt) <= e;
          metrics[key] = {
            value: adminOpps.filter((o) => filter(o, effectiveStart, effectiveEnd)).length,
            prev: adminOpps.filter((o) => filter(o, effectivePrevStart, effectivePrevEnd)).length,
            periodNote,
          };
          break;
        }

        // ── Admin: Calls Logged (DB) ─────────────────────────────────────────
        case "calls_admin": {
          const [curr, prev] = await Promise.all([
            db().select({ c: count() }).from(calls).where(and(gte(calls.startedAt, effectiveStart), lte(calls.startedAt, effectiveEnd))),
            db().select({ c: count() }).from(calls).where(and(gte(calls.startedAt, effectivePrevStart), lte(calls.startedAt, effectivePrevEnd))),
          ]);
          metrics[key] = { value: Number(curr[0]?.c ?? 0), prev: Number(prev[0]?.c ?? 0), periodNote };
          break;
        }

        // ── Admin: Proposals Sent (DB) ───────────────────────────────────────
        case "proposals_sent": {
          const [curr, prev] = await Promise.all([
            db().select({ c: count() }).from(proposals).where(and(eq(proposals.status, "sent"), gte(proposals.sentAt, effectiveStart), lte(proposals.sentAt, effectiveEnd))),
            db().select({ c: count() }).from(proposals).where(and(eq(proposals.status, "sent"), gte(proposals.sentAt, effectivePrevStart), lte(proposals.sentAt, effectivePrevEnd))),
          ]);
          metrics[key] = { value: Number(curr[0]?.c ?? 0), prev: Number(prev[0]?.c ?? 0), periodNote };
          break;
        }

        // ── Admin: ROAS — Stripe cash collected / Meta ad spend ─────────────
        case "roas": {
          const cash = bizData.cashCollected ?? 0;
          const spend = offerData.adSpend ?? 0;
          const prevCash = prevBizData.cashCollected ?? 0;
          const prevSpend = prevOfferData.adSpend ?? 0;
          metrics[key] = {
            value: spend > 0 ? Math.round((cash / spend) * 100) / 100 : 0,
            prev: prevSpend > 0 ? Math.round((prevCash / prevSpend) * 100) / 100 : 0,
            periodNote: "monthly",
          };
          break;
        }

        // ── Admin: Ad Spend — reuses /api/kpis/offer ────────────────────────
        case "ad_spend": {
          metrics[key] = {
            value: offerData.adSpend ?? 0,
            prev: prevOfferData.adSpend ?? 0,
            periodNote: "monthly",
          };
          break;
        }

        // ── Admin: MRR — reuses /api/kpis/business (same logic as KPIs page)
        case "mrr": {
          metrics[key] = {
            value: bizData.mrr ?? 0,
            prev: prevBizData.mrr ?? 0,
            periodNote: "monthly",
          };
          break;
        }

        // ── Admin: Pipeline Value (GHL open opps) ────────────────────────────
        case "pipeline_value_admin": {
          const open = adminOpps.filter((o) => o.status === "open");
          metrics[key] = { value: open.reduce((s, o) => s + (o.monetaryValue ?? 0), 0), prev: 0 };
          break;
        }

        // ── Admin: Software Spend (DB) ───────────────────────────────────────
        case "software_spend": {
          const rows = await db().select({ monthlyCost: softwareCosts.monthlyCost }).from(softwareCosts).where(eq(softwareCosts.active, true));
          const total = rows.reduce((s, r) => s + r.monthlyCost, 0);
          metrics[key] = { value: total, prev: total, periodNote: "monthly" };
          break;
        }

        // ── Rep: Deals Won (GHL, vs monthly target) ──────────────────────────
        case "deals_won": {
          const filter = (o: GHLOpportunity, s: Date, e: Date) =>
            o.status === "won" && new Date(o.updatedAt) >= s && new Date(o.updatedAt) <= e;
          const target = period === "month" ? (repTarget?.dealsPerMonth ?? undefined) : undefined;
          metrics[key] = {
            value: repOpps.filter((o) => filter(o, effectiveStart, effectiveEnd)).length,
            prev: repOpps.filter((o) => filter(o, effectivePrevStart, effectivePrevEnd)).length,
            target,
            periodNote,
          };
          break;
        }

        // ── Rep: Calls (DB, vs period-scaled target) ─────────────────────────
        case "calls_rep": {
          if (!repEmail) { metrics[key] = { value: 0, prev: 0 }; break; }
          const [curr, prev] = await Promise.all([
            db().select({ c: count() }).from(calls).where(and(eq(calls.repEmail, repEmail), gte(calls.startedAt, effectiveStart), lte(calls.startedAt, effectiveEnd))),
            db().select({ c: count() }).from(calls).where(and(eq(calls.repEmail, repEmail), gte(calls.startedAt, effectivePrevStart), lte(calls.startedAt, effectivePrevEnd))),
          ]);
          const cpd = repTarget?.callsPerDay ?? 0;
          const target = cpd > 0
            ? period === "day" ? cpd : period === "week" ? cpd * 5 : cpd * 22
            : undefined;
          metrics[key] = { value: Number(curr[0]?.c ?? 0), prev: Number(prev[0]?.c ?? 0), target, periodNote };
          break;
        }

        // ── Rep: Commission (DB, accurate by period) ─────────────────────────
        case "commission": {
          if (!userId || commissionPct <= 0) { metrics[key] = { value: 0, prev: 0 }; break; }
          const [curr, prev] = await Promise.all([
            computeCommission(userId, commissionPct, payoutTiming, effectiveStart, effectiveEnd),
            computeCommission(userId, commissionPct, payoutTiming, effectivePrevStart, effectivePrevEnd),
          ]);
          metrics[key] = { value: curr, prev };
          break;
        }

        // ── Rep: Revenue Won (GHL) ───────────────────────────────────────────
        case "revenue_won": {
          const filter = (o: GHLOpportunity, s: Date, e: Date) =>
            o.status === "won" && new Date(o.updatedAt) >= s && new Date(o.updatedAt) <= e;
          const sum = (opps: GHLOpportunity[]) => opps.reduce((t, o) => t + (o.monetaryValue ?? 0), 0);
          metrics[key] = {
            value: sum(repOpps.filter((o) => filter(o, effectiveStart, effectiveEnd))),
            prev: sum(repOpps.filter((o) => filter(o, effectivePrevStart, effectivePrevEnd))),
            periodNote,
          };
          break;
        }

        // ── Rep: Pipeline Count (GHL open opps) ─────────────────────────────
        case "pipeline_count": {
          metrics[key] = { value: repOpps.filter((o) => o.status === "open").length, prev: 0 };
          break;
        }

        // ── Rep: Pipeline Value (GHL open opps) ─────────────────────────────
        case "pipeline_value": {
          const open = repOpps.filter((o) => o.status === "open");
          metrics[key] = { value: open.reduce((s, o) => s + (o.monetaryValue ?? 0), 0), prev: 0 };
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.error(`[dashboard/kpis] Failed to compute ${key}:`, err);
      metrics[key] = { value: 0, prev: 0 };
    }
  }

  return NextResponse.json({ metrics });
}
