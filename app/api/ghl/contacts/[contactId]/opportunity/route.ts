import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import type { GHLOpportunity, GHLPipeline } from "@/lib/ghl/types";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ contactId: string }> }
) {
  const { contactId } = await params;
  const name = req.nextUrl.searchParams.get("name") ?? "";
  const loc = locationId();

  try {
    const pipelinesData = await ghl.get<{ pipelines: GHLPipeline[] }>(
      `/opportunities/pipelines?locationId=${loc}`
    );

    // Strategy 1: filter by contact_id directly
    let opp: GHLOpportunity | null = null;

    const byContact = await ghl.get<{ opportunities: GHLOpportunity[] }>(
      `/opportunities/search?location_id=${loc}&contact_id=${contactId}&limit=10`
    ).catch(() => ({ opportunities: [] }));

    opp = byContact.opportunities?.find(
      (o) => o.contact?.id === contactId || o.id
    ) ?? byContact.opportunities?.[0] ?? null;

    // Strategy 2: text search by contact name (GHL's contact_id filter can be unreliable)
    if (!opp && name) {
      const byName = await ghl.get<{ opportunities: GHLOpportunity[] }>(
        `/opportunities/search?location_id=${loc}&q=${encodeURIComponent(name)}&limit=10`
      ).catch(() => ({ opportunities: [] }));

      // Prefer exact contact id match, fall back to first result
      opp = byName.opportunities?.find((o) => o.contact?.id === contactId)
        ?? byName.opportunities?.[0]
        ?? null;
    }

    if (!opp) return NextResponse.json({ opportunity: null });

    // Enrich with stage name
    const pipeline = pipelinesData.pipelines?.find((p) => p.id === opp!.pipelineId);
    const stageName = pipeline?.stages?.find((s) => s.id === opp!.pipelineStageId)?.name ?? "Unknown";

    return NextResponse.json({
      opportunity: { ...opp, pipelineStageId_name: stageName },
      stageName,
    });
  } catch (err) {
    console.error("[GET /api/ghl/contacts/[id]/opportunity]", err);
    return NextResponse.json({ opportunity: null }, { status: 500 });
  }
}
