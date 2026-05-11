import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calls, repTargets } from "@/lib/db/schema";
import { and, eq, gte, lte } from "drizzle-orm";
import { ghl, locationId } from "@/lib/ghl/client";
import type { GHLOpportunity } from "@/lib/ghl/types";
import { startOfMonth, endOfMonth, startOfDay, endOfDay, subDays, format } from "date-fns";

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
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const userId = searchParams.get("userId") ?? "";
  const ghlUserId = searchParams.get("ghlUserId") ?? "";
  const repEmail = searchParams.get("email") ?? "";

  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const weekStart = subDays(todayStart, 6); // 7-day rolling window

  const [targetsRows, callsRows, oppsResult] = await Promise.allSettled([
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
      ? ghl.get<{ opportunities: GHLOpportunity[] }>(
          `/opportunities/search?location_id=${locationId()}&assigned_to=${ghlUserId}&limit=100`
        )
      : Promise.resolve({ opportunities: [] }),
  ]);

  const targets = targetsRows.status === "fulfilled" && targetsRows.value[0]
    ? targetsRows.value[0]
    : { dealsPerMonth: 5, callsPerDay: 15, revenueTarget: 0 };

  const callLogs = callsRows.status === "fulfilled" ? callsRows.value : [];
  const opps: GHLOpportunity[] = oppsResult.status === "fulfilled"
    ? oppsResult.value.opportunities ?? []
    : [];

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
  });
}
