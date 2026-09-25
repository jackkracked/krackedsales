/**
 * lib/follow-ups/mirror-source.ts
 *
 * Mirror-backed replacement for the follow-ups route's per-stage GHL scrape (which looped
 * /opportunities/search across ~4 pipelines x several stages = 10-30+ live calls). Reads all
 * OPEN opportunities in the given pipelines from the mirror in one query, shaped exactly like
 * the route's EnrichedOpp (GHLOpportunity + stageName + pipelineName). The route's determineZone
 * filter runs downstream unchanged, so returning every open opp (not just pre-identified stages)
 * is correct. createdAt/updatedAt are normalized (rawData -> dateAdded/dateUpdated -> columns)
 * because the route derives daysSinceLastContact from them.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { localOpportunities, localPipelines } from "@/lib/db/schema";
import type { GHLOpportunity } from "@/lib/ghl/types";

interface PipelineStage {
  id: string;
  name: string;
  position?: number;
}

type RawOpp = GHLOpportunity & { dateAdded?: string; dateUpdated?: string };

export interface FollowUpOpp extends GHLOpportunity {
  stageName: string;
  pipelineName: string;
}

export async function getOpenOppsForPipelinesFromMirror(pipelineIds: string[]): Promise<FollowUpOpp[]> {
  if (pipelineIds.length === 0) return [];
  const database = db();
  const [pipelineRows, oppRows] = await Promise.all([
    database
      .select({ id: localPipelines.id, name: localPipelines.name, stages: localPipelines.stages })
      .from(localPipelines)
      .where(inArray(localPipelines.id, pipelineIds)),
    database
      .select({
        rawData: localOpportunities.rawData,
        pipelineId: localOpportunities.pipelineId,
        createdAtGhl: localOpportunities.createdAtGhl,
        updatedAtGhl: localOpportunities.updatedAtGhl,
      })
      .from(localOpportunities)
      .where(and(inArray(localOpportunities.pipelineId, pipelineIds), eq(localOpportunities.status, "open"))),
  ]);

  const pipelineName: Record<string, string> = {};
  const stageMaps: Record<string, Record<string, string>> = {};
  for (const p of pipelineRows) {
    pipelineName[p.id] = p.name;
    const m: Record<string, string> = {};
    for (const s of (p.stages as PipelineStage[] | null) ?? []) m[s.id] = s.name;
    stageMaps[p.id] = m;
  }

  const opps: FollowUpOpp[] = [];
  for (const row of oppRows) {
    const raw = row.rawData as RawOpp | null;
    if (!raw || !raw.id) continue;
    const pid = row.pipelineId ?? raw.pipelineId ?? "";
    const createdAt = raw.createdAt ?? raw.dateAdded ?? row.createdAtGhl?.toISOString() ?? "";
    const updatedAt = raw.updatedAt ?? raw.dateUpdated ?? row.updatedAtGhl?.toISOString() ?? createdAt;
    opps.push({
      ...raw,
      createdAt,
      updatedAt,
      stageName: stageMaps[pid]?.[raw.pipelineStageId] ?? "Unknown",
      pipelineName: pipelineName[pid] ?? "",
    });
  }
  return opps;
}
