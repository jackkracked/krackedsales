import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { softwareCosts, calls } from "@/lib/db/schema";
import { and, eq, gte, lte } from "drizzle-orm";
import { locationId } from "@/lib/ghl/client";
import { fetchAllOpportunities } from "@/lib/ghl/paginate";
import type { GHLOpportunity } from "@/lib/ghl/types";
import { startOfMonth, endOfMonth } from "date-fns";

async function getOpportunities(): Promise<GHLOpportunity[]> {
  // Fetch EVERY opportunity, not just the first 100 — monthly KPI counts
  // (cash, leads) must include the whole account or they undercount.
  return fetchAllOpportunities(`/opportunities/search?location_id=${locationId()}`);
}

/**
 * GET /api/kpi/admin-metrics
 *
 * Returns the four headline KPIs for the admin dashboard:
 * - cash:   revenue from won deals this month (sum of monetaryValue)
 * - spend:  active monthly software costs
 * - calls:  total calls logged this month
 * - leads:  new GHL opportunities created this month
 */
export async function GET() {
  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);

  const [opportunities, softwareRows, callCount] = await Promise.allSettled([
    getOpportunities(),
    db()
      .select({ monthlyCost: softwareCosts.monthlyCost })
      .from(softwareCosts)
      .where(eq(softwareCosts.active, true)),
    db()
      .select({ id: calls.id })
      .from(calls)
      .where(
        and(
          gte(calls.startedAt, monthStart),
          lte(calls.startedAt, monthEnd)
        )
      ),
  ]);

  const opps = opportunities.status === "fulfilled" ? opportunities.value : [];
  const spend = softwareRows.status === "fulfilled"
    ? softwareRows.value.reduce((s, r) => s + r.monthlyCost, 0)
    : 0;
  const callsThisMonth = callCount.status === "fulfilled" ? callCount.value.length : 0;

  // Cash: sum monetaryValue of won deals updated this month
  const cash = opps
    .filter((o) => {
      if (o.status !== "won") return false;
      const updated = new Date(o.updatedAt);
      return updated >= monthStart && updated <= monthEnd;
    })
    .reduce((s, o) => s + (o.monetaryValue ?? 0), 0);

  // Leads: new opportunities created this month
  const leads = opps.filter((o) => {
    const created = new Date(o.createdAt);
    return created >= monthStart && created <= monthEnd;
  }).length;

  // Previous month deltas
  const prevStart = startOfMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const prevEnd = endOfMonth(prevStart);

  const cashPrev = opps
    .filter((o) => {
      if (o.status !== "won") return false;
      const updated = new Date(o.updatedAt);
      return updated >= prevStart && updated <= prevEnd;
    })
    .reduce((s, o) => s + (o.monetaryValue ?? 0), 0);

  const leadsPrev = opps.filter((o) => {
    const created = new Date(o.createdAt);
    return created >= prevStart && created <= prevEnd;
  }).length;

  return NextResponse.json({
    cash,
    cashPrev,
    spend,
    calls: callsThisMonth,
    leads,
    leadsPrev,
  });
}
