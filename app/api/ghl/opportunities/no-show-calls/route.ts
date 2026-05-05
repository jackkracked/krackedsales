import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import { db } from "@/lib/db";
import { pipelineStageEvents } from "@/lib/db/schema";
import { and, eq, gte, lte, count } from "drizzle-orm";
import type { GHLOpportunity } from "@/lib/ghl/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PIPELINE_ID   = "JRvrpfcwAlAOM38mPAUJ";
const NO_SHOW_STAGE = "8ffee91a-402a-4591-84cd-2dcb0023fbaa";

interface GHLOpportunitiesResponse {
  opportunities: GHLOpportunity[];
  meta?: { total: number; currentPage: number; nextPage: number | null };
}

export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since"); // YYYY-MM-DD
  const until = req.nextUrl.searchParams.get("until"); // YYYY-MM-DD

  const sinceDate = since ? new Date(since) : null;
  const untilDate = until ? new Date(`${until}T23:59:59Z`) : null;

  try {
    // ── Primary source: pipeline_stage_events table ──────────────────────────
    // This table is populated by the GHL webhook (real-time) and the backfill
    // endpoint. It records every entry into the no-show stage permanently, so
    // the count never decreases if a lead is later moved to another stage.

    const conditions = [eq(pipelineStageEvents.stageId, NO_SHOW_STAGE)];
    if (sinceDate) conditions.push(gte(pipelineStageEvents.enteredAt, sinceDate));
    if (untilDate) conditions.push(lte(pipelineStageEvents.enteredAt, untilDate));

    const [result] = await db()
      .select({ count: count() })
      .from(pipelineStageEvents)
      .where(and(...conditions));

    const dbCount = result?.count ?? 0;

    // If the DB has data for this period, trust it completely
    if (dbCount > 0) {
      console.log(`[no-show-calls] DB count: ${dbCount}`);
      return NextResponse.json({ count: dbCount, source: "db" });
    }

    // ── Fallback: live GHL pipeline state ────────────────────────────────────
    // Used before the webhook is wired up or the backfill has been run.
    // Counts opps CURRENTLY in the no-show stage whose updatedAt is in period.
    // Less accurate (misses rebooked leads) but better than nothing.

    console.log("[no-show-calls] No DB data — falling back to live GHL");

    const sinceMs = sinceDate?.getTime() ?? null;
    const untilMs = untilDate?.getTime() ?? null;

    function parseGHLDate(val: string | undefined): number {
      if (!val) return 0;
      const n = Number(val);
      if (!isNaN(n) && String(n) === val) return n;
      return new Date(val).getTime();
    }

    function inPeriod(ms: number): boolean {
      if (!ms || isNaN(ms)) return false;
      if (sinceMs && ms < sinceMs) return false;
      if (untilMs && ms > untilMs) return false;
      return true;
    }

    const loc = locationId();
    const allOpps: GHLOpportunity[] = [];
    let page = 1;
    while (true) {
      const res = await ghl.get<GHLOpportunitiesResponse>(
        `/opportunities/search?location_id=${loc}&pipeline_id=${PIPELINE_ID}&limit=100&page=${page}`
      );
      const batch = res.opportunities ?? [];
      allOpps.push(...batch);
      if (!res.meta?.nextPage || batch.length < 100) break;
      page++;
    }

    const fallbackCount = allOpps.filter((opp) => {
      if (opp.pipelineStageId !== NO_SHOW_STAGE) return false;
      return inPeriod(parseGHLDate(opp.updatedAt));
    }).length;

    console.log(`[no-show-calls] Fallback GHL count: ${fallbackCount}`);
    return NextResponse.json({ count: fallbackCount, source: "ghl-fallback" });

  } catch (err) {
    console.error("[/api/ghl/opportunities/no-show-calls]", err);
    return NextResponse.json({ count: 0 }, { status: 500 });
  }
}

// Manually add a no-show entry (used by Slack agent)
export async function POST(req: NextRequest) {
  try {
    const { contactName, date } = await req.json() as { contactName?: string; date?: string };
    const enteredAt = date ? new Date(date) : new Date();
    // Generate a placeholder opportunityId so the row is valid
    const opportunityId = `slack-nosh-${Date.now()}`;

    await db().insert(pipelineStageEvents).values({
      opportunityId,
      pipelineId: PIPELINE_ID,
      stageId: NO_SHOW_STAGE,
      stageName: "No Show",
      enteredAt,
      source: "manual",
    });

    return NextResponse.json({ ok: true, contactName, enteredAt });
  } catch (err) {
    console.error("[POST /api/ghl/opportunities/no-show-calls]", err);
    return NextResponse.json({ error: "Failed to add no-show" }, { status: 500 });
  }
}
