/**
 * GET /api/ghl/demos/started?since=YYYY-MM-DD&until=YYYY-MM-DD
 *
 * Returns opportunities that are in (or were moved to) a "Demo in Progress"
 * stage within the given period.
 *
 * Stage matching: any stage whose name contains "demo" and "progress"
 * (case-insensitive), e.g. "Demo In Progress", "Email Demo In Progress".
 */

import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import type { GHLPipeline, GHLOpportunity } from "@/lib/ghl/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function isDemoInProgressStage(stageName: string): boolean {
  const s = stageName.toLowerCase();
  return s.includes("demo") && s.includes("progress");
}

export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since");
  const until = req.nextUrl.searchParams.get("until");

  const sinceMs = since ? new Date(since).getTime() : 0;
  const untilMs = until ? new Date(`${until}T23:59:59Z`).getTime() : Date.now();

  try {
    const loc = locationId();

    // ── 1. Fetch all pipelines + find demo-in-progress stage IDs ──────────────
    const pipelinesData = await ghl.get<{ pipelines: GHLPipeline[] }>(
      `/opportunities/pipelines?locationId=${loc}`
    );

    type StageMeta = { stageName: string; pipelineName: string; pipelineId: string };
    const demoStageIds = new Map<string, StageMeta>();

    for (const p of pipelinesData.pipelines ?? []) {
      for (const s of p.stages ?? []) {
        if (isDemoInProgressStage(s.name)) {
          demoStageIds.set(s.id, {
            stageName: s.name,
            pipelineName: p.name,
            pipelineId: p.id,
          });
        }
      }
    }

    if (demoStageIds.size === 0) {
      return NextResponse.json({ demos: [], note: "No 'Demo in Progress' stages found in any pipeline" });
    }

    // ── 2. Fetch opportunities for each demo stage ─────────────────────────────
    const demos: Array<{
      id: string;
      contact: string;
      pipeline: string;
      stage: string;
      date: string;
      updatedMs: number;
    }> = [];

    for (const [stageId, meta] of demoStageIds.entries()) {
      let page = 1;
      while (true) {
        const res = await ghl.get<{
          opportunities: GHLOpportunity[];
          meta?: { nextPage: number | null };
        }>(
          `/opportunities/search?location_id=${loc}&pipeline_id=${meta.pipelineId}&pipeline_stage_id=${stageId}&status=open&limit=100&page=${page}`
        );
        const batch = res.opportunities ?? [];

        for (const opp of batch) {
          const updatedMs = opp.updatedAt
            ? (isNaN(Number(opp.updatedAt)) ? new Date(opp.updatedAt).getTime() : Number(opp.updatedAt))
            : 0;

          // Include if updated in the requested period
          if (updatedMs >= sinceMs && updatedMs <= untilMs) {
            const date = new Date(updatedMs).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            });
            demos.push({
              id: opp.id,
              contact: opp.contact?.name ?? opp.name ?? "Unknown",
              pipeline: meta.pipelineName,
              stage: meta.stageName,
              date,
              updatedMs,
            });
          }
        }

        if (!res.meta?.nextPage || batch.length < 100) break;
        page++;
      }
    }

    // Sort newest first
    demos.sort((a, b) => b.updatedMs - a.updatedMs);

    return NextResponse.json({ demos: demos.map(({ updatedMs: _, ...d }) => d) });
  } catch (err) {
    console.error("[GET /api/ghl/demos/started]", err);
    return NextResponse.json({ demos: [] }, { status: 500 });
  }
}
