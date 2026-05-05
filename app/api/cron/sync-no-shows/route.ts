import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import { db } from "@/lib/db";
import { pipelineStageEvents } from "@/lib/db/schema";
import { and, eq, gte } from "drizzle-orm";
import type { GHLOpportunity } from "@/lib/ghl/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PIPELINE_ID   = "JRvrpfcwAlAOM38mPAUJ";
const NO_SHOW_STAGE = { id: "8ffee91a-402a-4591-84cd-2dcb0023fbaa", name: "Intro Call (No-Show)" };

interface GHLOppsResponse {
  opportunities: GHLOpportunity[];
  meta?: { total: number; currentPage: number; nextPage: number | null };
}

function parseGHLDate(val: string | undefined): number {
  if (!val) return 0;
  const n = Number(val);
  if (!isNaN(n) && String(n) === val) return n;
  return new Date(val).getTime();
}

/**
 * Cron job — runs every 4 hours via Vercel Cron.
 * Scans the GHL pipeline for leads currently in the "Intro Call (No-Show)" stage
 * and permanently records any new entries in the DB.
 *
 * Because we record immediately on detection and never delete, the count
 * remains accurate even if a lead is later rebooked to another stage.
 *
 * Worst case miss window = cron interval (4h). In practice, leads stay in
 * no-show for days, so this catches everything.
 */
export async function GET(req: NextRequest) {
  // Vercel cron jobs call with Authorization: Bearer <CRON_SECRET>
  // Protect against external callers
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loc = locationId();
  const client = db();

  // Load all opportunities currently in the no-show stage
  const allOpps: GHLOpportunity[] = [];
  let page = 1;
  while (true) {
    const res = await ghl.get<GHLOppsResponse>(
      `/opportunities/search?location_id=${loc}&pipeline_id=${PIPELINE_ID}&pipeline_stage_id=${NO_SHOW_STAGE.id}&limit=100&page=${page}`
    );
    const batch = res.opportunities ?? [];
    allOpps.push(...batch);
    if (!res.meta?.nextPage || batch.length < 100) break;
    page++;
  }

  // Load existing DB records for this stage so we can skip already-recorded opps
  const existing = await client
    .select({ opportunityId: pipelineStageEvents.opportunityId })
    .from(pipelineStageEvents)
    .where(eq(pipelineStageEvents.stageId, NO_SHOW_STAGE.id));

  const existingIds = new Set(existing.map((r) => r.opportunityId));

  let inserted = 0;
  for (const opp of allOpps) {
    if (existingIds.has(opp.id)) continue;

    // enteredAt = updatedAt (the time GHL last modified this opp, which was when it was moved to this stage)
    const enteredAt = new Date(parseGHLDate(opp.updatedAt) || parseGHLDate(opp.createdAt));

    await client.insert(pipelineStageEvents).values({
      opportunityId: opp.id,
      contactId:     opp.contact?.id ?? null,
      pipelineId:    PIPELINE_ID,
      stageId:       NO_SHOW_STAGE.id,
      stageName:     NO_SHOW_STAGE.name,
      enteredAt,
      source:        "cron",
    });
    inserted++;
    console.log(`[sync-no-shows] Recorded: ${opp.name} (${opp.id}) enteredAt=${enteredAt.toISOString()}`);
  }

  console.log(`[sync-no-shows] Done. Found ${allOpps.length} in stage, inserted ${inserted} new records.`);
  return NextResponse.json({ inStage: allOpps.length, inserted, skipped: allOpps.length - inserted });
}
