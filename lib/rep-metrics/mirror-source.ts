/**
 * lib/rep-metrics/mirror-source.ts
 *
 * Mirror-backed replacement for the per-rep open-opportunity count. The live path made one
 * GHL /opportunities/search call PER active rep (reading meta.total). This is a single SQL
 * GROUP BY over the local mirror instead — one round-trip for the whole leaderboard, and
 * more accurate (live /opportunities/search intermittently omits open opps). "Open" = GHL
 * status 'open'; reps are matched by assigned_to = users.ghlUserId, exactly as the live path.
 */
import { and, eq, isNotNull, sql, isNull} from "drizzle-orm";
import { db } from "@/lib/db";
import { localOpportunities } from "@/lib/db/schema";

export interface RepOpenCounts {
  openCount: number;
  openValue: number;
}

/** Map of ghlUserId -> { openCount, openValue } over all open opportunities in the mirror. */
export async function getOpenCountsByRepFromMirror(): Promise<Map<string, RepOpenCounts>> {
  const rows = await db()
    .select({
      assignedTo: localOpportunities.assignedTo,
      openCount: sql<number>`count(*)::int`,
      openValue: sql<number>`coalesce(sum(${localOpportunities.monetaryValue}), 0)`,
    })
    .from(localOpportunities)
    .where(
      and(
        eq(localOpportunities.status, "open"),
        isNotNull(localOpportunities.assignedTo),
        // Opportunities GoHighLevel no longer has must not inflate a rep's open-lead count.
        // 98 deleted deals were still being counted before 2026-08-07.
        isNull(localOpportunities.deletedInGhlAt),
      ),
    )
    .groupBy(localOpportunities.assignedTo);

  const map = new Map<string, RepOpenCounts>();
  for (const r of rows) {
    if (r.assignedTo) map.set(r.assignedTo, { openCount: Number(r.openCount), openValue: Number(r.openValue) });
  }
  return map;
}
