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
    let oppsUrl = `/opportunities/search?location_id=${locationId()}&pipeline_id=${pipelineId}&limit=100&page=${page}`;
    if (since) oppsUrl += `&startDate=${encodeURIComponent(since)}`;
    if (until) oppsUrl += `&endDate=${encodeURIComponent(until)}`;

    const [oppsData, pipelinesData] = await Promise.all([
      ghl.get<GHLOpportunitiesResponse>(oppsUrl),
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

    const enriched = (oppsData.opportunities ?? []).map((opp) => ({
      ...opp,
      pipelineStageId_name: stageMap[opp.pipelineStageId] ?? "Unknown Stage",
    }));

    return NextResponse.json({ opportunities: enriched, meta: oppsData.meta });
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
