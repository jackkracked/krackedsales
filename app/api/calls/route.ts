import { NextRequest, NextResponse } from "next/server";
import { and, avg, count, desc, eq, gte, ilike, lte, sum } from "drizzle-orm";
import { db } from "@/lib/db";
import { calls } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/**
 * GET /api/calls
 *
 * Query params:
 *   type   — "meet" | "dialer" | "all" (default: "all")
 *   rep    — rep email (exact match)
 *   since  — ISO date string, inclusive lower bound on startedAt
 *   until  — ISO date string, inclusive upper bound on startedAt
 *   search — partial match on contactName (case-insensitive)
 *
 * Returns:
 *   { calls: CallRow[], total: number, metrics: { totalCalls, totalTalkSeconds, avgDurationSeconds, meetingsHeld } }
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const type   = sp.get("type")   ?? "all";
  const rep    = sp.get("rep")    ?? "";
  const since  = sp.get("since")  ?? "";
  const until  = sp.get("until")  ?? "";
  const search = sp.get("search") ?? "";

  try {
    const client = db();

    // Build the shared WHERE conditions so they apply to both the list query
    // and the metrics aggregation — keeps counts consistent with what is shown.
    const conditions = [];

    if (type === "meet" || type === "dialer") {
      conditions.push(eq(calls.callType, type));
    }

    if (rep) {
      conditions.push(eq(calls.repEmail, rep));
    }

    if (since) {
      conditions.push(gte(calls.startedAt, new Date(since)));
    }

    if (until) {
      conditions.push(lte(calls.startedAt, new Date(until)));
    }

    if (search) {
      conditions.push(ilike(calls.contactName, `%${search}%`));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // Fetch the filtered call rows, most recent first
    const rows = await client
      .select()
      .from(calls)
      .where(where)
      .orderBy(desc(calls.startedAt));

    // Aggregate totals/averages over the same filter set as the list query
    const [metrics] = await client
      .select({
        totalCalls:         count(),
        totalTalkSeconds:   sum(calls.durationSeconds),
        avgDurationSeconds: avg(calls.durationSeconds),
      })
      .from(calls)
      .where(where);

    // meetingsHeld requires a separate count with an extra callType='meet' filter
    const meetConditions = [...conditions, eq(calls.callType, "meet")];
    const [meetRow] = await client
      .select({ meetingsHeld: count() })
      .from(calls)
      .where(and(...meetConditions));

    const totalTalkSeconds = metrics.totalTalkSeconds
      ? Number(metrics.totalTalkSeconds)
      : 0;

    const avgDurationSeconds = metrics.avgDurationSeconds
      ? Number(metrics.avgDurationSeconds)
      : null;

    return NextResponse.json({
      calls: rows,
      total: Number(metrics.totalCalls),
      metrics: {
        totalCalls:         Number(metrics.totalCalls),
        totalTalkSeconds,
        avgDurationSeconds,
        meetingsHeld:       Number(meetRow?.meetingsHeld ?? 0),
      },
    });
  } catch (err) {
    console.error("[GET /api/calls]", err);
    return NextResponse.json({ error: "Failed to fetch calls" }, { status: 500 });
  }
}
