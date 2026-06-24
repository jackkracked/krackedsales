import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, calls, proposals } from "@/lib/db/schema";
import { and, eq, gte, lte, count, sum, isNotNull } from "drizzle-orm";
import { ghl, locationId } from "@/lib/ghl/client";
import type { GHLOpportunity } from "@/lib/ghl/types";
import {
  startOfDay, endOfDay,
  startOfWeek, endOfWeek,
  startOfMonth, endOfMonth,
  subDays,
} from "date-fns";

export const dynamic = "force-dynamic";

type TimeRange = "today" | "week" | "month" | "30d" | "90d" | "all";

function getRange(range: TimeRange): { start: Date | null; end: Date } {
  const now = new Date();
  const end = endOfDay(now);
  switch (range) {
    case "today":  return { start: startOfDay(now), end };
    case "week":   return { start: startOfWeek(now, { weekStartsOn: 1 }), end };
    case "month":  return { start: startOfMonth(now), end };
    case "30d":    return { start: subDays(now, 30), end };
    case "90d":    return { start: subDays(now, 90), end };
    case "all":    return { start: null, end };
  }
}

/**
 * GET /api/dashboard/rep-performance?range=week
 * GET /api/dashboard/rep-performance?start=2025-01-01&end=2025-02-01
 *
 * Returns per-rep leaderboard data: calls, demos (ClickUp), proposals sent,
 * deals closed, and open leads.
 * Accepts either a `range` preset or explicit `start`/`end` (YYYY-MM-DD, end exclusive).
 */
export async function GET(req: NextRequest) {
  const startParam = req.nextUrl.searchParams.get("start");
  const endParam = req.nextUrl.searchParams.get("end");

  let start: Date | null;
  let end: Date;

  if (startParam && endParam) {
    // Explicit date range — `end` is exclusive (start of next day)
    start = new Date(startParam + "T00:00:00");
    end = new Date(endParam + "T00:00:00");
  } else {
    const range = (req.nextUrl.searchParams.get("range") ?? "week") as TimeRange;
    ({ start, end } = getRange(range));
  }

  // Fetch all active users
  const allUsers = await db()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      ghlUserId: users.ghlUserId,
    })
    .from(users)
    .where(eq(users.isActive, true));

  // Fetch all GHL opportunities once
  const locId = locationId();
  let allOpps: GHLOpportunity[] = [];
  try {
    const res = await ghl.get<{
      opportunities: GHLOpportunity[];
      meta?: { total?: number };
    }>(`/opportunities/search?location_id=${locId}&limit=100&page=1`);
    allOpps = res.opportunities ?? [];

    const total = res.meta?.total ?? allOpps.length;
    if (total > 100) {
      const pages = Math.ceil(total / 100);
      const rest = await Promise.all(
        Array.from({ length: pages - 1 }, (_, i) =>
          ghl.get<{ opportunities: GHLOpportunity[] }>(
            `/opportunities/search?location_id=${locId}&limit=100&page=${i + 2}`
          )
        )
      );
      for (const page of rest) allOpps.push(...(page.opportunities ?? []));
    }
  } catch (err) {
    console.error("[rep-performance] GHL fetch failed:", err);
  }

  // Build per-rep metrics
  const reps = await Promise.all(
    allUsers.map(async (user) => {
      // Calls — count from the DB calls table only (synced meet + dialer calls).
      // We deliberately do NOT also add live calendar events: booked calls are
      // already in the DB as "meet", so adding them double-counted the tally.
      const callWhere = start
        ? and(eq(calls.repEmail, user.email), gte(calls.startedAt, start), lte(calls.startedAt, end))
        : eq(calls.repEmail, user.email);
      const [callRow] = await db().select({ c: count() }).from(calls).where(callWhere);
      const totalCalls = Number(callRow?.c ?? 0);

      // Proposals sent (sentAt within range, created by this user)
      const propSentWhere = start
        ? and(eq(proposals.createdBy, user.id), isNotNull(proposals.sentAt), gte(proposals.sentAt, start), lte(proposals.sentAt, end))
        : and(eq(proposals.createdBy, user.id), isNotNull(proposals.sentAt));
      const [propRow] = await db().select({ c: count() }).from(proposals).where(propSentWhere);

      // Deals closed — proposals THIS REP sent that got paid in the period.
      // Count and $ value come from the same set, so they always agree (and match
      // the commission dashboard). GHL won-opps are intentionally excluded.
      const dealsWhere = start
        ? and(eq(proposals.createdBy, user.id), isNotNull(proposals.paidAt), gte(proposals.paidAt, start), lte(proposals.paidAt, end))
        : and(eq(proposals.createdBy, user.id), isNotNull(proposals.paidAt));
      const [dealRow] = await db()
        .select({ c: count(), v: sum(proposals.totalAmount) })
        .from(proposals)
        .where(dealsWhere);
      const totalClosed = Number(dealRow?.c ?? 0);
      const closedValue = Number(dealRow?.v ?? 0);

      // Open leads (GHL opps assigned to this user, status open)
      const openLeads = user.ghlUserId
        ? allOpps.filter((o) => o.assignedTo === user.ghlUserId && o.status === "open").length
        : 0;

      return {
        id: user.id,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
        calls: totalCalls,
        proposalsSent: Number(propRow?.c ?? 0),
        dealsClosed: totalClosed,
        closedValue,
        openLeads,
      };
    })
  );

  return NextResponse.json({ reps });
}
