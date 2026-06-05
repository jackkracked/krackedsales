import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calls, repTargets, users, proposals, proposalInstalments, commissionSettings } from "@/lib/db/schema";
import { and, eq, gte, lte, isNotNull } from "drizzle-orm";
import { locationId } from "@/lib/ghl/client";
import { fetchAllOpportunities } from "@/lib/ghl/paginate";
import type { GHLOpportunity } from "@/lib/ghl/types";
import { startOfMonth, endOfMonth, startOfDay, endOfDay, subDays, startOfWeek, startOfYear, format } from "date-fns";

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
  let commissionThisWeek = 0;
  let commissionThisMonth = 0;
  let commissionThisYear = 0;

  if (userId && commissionPct > 0) {
    try {
      if (payoutTiming === "split") {
        // Commission earned as each instalment is paid
        const paidInstalments = await db()
          .select({
            amount: proposalInstalments.amount,
            paidAt: proposalInstalments.paidAt,
          })
          .from(proposalInstalments)
          .innerJoin(proposals, eq(proposalInstalments.proposalId, proposals.id))
          .where(
            and(
              eq(proposals.createdBy, userId),
              isNotNull(proposalInstalments.paidAt),
              gte(proposalInstalments.paidAt, commissionYearStart)
            )
          );

        for (const inst of paidInstalments) {
          const earned = inst.amount * commissionPct / 100;
          if (inst.paidAt! >= commissionWeekStart) commissionThisWeek += earned;
          if (inst.paidAt! >= monthStart) commissionThisMonth += earned;
          commissionThisYear += earned;
        }

        // Also include single/subscription proposals paid this year (no instalments)
        const paidSingleProposals = await db()
          .select({ totalAmount: proposals.totalAmount, paidAt: proposals.paidAt })
          .from(proposals)
          .where(
            and(
              eq(proposals.createdBy, userId),
              eq(proposals.paymentStructure, "single"),
              isNotNull(proposals.paidAt),
              gte(proposals.paidAt, commissionYearStart)
            )
          );

        for (const p of paidSingleProposals) {
          const earned = p.totalAmount * commissionPct / 100;
          if (p.paidAt! >= commissionWeekStart) commissionThisWeek += earned;
          if (p.paidAt! >= monthStart) commissionThisMonth += earned;
          commissionThisYear += earned;
        }

      } else if (payoutTiming === "first_instalment") {
        // Full commission when first instalment is paid (or single payment is made)
        const firstInstalments = await db()
          .select({
            totalAmount: proposals.totalAmount,
            paidAt: proposalInstalments.paidAt,
          })
          .from(proposalInstalments)
          .innerJoin(proposals, eq(proposalInstalments.proposalId, proposals.id))
          .where(
            and(
              eq(proposals.createdBy, userId),
              eq(proposalInstalments.instalmentNumber, 1),
              isNotNull(proposalInstalments.paidAt),
              gte(proposalInstalments.paidAt, commissionYearStart)
            )
          );

        for (const inst of firstInstalments) {
          const earned = inst.totalAmount * commissionPct / 100;
          if (inst.paidAt! >= commissionWeekStart) commissionThisWeek += earned;
          if (inst.paidAt! >= monthStart) commissionThisMonth += earned;
          commissionThisYear += earned;
        }

        // Non-instalment proposals: full commission on paidAt
        const paidNonInstalment = await db()
          .select({ totalAmount: proposals.totalAmount, paidAt: proposals.paidAt })
          .from(proposals)
          .where(
            and(
              eq(proposals.createdBy, userId),
              eq(proposals.paymentStructure, "single"),
              isNotNull(proposals.paidAt),
              gte(proposals.paidAt, commissionYearStart)
            )
          );

        for (const p of paidNonInstalment) {
          const earned = p.totalAmount * commissionPct / 100;
          if (p.paidAt! >= commissionWeekStart) commissionThisWeek += earned;
          if (p.paidAt! >= monthStart) commissionThisMonth += earned;
          commissionThisYear += earned;
        }

      } else {
        // "full_paid" — commission when entire proposal is paid
        const paidProposals = await db()
          .select({ totalAmount: proposals.totalAmount, paidAt: proposals.paidAt })
          .from(proposals)
          .where(
            and(
              eq(proposals.createdBy, userId),
              isNotNull(proposals.paidAt),
              gte(proposals.paidAt, commissionYearStart)
            )
          );

        for (const p of paidProposals) {
          const earned = p.totalAmount * commissionPct / 100;
          if (p.paidAt! >= commissionWeekStart) commissionThisWeek += earned;
          if (p.paidAt! >= monthStart) commissionThisMonth += earned;
          commissionThisYear += earned;
        }
      }
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
