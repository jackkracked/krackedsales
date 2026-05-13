import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import type { GHLOpportunity, GHLPipeline } from "@/lib/ghl/types";

export const dynamic = "force-dynamic";

interface GHLOpportunitiesResponse {
  opportunities: GHLOpportunity[];
  meta?: { total: number };
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const pipelineId = searchParams.get("pipelineId");
  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const since = searchParams.get("since");
  const until = searchParams.get("until");

  if (!pipelineId) {
    return NextResponse.json({ opportunities: [], meta: { total: 0 } });
  }

  try {
    const [oppsData, pipelinesData] = await Promise.all([
      ghl.get<GHLOpportunitiesResponse>(
        `/opportunities/search?location_id=${locationId()}&pipeline_id=${pipelineId}&limit=100&page=${page}`
      ),
      ghl.get<{ pipelines: GHLPipeline[] }>(
        `/opportunities/pipelines?locationId=${locationId()}`
      ),
    ]);

    const pipeline = pipelinesData.pipelines?.find((p) => p.id === pipelineId);
    const stageMap: Record<string, string> = {};
    if (pipeline?.stages) {
      for (const s of pipeline.stages) {
        stageMap[s.id] = s.name;
      }
    }

    let opps = (oppsData.opportunities ?? []).map((opp) => ({
      ...opp,
      pipelineStageId_name: stageMap[opp.pipelineStageId] ?? "Unknown Stage",
    }));

    // Filter by createdAt date range if requested.
    // Dates are treated as CST (UTC-6) day boundaries so a "today" query
    // covers the full calendar day in Jack's timezone, not UTC.
    if (since || until) {
      const sinceMs = since ? new Date(`${since}T00:00:00-06:00`).getTime() : 0;
      const untilMs = until ? new Date(`${until}T23:59:59-06:00`).getTime() : Infinity;
      const before = opps.length;
      opps = opps.filter((opp) => {
        const t = new Date(opp.createdAt).getTime();
        return t >= sinceMs && t <= untilMs;
      });
      console.log(`[opportunities] date filter ${since}→${until} (CST): ${before} total → ${opps.length} matched`);
    }

    return NextResponse.json({ opportunities: opps, meta: oppsData.meta });
  } catch (err) {
    console.error("[GET /api/ghl/opportunities]", err);
    return NextResponse.json({ error: "Failed to fetch opportunities" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  try {
    const data = await ghl.post<GHLOpportunity>("/opportunities/", {
      ...body,
      locationId: locationId(),
    });
    return NextResponse.json(data);
  } catch (err) {
    console.error("[POST /api/ghl/opportunities]", err);
    return NextResponse.json({ error: "Failed to create opportunity" }, { status: 500 });
  }
}
