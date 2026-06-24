import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, calls, proposals } from "@/lib/db/schema";
import { and, eq, gte, lte, isNotNull, desc } from "drizzle-orm";
import { ghl, locationId } from "@/lib/ghl/client";
import type { GHLOpportunity } from "@/lib/ghl/types";
import {
  startOfDay, endOfDay, startOfWeek, startOfMonth, subDays,
} from "date-fns";

export const dynamic = "force-dynamic";

type TimeRange = "today" | "week" | "month" | "30d" | "90d" | "all";

function getRange(range: TimeRange): { start: Date | null; end: Date } {
  const now = new Date();
  const end = endOfDay(now);
  switch (range) {
    case "today": return { start: startOfDay(now), end };
    case "week":  return { start: startOfWeek(now, { weekStartsOn: 1 }), end };
    case "month": return { start: startOfMonth(now), end };
    case "30d":   return { start: subDays(now, 30), end };
    case "90d":   return { start: subDays(now, 90), end };
    case "all":   return { start: null, end };
  }
}

/** One row in the validation list. */
interface DrillItem {
  id: string;
  title: string;            // contact / proposal name
  sub?: string;             // type · direction · status, or amount
  date?: string;            // ISO
  amount?: number;          // for $-based metrics
  href?: string;            // link to open the underlying record
  status?: string;
}

/**
 * GET /api/dashboard/rep-performance/drilldown?userId=&metric=&range= (or start/end)
 *
 * Returns the underlying records behind a rep's leaderboard number, so an admin
 * can validate every metric. metric ∈ calls | proposals | closed | open.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const userId = sp.get("userId") ?? "";
  const metric = sp.get("metric") ?? "";
  const startParam = sp.get("start");
  const endParam = sp.get("end");

  let start: Date | null;
  let end: Date;
  if (startParam && endParam) {
    start = new Date(startParam + "T00:00:00");
    end = new Date(endParam + "T00:00:00");
  } else {
    ({ start, end } = getRange((sp.get("range") ?? "week") as TimeRange));
  }

  const [user] = await db()
    .select({ id: users.id, name: users.name, email: users.email, ghlUserId: users.ghlUserId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return NextResponse.json({ items: [] });

  let items: DrillItem[] = [];

  try {
    if (metric === "calls") {
      const where = start
        ? and(eq(calls.repEmail, user.email), gte(calls.startedAt, start), lte(calls.startedAt, end))
        : eq(calls.repEmail, user.email);
      const rows = await db().select().from(calls).where(where).orderBy(desc(calls.startedAt)).limit(300);
      items = rows.map((c) => ({
        id: c.id,
        title: c.contactName ?? "Unknown contact",
        sub: [
          c.callType === "dialer" ? "Dialer" : "Meet",
          c.direction ? c.direction[0].toUpperCase() + c.direction.slice(1) : null,
          c.status,
        ].filter(Boolean).join(" · "),
        date: c.startedAt.toISOString(),
        status: c.status ?? undefined,
      }));
    } else if (metric === "proposals" || metric === "closed") {
      const dateCol = metric === "closed" ? proposals.paidAt : proposals.sentAt;
      const where = start
        ? and(eq(proposals.createdBy, userId), isNotNull(dateCol), gte(dateCol, start), lte(dateCol, end))
        : and(eq(proposals.createdBy, userId), isNotNull(dateCol));
      const rows = await db().select().from(proposals).where(where).orderBy(desc(dateCol)).limit(300);
      items = rows.map((p) => ({
        id: p.id,
        title: p.contactName,
        sub: p.title,
        date: (metric === "closed" ? p.paidAt : p.sentAt)?.toISOString(),
        amount: p.totalAmount,
        status: p.status,
        href: `/proposals/${p.id}`,
      }));
    } else if (metric === "open") {
      // Open GHL opportunities assigned to this rep.
      if (user.ghlUserId) {
        const locId = locationId();
        const all: GHLOpportunity[] = [];
        const res = await ghl.get<{ opportunities: GHLOpportunity[]; meta?: { total?: number } }>(
          `/opportunities/search?location_id=${locId}&assigned_to=${user.ghlUserId}&status=open&limit=100&page=1`
        );
        all.push(...(res.opportunities ?? []));
        const total = res.meta?.total ?? all.length;
        if (total > 100) {
          const pages = Math.ceil(total / 100);
          const rest = await Promise.all(
            Array.from({ length: pages - 1 }, (_, i) =>
              ghl.get<{ opportunities: GHLOpportunity[] }>(
                `/opportunities/search?location_id=${locId}&assigned_to=${user.ghlUserId}&status=open&limit=100&page=${i + 2}`
              )
            )
          );
          for (const pg of rest) all.push(...(pg.opportunities ?? []));
        }
        items = all
          .filter((o) => o.status === "open")
          .map((o) => ({
            id: o.id,
            title: o.contact?.name ?? o.name ?? "Unknown",
            sub: o.pipelineStageId_name ?? undefined,
            amount: o.monetaryValue ?? undefined,
          }));
      }
    }
  } catch (err) {
    console.error("[rep-performance/drilldown]", err);
  }

  return NextResponse.json({ items, rep: user.name, metric });
}
