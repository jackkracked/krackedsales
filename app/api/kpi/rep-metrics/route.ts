import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calls, repTargets, users, commissionSettings } from "@/lib/db/schema";
import { and, eq, gte, lte } from "drizzle-orm";
import { locationId } from "@/lib/ghl/client";
import { fetchAllOpportunities } from "@/lib/ghl/paginate";
import type { GHLOpportunity } from "@/lib/ghl/types";
import { startOfMonth, endOfMonth, startOfDay, endOfDay, subDays, startOfWeek, startOfYear, addDays, format } from "date-fns";
import { getRepCommissionEvents, commissionInRange, type PayoutTiming } from "@/lib/kpi/rep-proposal-commission";

/**
 * GET /api/kpi/rep-metrics?userId=&ghlUserId=&email=
 *
 * Returns dashboard data scoped to a single rep:
 * - targets:          their monthly goals
 * - dealsWon:         won opps this month assigned to this rep
 * - pipelineOpps:     open opps assigned to this rep
 * - callsToday:       calls today
 * - callsThisWeek:    calls this week
 * - activityBars:     7-day daily call counts (for the bar chart)
 * - commissionPct:    rep's commission percentage
 * - commissionThisWeek / ThisMonth / ThisYear: earned commission amounts
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId") ?? "";
  const ghlUserId = searchParams.get("ghlUserId") ?? "";
  const repEmail = searchParams.get("email") ?? "";

  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const weekStart = subDays(todayStart, 6); // 7-day rolling window
  const commissionWeekStart = startOfWeek(now, { weekStartsOn: 1 }); // Mon-based week
  const commissionYearStart = startOfYear(now);

  const [targetsRows, callsRows, oppsResult, repRow, commissionRow] = await Promise.allSettled([
    userId
      ? db()
          .select()
          .from(repTargets)
          .where(eq(repTargets.userId, userId))
          .limit(1)
      : Promise.resolve([]),
    repEmail
      ? db()
          .select({ startedAt: calls.startedAt })
          .from(calls)
          .where(
            and(
              eq(calls.repEmail, repEmail),
              gte(calls.startedAt, weekStart),
              lte(calls.startedAt, todayEnd)
            )
          )
      : Promise.resolve([]),
    ghlUserId
      ? fetchAllOpportunities(
          `/opportunities/search?location_id=${locationId()}&assigned_to=${ghlUserId}`
        )
      : Promise.resolve([] as GHLOpportunity[]),
    userId
      ? db()
          .select({ commissionPct: users.commissionPct })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1)
      : Promise.resolve([]),
    db().select({ payoutTiming: commissionSettings.payoutTiming }).from(commissionSettings).limit(1),
  ]);

  const targets = targetsRows.status === "fulfilled" && targetsRows.value[0]
    ? targetsRows.value[0]
    : { dealsPerMonth: 5, callsPerDay: 15, revenueTarget: 0 };

  const callLogs = callsRows.status === "fulfilled" ? callsRows.value : [];
  const opps: GHLOpportunity[] = oppsResult.status === "fulfilled"
    ? oppsResult.value ?? []
    : [];

  const commissionPct = repRow.status === "fulfilled" && repRow.value[0]
    ? (repRow.value[0].commissionPct ?? 0)
    : 0;

  const payoutTiming = commissionRow.status === "fulfilled" && commissionRow.value[0]
    ? commissionRow.value[0].payoutTiming
    : "full_paid";

  // Deals won this month (for quota ring)
  const dealsWon = opps.filter((o) => {
    if (o.status !== "won") return false;
    const updated = new Date(o.updatedAt);
    return updated >= monthStart && updated <= monthEnd;
  });

  const revenueWon = dealsWon.reduce((s, o) => s + (o.monetaryValue ?? 0), 0);

  // Open pipeline opps
  const pipelineOpps = opps.filter((o) => o.status === "open");

  // Calls today
  const callsToday = callLogs.filter((c) => c.startedAt >= todayStart && c.startedAt <= todayEnd).length;

  // 7-day activity bars — calls per day
  const activityBars: { date: string; calls: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = subDays(now, i);
    const dayStart = startOfDay(day);
    const dayEnd = endOfDay(day);
    const count = callLogs.filter((c) => c.startedAt >= dayStart && c.startedAt <= dayEnd).length;
    activityBars.push({ date: format(day, "EEE"), calls: count });
  }

  // ─── Commission calculation ───────────────────────────────────────────────
  // Uses the SHARED proposal-commission helper over UTC-parsed period ranges —
  // identical to what the click-through breakdown drawer shows, so the cards and
  // their drawers can never disagree (incl. at week/month/year boundaries).
  let commissionThisWeek = 0;
  let commissionThisMonth = 0;
  let commissionThisYear = 0;

  if (userId && commissionPct > 0) {
    try {
      // Match the drawer's ranges exactly: local calendar day → UTC midnight.
      const utc = (d: Date) => new Date(format(d, "yyyy-MM-dd") + "T00:00:00.000Z");
      const weekStartU = utc(commissionWeekStart);
      const monthStartU = utc(monthStart);
      const yearStartU = utc(commissionYearStart);
      const endU = utc(addDays(todayStart, 1)); // exclusive: through end of today

      const events = await getRepCommissionEvents({
        userId,
        commissionPct,
        payoutTiming: payoutTiming as PayoutTiming,
      });
      commissionThisWeek = commissionInRange(events, weekStartU, endU);
      commissionThisMonth = commissionInRange(events, monthStartU, endU);
      commissionThisYear = commissionInRange(events, yearStartU, endU);
    } catch (e) {
      console.error("[rep-metrics] Commission calculation failed:", e);
    }
  }

  return NextResponse.json({
    targets,
    dealsWon: dealsWon.length,
    revenueWon,
    pipelineOpps: pipelineOpps.slice(0, 20).map((o) => ({
      id: o.id,
      name: o.name,
      contactName: o.contact?.name ?? "",
      monetaryValue: o.monetaryValue ?? 0,
      status: o.status,
      pipelineStageId: o.pipelineStageId,
      updatedAt: o.updatedAt,
    })),
    callsToday,
    activityBars,
    commissionPct,
    commissionThisWeek,
    commissionThisMonth,
    commissionThisYear,
  });
}
