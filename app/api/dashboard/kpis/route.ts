import { NextRequest, NextResponse } from "next/server";
import { listConfigs, getMetricValues } from "@/lib/kpi/engine";
import { db } from "@/lib/db";
import {
  calls, softwareCosts, proposals, proposalInstalments,
  repTargets, users, commissionSettings,
} from "@/lib/db/schema";
import { and, eq, gte, lt, count, isNotNull } from "drizzle-orm";
import { ghl, locationId } from "@/lib/ghl/client";
import type { GHLOpportunity } from "@/lib/ghl/types";
import {
  startOfMonth, addDays, subDays, differenceInCalendarDays, format,
} from "date-fns";
import { getKpiDef } from "@/lib/dashboard-kpis";
import { kpiHealthLog } from "@/lib/db/schema";
import { KPI_DEFINITIONS } from "@/lib/kpi-health/definitions";
import { getAdaptiveBuckets, bucketCount, bucketSum } from "@/lib/kpi/buckets";
import { getRepCommissionEvents, commissionInRange, type CommissionEvent, type PayoutTiming } from "@/lib/kpi/rep-proposal-commission";
import { loadStripeKpiSeries, type StripeKpiSeries } from "@/lib/kpi/stripe-series";
import { loadMetaAdSpend, type MetaAdSpend } from "@/lib/kpi/meta-series";
import { readSnapshotSeries } from "@/lib/kpi/snapshots";
import { readLastGood, writeLastGood } from "@/lib/kpi/last-good";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Parse a YYYY-MM-DD string as a UTC midnight Date. */
function parseYMD(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s + "T00:00:00.000Z");
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Fetch ALL GHL opportunities for a query base, paginating past the 100-item limit.
 */
async function fetchAllGhlOpps(queryBase: string): Promise<GHLOpportunity[]> {
  const all: GHLOpportunity[] = [];
  try {
    const first = await ghl.get<{ opportunities: GHLOpportunity[]; meta?: { total?: number } }>(
      `${queryBase}&limit=100&page=1`,
    );
    all.push(...(first.opportunities ?? []));
    const total = first.meta?.total ?? first.opportunities?.length ?? 0;
    const pages = Math.ceil(total / 100);
    if (pages > 1) {
      const rest = await Promise.all(
        Array.from({ length: pages - 1 }, (_, i) =>
          ghl.get<{ opportunities: GHLOpportunity[] }>(`${queryBase}&limit=100&page=${i + 2}`),
        ),
      );
      for (const page of rest) all.push(...(page.opportunities ?? []));
    }
  } catch (err) {
    console.error("[dashboard/kpis] GHL fetch failed:", err);
  }
  return all;
}

export interface KpiMetricResult {
  value: number;
  prev: number;
  target?: number;
  series?: number[];
  /** Snapshot metrics only: e.g. "as of Jun 4" — signals a point-in-time level. */
  asOfLabel?: string;
  /** "stale" = served from last-good cache because the source failed this refresh. */
  status?: "ok" | "stale";
}

/**
 * GET /api/dashboard/kpis
 *
 * Query params:
 *   start, end = YYYY-MM-DD (end exclusive) — the selected date range
 *   preset     = optional preset key (e.g. "mtd") used for target semantics
 *   keys[]     = metric keys to compute
 *   userId / ghlUserId / email = rep scoping
 *   role       = "admin" | "rep"
 *
 * Every metric is computed over [start, end). Comparison ("prev") is the
 * immediately-preceding equal-length window. Trend series use adaptive buckets
 * clamped to now (so the current period never trails off into future zeros).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const keys = searchParams.getAll("keys[]");
  const userId = searchParams.get("userId") ?? "";
  const ghlUserId = searchParams.get("ghlUserId") ?? "";
  const repEmail = searchParams.get("email") ?? "";
  const role = (searchParams.get("role") ?? "admin") as "admin" | "rep";
  const preset = searchParams.get("preset") ?? "";

  if (!keys.length) return NextResponse.json({ metrics: {} });

  const now = new Date();

  // ── Resolve the selected range (fallback: current month-to-date) ───────────
  let start = parseYMD(searchParams.get("start"));
  let end = parseYMD(searchParams.get("end"));
  if (!start || !end || start >= end) {
    start = startOfMonth(now);
    end = addDays(now, 1);
  }

  // Comparison window: the equal-length period immediately before `start`.
  const rangeMs = end.getTime() - start.getTime();
  const prevEnd = start;
  const prevStart = new Date(start.getTime() - rangeMs);

  const buckets = getAdaptiveBuckets(start, end, now);
  const daysInRange = Math.max(1, differenceInCalendarDays(end, start));

  // "As of" instant for snapshot metrics — the latest moment inside the range.
  const asOfInstant = new Date(Math.min(end.getTime(), now.getTime()));
  // Label uses the last *included* calendar day: today if the range is still
  // open, otherwise the day before the exclusive end.
  const lastIncludedDay = now.getTime() < end.getTime() ? now : subDays(end, 1);
  const asOfLabel = `as of ${format(lastIncludedDay, "MMM d")}`;

  // ── Decide which shared sources to load ────────────────────────────────────
  const needsAdminOpps = role === "admin" && keys.some((k) => ["leads", "pipeline_value_admin"].includes(k));
  // Pipeline snapshots still come from GHL; deals/commission/revenue are now proposal-based.
  const needsRepOpps = keys.some((k) => ["pipeline_count", "pipeline_value"].includes(k));
  const needsRepPaidProposals = keys.some((k) => ["deals_won", "revenue_won"].includes(k));
  const needsStripe = keys.some((k) => ["cash", "roas", "mrr"].includes(k));
  const needsMeta = keys.some((k) => ["ad_spend", "roas"].includes(k));
  const needsCallsAdmin = keys.includes("calls_admin");
  const needsCallsRep = keys.includes("calls_rep");
  const needsProposalsAdmin = keys.includes("proposals_sent");
  const needsProposalsRep = keys.includes("proposals_sent_rep");
  const needsRepTargets = keys.some((k) => ["deals_won", "calls_rep"].includes(k));
  const needsCommission = keys.includes("commission");
  const locId = locationId();

  // ── Load everything in parallel ────────────────────────────────────────────
  const [
    adminOpps, repOpps, stripeSeries, metaSpend,
    callAdminRows, callRepRows, propAdminRows, propRepRows,
    repTargetRows, commissionRows, repUserRows, repPaidProposalRows,
  ] = await Promise.all([
    needsAdminOpps ? fetchAllGhlOpps(`/opportunities/search?location_id=${locId}`) : Promise.resolve([] as GHLOpportunity[]),
    needsRepOpps && ghlUserId ? fetchAllGhlOpps(`/opportunities/search?location_id=${locId}&assigned_to=${ghlUserId}`) : Promise.resolve([] as GHLOpportunity[]),
    needsStripe ? loadStripeKpiSeries(prevStart, end) : Promise.resolve(null as StripeKpiSeries | null),
    needsMeta ? loadMetaAdSpend(prevStart, end) : Promise.resolve(null as MetaAdSpend | null),
    needsCallsAdmin
      ? db().select({ startedAt: calls.startedAt }).from(calls).where(and(gte(calls.startedAt, prevStart), lt(calls.startedAt, end)))
      : Promise.resolve([] as { startedAt: Date }[]),
    needsCallsRep && repEmail
      ? db().select({ startedAt: calls.startedAt }).from(calls).where(and(eq(calls.repEmail, repEmail), gte(calls.startedAt, prevStart), lt(calls.startedAt, end)))
      : Promise.resolve([] as { startedAt: Date }[]),
    needsProposalsAdmin
      ? db().select({ sentAt: proposals.sentAt }).from(proposals).where(and(eq(proposals.status, "sent"), isNotNull(proposals.sentAt), gte(proposals.sentAt, prevStart), lt(proposals.sentAt, end)))
      : Promise.resolve([] as { sentAt: Date | null }[]),
    needsProposalsRep && userId
      ? db().select({ sentAt: proposals.sentAt }).from(proposals).where(and(eq(proposals.status, "sent"), eq(proposals.createdBy, userId), isNotNull(proposals.sentAt), gte(proposals.sentAt, prevStart), lt(proposals.sentAt, end)))
      : Promise.resolve([] as { sentAt: Date | null }[]),
    needsRepTargets && userId
      ? db().select().from(repTargets).where(eq(repTargets.userId, userId)).limit(1)
      : Promise.resolve([] as (typeof repTargets.$inferSelect)[]),
    needsCommission
      ? db().select({ payoutTiming: commissionSettings.payoutTiming }).from(commissionSettings).limit(1)
      : Promise.resolve([] as { payoutTiming: string }[]),
    needsCommission && userId
      ? db().select({ commissionPct: users.commissionPct }).from(users).where(eq(users.id, userId)).limit(1)
      : Promise.resolve([] as { commissionPct: number | null }[]),
    // Rep's own paid proposals (Deals Closed + Revenue Won) — scoped to proposals they sent.
    needsRepPaidProposals && userId
      ? db().select({ totalAmount: proposals.totalAmount, paidAt: proposals.paidAt })
          .from(proposals)
          .where(and(eq(proposals.createdBy, userId), isNotNull(proposals.paidAt), gte(proposals.paidAt, prevStart), lt(proposals.paidAt, end)))
      : Promise.resolve([] as { totalAmount: number; paidAt: Date | null }[]),
  ]);

  const repTarget = repTargetRows[0] ?? null;
  const commissionPct = repUserRows[0]?.commissionPct ?? 0;
  const payoutTiming = (commissionRows[0]?.payoutTiming as PayoutTiming) ?? "full_paid";

  // Proposal-based commission events for this rep (payout-timing aware) — the
  // SAME source the breakdown drawer uses, so card and drawer always agree.
  let commissionEvents: CommissionEvent[] = [];
  if (needsCommission && userId && commissionPct > 0) {
    commissionEvents = await getRepCommissionEvents({ userId, commissionPct, payoutTiming });
  }

  // ── Helpers shared across metrics ──────────────────────────────────────────
  const inRange = (d: Date | string | null | undefined, s: Date, e: Date): boolean => {
    if (!d) return false;
    const t = new Date(d).getTime();
    return t >= s.getTime() && t < e.getTime();
  };
  const countOppsCreated = (opps: GHLOpportunity[], s: Date, e: Date) =>
    opps.filter((o) => inRange(o.createdAt, s, e)).length;

  // ── Compute each metric ────────────────────────────────────────────────────
  const metrics: Record<string, KpiMetricResult> = {};

  for (const key of keys) {
    const def = getKpiDef(key);
    if (!def) continue;

    try {
      switch (key) {

        // ── Admin: Cash Collected (Stripe charges) ─────────────────────────────
        case "cash": {
          metrics[key] = {
            value: stripeSeries?.cashInRange(start, end) ?? 0,
            prev: stripeSeries?.cashInRange(prevStart, prevEnd) ?? 0,
            series: stripeSeries?.cashByBuckets(buckets),
          };
          break;
        }

        // ── Admin: New Leads (GHL opportunities created) ───────────────────────
        case "leads": {
          metrics[key] = {
            value: countOppsCreated(adminOpps, start, end),
            prev: countOppsCreated(adminOpps, prevStart, prevEnd),
            series: bucketCount(adminOpps, (o) => o.createdAt, buckets),
          };
          break;
        }

        // ── Admin: Calls Logged (DB) ───────────────────────────────────────────
        case "calls_admin": {
          metrics[key] = {
            value: callAdminRows.filter((r) => inRange(r.startedAt, start, end)).length,
            prev: callAdminRows.filter((r) => inRange(r.startedAt, prevStart, prevEnd)).length,
            series: bucketCount(callAdminRows, (r) => r.startedAt, buckets),
          };
          break;
        }

        // ── Admin: Proposals Sent (DB) ─────────────────────────────────────────
        case "proposals_sent": {
          metrics[key] = {
            value: propAdminRows.filter((r) => inRange(r.sentAt, start, end)).length,
            prev: propAdminRows.filter((r) => inRange(r.sentAt, prevStart, prevEnd)).length,
            series: bucketCount(propAdminRows, (r) => r.sentAt, buckets),
          };
          break;
        }

        // ── Rep: Proposals Sent (scoped) ───────────────────────────────────────
        case "proposals_sent_rep": {
          metrics[key] = {
            value: propRepRows.filter((r) => inRange(r.sentAt, start, end)).length,
            prev: propRepRows.filter((r) => inRange(r.sentAt, prevStart, prevEnd)).length,
            series: bucketCount(propRepRows, (r) => r.sentAt, buckets),
          };
          break;
        }

        // ── Admin: ROAS — cash collected ÷ ad spend over the range ─────────────
        case "roas": {
          const cashCur = stripeSeries?.cashInRange(start, end) ?? 0;
          const spendCur = metaSpend?.spendInRange(start, end) ?? 0;
          const cashPrev = stripeSeries?.cashInRange(prevStart, prevEnd) ?? 0;
          const spendPrev = metaSpend?.spendInRange(prevStart, prevEnd) ?? 0;
          const cashSeries = stripeSeries?.cashByBuckets(buckets) ?? buckets.map(() => 0);
          const spendSeries = metaSpend?.spendByBuckets(buckets) ?? buckets.map(() => 0);
          // Cumulative ROAS per bucket — running cash ÷ running spend. Daily ROAS
          // is wildly noisy (one big charge on a low-spend day reads as 1000x), so
          // the trend shows how the period's blended ROAS settles over time.
          let cumCash = 0;
          let cumSpend = 0;
          const roasSeries = buckets.map((_, i) => {
            cumCash += cashSeries[i] ?? 0;
            cumSpend += spendSeries[i] ?? 0;
            return cumSpend > 0 ? Math.round((cumCash / cumSpend) * 100) / 100 : 0;
          });
          metrics[key] = {
            value: spendCur > 0 ? Math.round((cashCur / spendCur) * 100) / 100 : 0,
            prev: spendPrev > 0 ? Math.round((cashPrev / spendPrev) * 100) / 100 : 0,
            series: roasSeries,
          };
          break;
        }

        // ── Admin: Ad Spend (Meta) ─────────────────────────────────────────────
        case "ad_spend": {
          metrics[key] = {
            value: metaSpend?.spendInRange(start, end) ?? 0,
            prev: metaSpend?.spendInRange(prevStart, prevEnd) ?? 0,
            series: metaSpend?.spendByBuckets(buckets),
          };
          break;
        }

        // ── Admin: MRR — reconstructed as-of the range end (snapshot) ──────────
        case "mrr": {
          metrics[key] = {
            value: stripeSeries?.mrrAsOf(asOfInstant) ?? 0,
            prev: stripeSeries?.mrrAsOf(prevEnd) ?? 0,
            series: stripeSeries?.mrrByBuckets(buckets),
            asOfLabel,
          };
          break;
        }

        // ── Admin: Pipeline Value (GHL open opps now; trend from snapshots) ────
        case "pipeline_value_admin": {
          const current = adminOpps.filter((o) => o.status === "open").reduce((s, o) => s + (o.monetaryValue ?? 0), 0);
          const snap = await readSnapshotSeries("pipeline_value_admin", buckets);
          metrics[key] = {
            value: current,
            prev: snap && snap.length ? snap[0] : 0,
            series: snap ?? undefined,
            asOfLabel,
          };
          break;
        }

        // ── Admin: Software Spend (current monthly config) ─────────────────────
        case "software_spend": {
          const rows = await db().select({ monthlyCost: softwareCosts.monthlyCost }).from(softwareCosts).where(eq(softwareCosts.active, true));
          const total = rows.reduce((s, r) => s + r.monthlyCost, 0);
          metrics[key] = { value: total, prev: total, asOfLabel: "current" };
          break;
        }

        // ── Rep: Deals Closed (proposals they sent that got paid) ──────────────
        case "deals_won": {
          metrics[key] = {
            value: repPaidProposalRows.filter((r) => inRange(r.paidAt, start, end)).length,
            prev: repPaidProposalRows.filter((r) => inRange(r.paidAt, prevStart, prevEnd)).length,
            target: preset === "mtd" ? (repTarget?.dealsPerMonth ?? undefined) : undefined,
            series: bucketCount(repPaidProposalRows, (r) => r.paidAt, buckets),
          };
          break;
        }

        // ── Rep: Calls (DB, target scales to range length) ─────────────────────
        case "calls_rep": {
          const cpd = repTarget?.callsPerDay ?? 0;
          metrics[key] = {
            value: callRepRows.filter((r) => inRange(r.startedAt, start, end)).length,
            prev: callRepRows.filter((r) => inRange(r.startedAt, prevStart, prevEnd)).length,
            target: cpd > 0 ? cpd * daysInRange : undefined,
            series: bucketCount(callRepRows, (r) => r.startedAt, buckets),
          };
          break;
        }

        // ── Rep: Commission (proposal-based, payout-timing aware) ──────────────
        case "commission": {
          metrics[key] = {
            value: Math.round(commissionInRange(commissionEvents, start, end)),
            prev: Math.round(commissionInRange(commissionEvents, prevStart, prevEnd)),
            series: bucketSum(commissionEvents, (e) => e.date, (e) => e.commission, buckets),
          };
          break;
        }

        // ── Rep: Revenue Won (paid proposals they sent) ────────────────────────
        case "revenue_won": {
          const paidValue = (s: Date, e: Date) =>
            repPaidProposalRows.filter((r) => inRange(r.paidAt, s, e)).reduce((t, r) => t + r.totalAmount, 0);
          metrics[key] = {
            value: paidValue(start, end),
            prev: paidValue(prevStart, prevEnd),
            series: bucketSum(repPaidProposalRows, (r) => r.paidAt, (r) => r.totalAmount, buckets),
          };
          break;
        }

        // ── Rep: Pipeline Count (open opps now) ────────────────────────────────
        case "pipeline_count": {
          metrics[key] = {
            value: repOpps.filter((o) => o.status === "open").length,
            prev: 0,
            asOfLabel,
          };
          break;
        }

        // ── Rep: Pipeline Value (open opps now) ────────────────────────────────
        case "pipeline_value": {
          metrics[key] = {
            value: repOpps.filter((o) => o.status === "open").reduce((s, o) => s + (o.monetaryValue ?? 0), 0),
            prev: 0,
            asOfLabel,
          };
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.error(`[dashboard/kpis] Failed to compute ${key}:`, err);
      metrics[key] = { value: 0, prev: 0 };
      db().insert(kpiHealthLog).values({
        metricKey: key,
        value: 0,
        sourceStatus: "error",
        errorMessage: err instanceof Error ? err.message : "Unknown error",
        sourceSystem: KPI_DEFINITIONS[key]?.sourceSystem ?? "computed",
      }).catch(() => {});
    }
  }

  // ── Last-good-value fallback (stops the random flash-to-zero) ──────────────
  // If an external source failed this refresh, serve the last successful value
  // for that metric instead of a fake $0; otherwise cache the fresh value. A
  // genuine zero (source succeeded) is cached and shown as 0 — we only fall back
  // when the source actually failed.
  const scopeKey = role === "admin" ? "admin" : `rep:${userId}`;
  const rangeKey = `${start.toISOString()}|${end.toISOString()}|${preset}`;
  const stripeOk = !needsStripe || stripeSeries?.hasData === true;
  const metaOk = !needsMeta || metaSpend?.hasData === true;
  const sourceFailed = (key: string): boolean => {
    if (key === "cash" || key === "mrr") return !stripeOk;
    if (key === "ad_spend") return !metaOk;
    if (key === "roas") return !stripeOk || !metaOk;
    return false; // DB/GHL metrics don't have a clean failure signal yet
  };
  const staleKeys = keys.filter((k) => metrics[k] && sourceFailed(k));
  const healthyKeys = keys.filter((k) => metrics[k] && !sourceFailed(k));
  if (staleKeys.length) {
    const lastGood = await readLastGood(scopeKey, rangeKey, staleKeys);
    for (const k of staleKeys) {
      const lg = lastGood.get(k);
      metrics[k] = lg
        ? { value: lg.value, prev: lg.prev, series: lg.series ?? undefined, asOfLabel: metrics[k].asOfLabel, status: "stale" }
        : { ...metrics[k], status: "stale" };
    }
  }
  for (const k of healthyKeys) metrics[k].status = "ok";
  writeLastGood(
    scopeKey,
    rangeKey,
    healthyKeys.map((k) => ({ key: k, value: metrics[k].value, prev: metrics[k].prev, series: metrics[k].series ?? null })),
  ).catch(() => {});

  // Fire-and-forget: log health status for computed metrics
  try {
    const logEntries = Object.entries(metrics).map(([key, result]) => {
      const def = KPI_DEFINITIONS[key];
      return {
        metricKey: key,
        value: result.value,
        sourceStatus: result.value === 0 && !result.series?.some((v) => v > 0) ? "degraded" as const : "healthy" as const,
        errorMessage: null,
        responseTimeMs: null,
        sourceSystem: def?.sourceSystem ?? "computed",
      };
    });
    if (logEntries.length > 0) {
      db().insert(kpiHealthLog).values(logEntries).catch(() => {});
    }
  } catch {
    // Health logging should never block the response
  }

  // ─── Configurable-KPI overlay ───────────────────────────────────────────────
  // The dashboard reflects /kpis configs: a wired KPI's value flows through here too,
  // so the two surfaces can't disagree. A small map bridges dashboard keys to the
  // /kpis metric keys; matching keys (leads, commission, calls…) pass through 1:1.
  // Unconfigured tiles keep their legacy compute. Non-fatal.
  try {
    const enabled = (await listConfigs()).filter((c) => c.enabled);
    if (enabled.length) {
      const DASH_TO_KPI: Record<string, string> = {
        cash: "cashCollected",
        mrr: "totalMrr",
        ad_spend: "adSpend",
      };
      const engineVals = await getMetricValues(
        enabled.map((c) => c.metricKey),
        { start, end },
        { isAdmin: role === "admin", userId, ghlUserId, repEmail },
      );
      for (const key of Object.keys(metrics)) {
        const r = engineVals[DASH_TO_KPI[key] ?? key];
        if (r && !r.unconfigured) metrics[key] = { ...metrics[key], value: r.value };
      }
    }
  } catch (overlayErr) {
    console.error("[dashboard/kpis] config overlay failed", overlayErr);
  }

  return NextResponse.json({ metrics });
}
