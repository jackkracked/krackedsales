import { NextRequest, NextResponse } from "next/server";
import { ghl } from "@/lib/ghl/client";
import type { GHLOpportunity } from "@/lib/ghl/types";
import { getSessionUser } from "@/lib/auth/session";
import { logActivity } from "@/lib/activity/logger";
import { applyLocalOpportunityMove } from "@/lib/pipeline/local-move";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ opportunityId: string }> }
) {
  const { opportunityId } = await params;
  try {
    const data = await ghl.get<{ opportunity: GHLOpportunity }>(
      `/opportunities/${opportunityId}`
    );
    return NextResponse.json(data.opportunity ?? data);
  } catch (err) {
    console.error("[GET /api/ghl/opportunities/[id]]", err);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ opportunityId: string }> }
) {
  const { opportunityId } = await params;
  const body = await req.json();
  const { pipelineStageId, monetaryValue, reason } = body;
  const sessionUser = await getSessionUser().catch(() => null);

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

    // Write the move into the mirror BEFORE responding. The client invalidates its
    // ["opportunities"] query the moment this resolves, and that refetch reads the mirror —
    // so without this the board pulls the OLD stage back and the card visibly snaps to where
    // it came from, on every successful drag. Failing the request is not the right response
    // to a mirror write error: GHL has already accepted the move, and a 500 here would make
    // the client roll back an optimistic update that actually succeeded.
    await applyLocalOpportunityMove({ opportunityId, pipelineStageId, monetaryValue }).catch(
      (e) => console.error("[PATCH /api/ghl/opportunities/[id]] mirror write failed", e),
    );

    logActivity({
      userId: sessionUser?.id ?? "unknown",
      userName: sessionUser?.name ?? "Unknown",
      userEmail: sessionUser?.email ?? "unknown@unknown.com",
      action: "opportunity.stage_changed",
      entityType: "opportunity",
      entityId: opportunityId,
      entityName: body.opportunityName,
      metadata: {
        to_stage: body.stageName,
        from_stage: body.fromStageName,
        to_stage_id: pipelineStageId,
        ...(reason ? { reason: String(reason) } : {}),
      },
    });

    return NextResponse.json(data);
  } catch (err) {
    console.error("[PATCH /api/ghl/opportunities/[id]]", err);
    return NextResponse.json({ error: "Failed to update opportunity" }, { status: 500 });
  }
}
