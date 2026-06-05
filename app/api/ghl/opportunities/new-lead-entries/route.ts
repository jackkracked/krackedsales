import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import { fetchAllOpportunities } from "@/lib/ghl/paginate";
import { db } from "@/lib/db";
import { pipelineStageEvents } from "@/lib/db/schema";
import { and, eq, gte, lte, ilike } from "drizzle-orm";
import type { GHLOpportunity, GHLPipeline } from "@/lib/ghl/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface GHLOpportunitiesResponse {
  opportunities: GHLOpportunity[];
  meta?: { total: number };
}

/**
 * Returns opportunities that *entered* the "New Lead" stage within a date range.
 * Uses pipeline_stage_events (webhook-driven) so the count never decreases if a
 * lead is later moved forward — it's a permanent historical record of when each
 * lead first hit the pipeline.
 *
 * Query params:
 *   pipelineId  required
 *   since       YYYY-MM-DD (CST day start)
 *   until       YYYY-MM-DD (CST day end)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const pipelineId = searchParams.get("pipelineId");
  const since = searchParams.get("since");
  const until = searchParams.get("until");

  if (!pipelineId) {
    return NextResponse.json({ error: "pipelineId is required" }, { status: 400 });
  }

  try {
    // CST day boundaries (UTC-6)
    const sinceDate = since ? new Date(`${since}T00:00:00-06:00`) : null;
    const untilDate = until ? new Date(`${until}T23:59:59-06:00`) : null;

    // Query pipeline_stage_events for entries into "New Lead" in this pipeline
    const conditions = [
      eq(pipelineStageEvents.pipelineId, pipelineId),
      ilike(pipelineStageEvents.stageName, "new lead"),
    ];
    if (sinceDate) conditions.push(gte(pipelineStageEvents.enteredAt, sinceDate));
    if (untilDate) conditions.push(lte(pipelineStageEvents.enteredAt, untilDate));

    const events = await db()
      .select({
        opportunityId: pipelineStageEvents.opportunityId,
        enteredAt: pipelineStageEvents.enteredAt,
        stageName: pipelineStageEvents.stageName,
      })
      .from(pipelineStageEvents)
      .where(and(...conditions));

    if (events.length === 0) {
      console.log(`[new-lead-entries] No DB events for pipelineId=${pipelineId} ${since}→${until}`);
      return NextResponse.json({ total: 0, leads: [], source: "db" });
    }

    // Fetch pipeline stages and all current opps in one pass to avoid N+1 calls.
    const loc = locationId();
    // Fetch pipeline stages and EVERY opportunity in the pipeline (all pages).
    const [pipelinesData, allOpps] = await Promise.all([
      ghl.get<{ pipelines: GHLPipeline[] }>(`/opportunities/pipelines?locationId=${loc}`),
      fetchAllOpportunities(`/opportunities/search?location_id=${loc}&pipeline_id=${pipelineId}`),
    ]);

    const stageMap: Record<string, string> = {};
    const pipeline = pipelinesData.pipelines?.find((p) => p.id === pipelineId);
    for (const s of pipeline?.stages ?? []) stageMap[s.id] = s.name;

    const oppMap = new Map(allOpps.map((o) => [o.id, o]));

    const leads = events.map((ev) => {
      const opp = oppMap.get(ev.opportunityId);
      return {
        opportunityId: ev.opportunityId,
        enteredNewLeadAt: ev.enteredAt,
        name: opp?.name ?? "Unknown",
        contact: opp?.contact?.name ?? null,
        currentStage: stageMap[opp?.pipelineStageId ?? ""] ?? opp?.pipelineStageId ?? "Unknown",
        value: opp?.monetaryValue ?? null,
      };
    });

    console.log(`[new-lead-entries] ${leads.length} leads entered New Lead stage on ${since}→${until}`);
    return NextResponse.json({ total: leads.length, leads, source: "db" });

  } catch (err) {
    console.error("[GET /api/ghl/opportunities/new-lead-entries]", err);
    return NextResponse.json({ error: "Failed to fetch new lead entries" }, { status: 500 });
  }
}
