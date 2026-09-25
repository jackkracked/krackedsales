/**
 * lib/pipeline/mirror-source.ts
 *
 * Mirror-backed replacement for the Pipeline board's per-pipeline opportunity scrape
 * (fetchAllOpportunities over live GHL). Rebuilds each opp from local_opportunities.rawData
 * (exact GHL JSON) + local_pipelines.stages for stage names.
 *
 * IMPORTANT vs the Contacts flip: the pipeline CARD renders and the board SORTS on
 * opp.createdAt/updatedAt directly, and the route's since/until filter reads opp.createdAt.
 * The v2 /opportunities/search + webhook payloads store dates as dateAdded/dateUpdated, so we
 * normalize createdAt/updatedAt (rawData names first, then dateAdded/dateUpdated, then the
 * projected createdAtGhl/updatedAtGhl columns) or the card date + sort + date-filter break.
 */
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { localOpportunities, localPipelines } from "@/lib/db/schema";
import type { GHLOpportunity } from "@/lib/ghl/types";

interface PipelineStage {
  id: string;
  name: string;
  position?: number;
}

export interface EnrichedOpp extends GHLOpportunity {
  pipelineStageId_name: string;
}

type RawOpp = GHLOpportunity & { dateAdded?: string; dateUpdated?: string };

export async function getPipelineOpportunitiesFromMirror(pipelineId: string): Promise<EnrichedOpp[]> {
  const database = db();
  const [pipelineRows, oppRows] = await Promise.all([
    database.select({ stages: localPipelines.stages }).from(localPipelines).where(eq(localPipelines.id, pipelineId)),
    database
      .select({
        rawData: localOpportunities.rawData,
        createdAtGhl: localOpportunities.createdAtGhl,
        updatedAtGhl: localOpportunities.updatedAtGhl,
      })
      .from(localOpportunities)
      // Soft-deleted opportunities must never render. The schema states the rule outright
      // (lib/db/schema.ts: "EVERY count or list must filter deletedInGhlAt IS NULL") and this
      // query was missing it, so 98 opportunities deleted in GHL were still drawn on the board.
      //
      // `status = 'open'` matches the view GHL actually shows: its board defaults to the
      // "Open opportunities" tab. Measured against the live API for the Ad Funnel pipeline:
      //   app, deleted-filter only .... 2297
      //   app, + status='open' ........ 2244
      //   GHL all statuses ............ 2291
      //   GHL "Open opportunities" .... 2238   <- the number on Jack's screen
      // Stages holding only non-open deals (e.g. "Closed (Onboarded)", 52 won) correctly show
      // ZERO on both sides — that is a match, not a hidden column. Status is not stage, but the
      // board we are mirroring is filtered by status, so we filter the same way.
      .where(and(
        eq(localOpportunities.pipelineId, pipelineId),
        isNull(localOpportunities.deletedInGhlAt),
        eq(localOpportunities.status, "open"),
      )),
  ]);

  const stageMap: Record<string, string> = {};
  for (const p of pipelineRows) {
    for (const s of (p.stages as PipelineStage[] | null) ?? []) stageMap[s.id] = s.name;
  }

  const opps: EnrichedOpp[] = [];
  for (const row of oppRows) {
    const raw = row.rawData as RawOpp | null;
    if (!raw || !raw.id) continue;
    const createdAt = raw.createdAt ?? raw.dateAdded ?? row.createdAtGhl?.toISOString() ?? "";
    const updatedAt = raw.updatedAt ?? raw.dateUpdated ?? row.updatedAtGhl?.toISOString() ?? createdAt;
    opps.push({ ...raw, createdAt, updatedAt, pipelineStageId_name: stageMap[raw.pipelineStageId] ?? "Unknown Stage" });
  }
  return opps;
}
