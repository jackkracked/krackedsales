import { NextRequest, NextResponse } from "next/server";
import { ghl } from "@/lib/ghl/client";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ opportunityId: string }> }
) {
  const { opportunityId } = await params;
  const body = await req.json();
  const { pipelineStageId, monetaryValue } = body;

  if (!pipelineStageId && monetaryValue === undefined) {
    return NextResponse.json(
      { error: "pipelineStageId or monetaryValue is required" },
      { status: 400 }
    );
  }

  try {
    const payload: Record<string, unknown> = {};
    if (pipelineStageId) payload.pipelineStageId = pipelineStageId;
    if (monetaryValue !== undefined) payload.monetaryValue = monetaryValue;

    const data = await ghl.put(`/opportunities/${opportunityId}`, payload);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[PATCH /api/ghl/opportunities/[id]]", err);
    return NextResponse.json({ error: "Failed to update opportunity" }, { status: 500 });
  }
}
