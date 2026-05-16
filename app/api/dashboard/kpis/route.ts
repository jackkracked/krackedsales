import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calls, softwareCosts, proposals } from "@/lib/db/schema";
import { and, eq, gte, lte, count } from "drizzle-orm";
import { ghl, locationId } from "@/lib/ghl/client";
import type { GHLOpportunity } from "@/lib/ghl/types";
import {
  startOfDay, endOfDay,
  startOfWeek, endOfWeek,
  startOfMonth, endOfMonth,
  subMonths, subWeeks, subDays,
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

export interface KpiMetricResult {
  value: number;
  prev: number;
  target?: number;
  /** When the metric is not period-aware, we show the monthly period note */
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

  // Fetch GHL opportunities once (shared across multiple metric computations)
  const needsGhl = keys.some((k) =>
    ["cash", "leads", "deals_won", "revenue_won", "pipeline_count", "pipeline_value", "pipeline_value_admin"].includes(k)
  );

  const [oppsResult, allAdminOppsResult] = await Promise.allSettled([
    needsGhl && ghlUserId
      ? ghl.get<{ opportunities: GHLOpportunity[] }>(
          `/opportunities/search?location_id=${locationId()}&assigned_to=${ghlUserId}&limit=100`
        )
      : Promise.resolve({ opportunities: [] }),
    needsGhl && role === "admin"
      ? ghl.get<{ opportunities: GHLOpportunity[] }>(
          `/opportunities/search?location_id=${locationId()}&limit=100`
        )
      : Promise.resolve({ opportunities: [] }),
  ]);

  const repOpps: GHLOpportunity[] =
    oppsResult.status === "fulfilled" ? oppsResult.value.opportunities ?? [] : [];
  const adminOpps: GHLOpportunity[] =
    allAdminOppsResult.status === "fulfilled" ? allAdminOppsResult.value.opportunities ?? [] : [];

  const metrics: Record<string, KpiMetricResult> = {};

  for (const key of keys) {
    const def = getKpiDef(key);
    if (!def) continue;

    // For non-period-aware metrics, use monthly ranges regardless of toggle
    const effectiveStart = def.periodAware ? start : monthStart;
    const effectiveEnd = def.periodAware ? end : monthEnd;
    const effectivePrevStart = def.periodAware ? prevStart : prevMonthStart;
    const effectivePrevEnd = def.periodAware ? prevEnd : prevMonthEnd;
    const periodNote = !def.periodAware && period !== "month" ? "monthly" : undefined;

    try {
      switch (key) {
        // ── Admin: Cash Collected ──────────────────────────────────────────
        case "cash": {
          const wonInPeriod = adminOpps.filter((o) => {
            if (o.status !== "won") return false;
            const d = new Date(o.updatedAt);
            return d >= effectiveStart && d <= effectiveEnd;
          });
          const wonInPrev = adminOpps.filter((o) => {
            if (o.status !== "won") return false;
            const d = new Date(o.updatedAt);
            return d >= effectivePrevStart && d <= effectivePrevEnd;
          });
          metrics[key] = {
            value: wonInPeriod.reduce((s, o) => s + (o.monetaryValue ?? 0), 0),
            prev: wonInPrev.reduce((s, o) => s + (o.monetaryValue ?? 0), 0),
            periodNote,
          };
          break;
        }

        // ── Admin: New Leads ───────────────────────────────────────────────
        case "leads": {
          const inPeriod = adminOpps.filter((o) => {
            const d = new Date(o.createdAt);
            return d >= effectiveStart && d <= effectiveEnd;
          });
          const inPrev = adminOpps.filter((o) => {
            const d = new Date(o.createdAt);
            return d >= effectivePrevStart && d <= effectivePrevEnd;
          });
          metrics[key] = { value: inPeriod.length, prev: inPrev.length, periodNote };
          break;
        }

        // ── Admin: Calls Logged ────────────────────────────────────────────
        case "calls_admin": {
          const [curr, prev] = await Promise.all([
            db().select({ c: count() }).from(calls)
              .where(and(gte(calls.startedAt, effectiveStart), lte(calls.startedAt, effectiveEnd))),
            db().select({ c: count() }).from(calls)
              .where(and(gte(calls.startedAt, effectivePrevStart), lte(calls.startedAt, effectivePrevEnd))),
          ]);
          metrics[key] = { value: Number(curr[0]?.c ?? 0), prev: Number(prev[0]?.c ?? 0), periodNote };
          break;
        }

        // ── Admin: Proposals Sent ──────────────────────────────────────────
        case "proposals_sent": {
          const [curr, prev] = await Promise.all([
            db().select({ c: count() }).from(proposals)
              .where(and(eq(proposals.status, "sent"), gte(proposals.sentAt, effectiveStart), lte(proposals.sentAt, effectiveEnd))),
            db().select({ c: count() }).from(proposals)
              .where(and(eq(proposals.status, "sent"), gte(proposals.sentAt, effectivePrevStart), lte(proposals.sentAt, effectivePrevEnd))),
          ]);
          metrics[key] = { value: Number(curr[0]?.c ?? 0), prev: Number(prev[0]?.c ?? 0), periodNote };
          break;
        }

        // ── Admin: ROAS (monthly only, from offer metrics) ─────────────────
        case "roas": {
          try {
            const res = await fetch(
              `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/kpis/offer?period=${
                new Date().toISOString().slice(0, 7)
              }`,
              { cache: "no-store" }
            );
            if (res.ok) {
              const data = await res.json();
              metrics[key] = { value: data.roas ?? 0, prev: 0, periodNote: "monthly" };
            } else {
              metrics[key] = { value: 0, prev: 0, periodNote: "monthly" };
            }
          } catch {
            metrics[key] = { value: 0, prev: 0, periodNote: "monthly" };
          }
          break;
        }

        // ── Admin: MRR (from Stripe subscriptions) ─────────────────────────
        case "mrr": {
          try {
            const thisMonth = new Date().toISOString().slice(0, 7);
            const prevMonth = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 7);
            const [currRes, prevRes] = await Promise.all([
              fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/kpis/business?period=${thisMonth}`, { cache: "no-store" }),
              fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/kpis/business?period=${prevMonth}`, { cache: "no-store" }),
            ]);
            const curr = currRes.ok ? await currRes.json() : {};
            const prev = prevRes.ok ? await prevRes.json() : {};
            metrics[key] = { value: curr.mrr ?? 0, prev: prev.mrr ?? 0, periodNote: "monthly" };
          } catch {
            metrics[key] = { value: 0, prev: 0, periodNote: "monthly" };
          }
          break;
        }

        // ── Admin: Ad Spend (monthly only) ────────────────────────────────
        case "ad_spend": {
          try {
            const thisMonth = new Date().toISOString().slice(0, 7);
            const res = await fetch(
              `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/kpis/offer?period=${thisMonth}`,
              { cache: "no-store" }
            );
            const data = res.ok ? await res.json() : {};
            metrics[key] = { value: data.adSpend ?? 0, prev: 0, periodNote: "monthly" };
          } catch {
            metrics[key] = { value: 0, prev: 0, periodNote: "monthly" };
          }
          break;
        }

        // ── Admin: Pipeline Value ──────────────────────────────────────────
        case "pipeline_value_admin": {
          const openOpps = adminOpps.filter((o) => o.status === "open");
          metrics[key] = {
            value: openOpps.reduce((s, o) => s + (o.monetaryValue ?? 0), 0),
            prev: 0,
          };
          break;
        }

        // ── Admin: Software Spend ──────────────────────────────────────────
        case "software_spend": {
          const rows = await db()
            .select({ monthlyCost: softwareCosts.monthlyCost })
            .from(softwareCosts)
            .where(eq(softwareCosts.active, true));
          const total = rows.reduce((s, r) => s + r.monthlyCost, 0);
          metrics[key] = { value: total, prev: total, periodNote: "monthly" };
          break;
        }

        // ── Rep: Deals Won ─────────────────────────────────────────────────
        case "deals_won": {
          const won = repOpps.filter((o) => {
            if (o.status !== "won") return false;
            const d = new Date(o.updatedAt);
            return d >= effectiveStart && d <= effectiveEnd;
          });
          const prevWon = repOpps.filter((o) => {
            if (o.status !== "won") return false;
            const d = new Date(o.updatedAt);
            return d >= effectivePrevStart && d <= effectivePrevEnd;
          });
          // Target only meaningful for month period
          let target: number | undefined;
          if (period === "month" && userId) {
            try {
              const { repTargets } = await import("@/lib/db/schema");
              const rows = await db()
                .select({ dealsPerMonth: repTargets.dealsPerMonth })
                .from(repTargets)
                .where(eq(repTargets.userId, userId))
                .limit(1);
              target = rows[0]?.dealsPerMonth;
            } catch { /* no target */ }
          }
          metrics[key] = { value: won.length, prev: prevWon.length, target, periodNote };
          break;
        }

        // ── Rep: Calls ────────────────────────────────────────────────────
        case "calls_rep": {
          if (!repEmail) { metrics[key] = { value: 0, prev: 0 }; break; }
          const [curr, prev] = await Promise.all([
            db().select({ c: count() }).from(calls)
              .where(and(eq(calls.repEmail, repEmail), gte(calls.startedAt, effectiveStart), lte(calls.startedAt, effectiveEnd))),
            db().select({ c: count() }).from(calls)
              .where(and(eq(calls.repEmail, repEmail), gte(calls.startedAt, effectivePrevStart), lte(calls.startedAt, effectivePrevEnd))),
          ]);
          const value = Number(curr[0]?.c ?? 0);
          const prevVal = Number(prev[0]?.c ?? 0);

          // Build target based on period
          let target: number | undefined;
          if (userId) {
            try {
              const { repTargets } = await import("@/lib/db/schema");
              const rows = await db()
                .select({ callsPerDay: repTargets.callsPerDay })
                .from(repTargets)
                .where(eq(repTargets.userId, userId))
                .limit(1);
              if (rows[0]) {
                const cpd = rows[0].callsPerDay;
                if (period === "day") target = cpd;
                else if (period === "week") target = cpd * 5;
                else target = cpd * 22;
              }
            } catch { /* no target */ }
          }
          metrics[key] = { value, prev: prevVal, target, periodNote };
          break;
        }

        // ── Rep: Commission ───────────────────────────────────────────────
        case "commission": {
          if (!userId) { metrics[key] = { value: 0, prev: 0 }; break; }
          try {
            const params = new URLSearchParams({ userId, email: repEmail });
            if (ghlUserId) params.set("ghlUserId", ghlUserId);
            const res = await fetch(
              `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/kpi/rep-metrics?${params}`,
              { cache: "no-store" }
            );
            const data = res.ok ? await res.json() : {};
            // Map period to commission field
            const value =
              period === "day" ? (data.commissionThisMonth / 30) :
              period === "week" ? data.commissionThisWeek :
              data.commissionThisMonth;
            metrics[key] = { value: Math.round(value * 100) / 100, prev: 0 };
          } catch {
            metrics[key] = { value: 0, prev: 0 };
          }
          break;
        }

        // ── Rep: Revenue Won ──────────────────────────────────────────────
        case "revenue_won": {
          const won = repOpps.filter((o) => {
            if (o.status !== "won") return false;
            const d = new Date(o.updatedAt);
            return d >= effectiveStart && d <= effectiveEnd;
          });
          const prevWon = repOpps.filter((o) => {
            if (o.status !== "won") return false;
            const d = new Date(o.updatedAt);
            return d >= effectivePrevStart && d <= effectivePrevEnd;
          });
          metrics[key] = {
            value: won.reduce((s, o) => s + (o.monetaryValue ?? 0), 0),
            prev: prevWon.reduce((s, o) => s + (o.monetaryValue ?? 0), 0),
            periodNote,
          };
          break;
        }

        // ── Rep: Pipeline Count ───────────────────────────────────────────
        case "pipeline_count": {
          const open = repOpps.filter((o) => o.status === "open");
          metrics[key] = { value: open.length, prev: 0 };
          break;
        }

        // ── Rep: Pipeline Value ───────────────────────────────────────────
        case "pipeline_value": {
          const open = repOpps.filter((o) => o.status === "open");
          metrics[key] = {
            value: open.reduce((s, o) => s + (o.monetaryValue ?? 0), 0),
            prev: 0,
          };
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
