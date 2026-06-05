import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, calls, proposals, repTargets } from "@/lib/db/schema";
import { and, eq, gte, lte, count, isNotNull, sum } from "drizzle-orm";
import {
  startOfWeek, endOfWeek,
  startOfMonth, endOfMonth,
} from "date-fns";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

interface GoalBar {
  label: string;
  current: number;
  target: number;
  format: "number" | "currency";
}

/**
 * GET /api/dashboard/goal-progress
 *
 * Returns 4 progress bars: calls/week, deals/month, revenue/month, demos/month.
 * Admin: team aggregates. Rep: personal numbers.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ goals: [] });

  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);

  const isAdmin = user.role === "admin";

  // Fetch all active users + their targets
  const allUsers = await db()
    .select({
      id: users.id,
      email: users.email,
      ghlUserId: users.ghlUserId,
    })
    .from(users)
    .where(eq(users.isActive, true));

  const allTargets = await db().select().from(repTargets);
  const targetMap = new Map(allTargets.map((t) => [t.userId, t]));

  // For rep mode, only look at the current user
  const relevantUsers = isAdmin ? allUsers : allUsers.filter((u) => u.id === user.id);
  const relevantIds = relevantUsers.map((u) => u.id);

  // Aggregate targets
  let totalCallsTarget = 0;
  let totalDealsTarget = 0;
  let totalRevenueTarget = 0;
  let totalDemosTarget = 0;

  for (const u of relevantUsers) {
    const t = targetMap.get(u.id);
    totalCallsTarget += (t?.callsPerDay ?? 15) * 5; // weekly
    totalDealsTarget += t?.dealsPerMonth ?? 5;
    totalRevenueTarget += t?.revenueTarget ?? 0;
    totalDemosTarget += t?.demosPerMonth ?? 8;
  }

  // Calls this week (all relevant users)
  let totalCalls = 0;
  for (const u of relevantUsers) {
    const [row] = await db()
      .select({ c: count() })
      .from(calls)
      .where(and(eq(calls.repEmail, u.email), gte(calls.startedAt, weekStart), lte(calls.startedAt, weekEnd)));
    totalCalls += Number(row?.c ?? 0);
  }

  // Deals closed this month (proposals with paidAt)
  let totalDeals = 0;
  for (const uid of relevantIds) {
    const [row] = await db()
      .select({ c: count() })
      .from(proposals)
      .where(and(eq(proposals.createdBy, uid), isNotNull(proposals.paidAt), gte(proposals.paidAt, monthStart), lte(proposals.paidAt, monthEnd)));
    totalDeals += Number(row?.c ?? 0);
  }

  // Revenue this month (sum of totalAmount where paidAt in month)
  let totalRevenue = 0;
  for (const uid of relevantIds) {
    const [row] = await db()
      .select({ s: sum(proposals.totalAmount) })
      .from(proposals)
      .where(and(eq(proposals.createdBy, uid), isNotNull(proposals.paidAt), gte(proposals.paidAt, monthStart), lte(proposals.paidAt, monthEnd)));
    totalRevenue += Number(row?.s ?? 0);
  }

  // Demos this month — fetch from ClickUp
  let totalDemos = 0;
  try {
    const origin = new URL(req.url).origin;
    const params = new URLSearchParams({
      since: monthStart.toISOString().slice(0, 10),
      until: monthEnd.toISOString().slice(0, 10),
    });
    const res = await fetch(`${origin}/api/clickup/demos/list?${params}`, {
      cache: "no-store",
      headers: { Cookie: req.headers.get("cookie") ?? "" },
    });
    if (res.ok) {
      const data = await res.json();
      const tasks: Array<{ assignees: Array<{ email?: string }> }> = data.tasks ?? [];
      if (isAdmin) {
        totalDemos = tasks.length;
      } else {
        totalDemos = tasks.filter((t) =>
          t.assignees?.some((a) => a.email === user.email)
        ).length;
      }
    }
  } catch (err) {
    console.error("[goal-progress] ClickUp fetch failed:", err);
  }

  const goals: GoalBar[] = [
    { label: "Calls this week", current: totalCalls, target: totalCallsTarget, format: "number" },
    { label: "Deals this month", current: totalDeals, target: totalDealsTarget, format: "number" },
    { label: "Revenue this month", current: totalRevenue, target: totalRevenueTarget, format: "currency" },
    { label: "Demos this month", current: totalDemos, target: totalDemosTarget, format: "number" },
  ];

  return NextResponse.json({ goals });
}
