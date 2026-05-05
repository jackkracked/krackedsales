import { NextRequest, NextResponse } from "next/server";
import { ghl } from "@/lib/ghl/client";

export const dynamic = "force-dynamic";

// "Demo In Progress" stage ID for each pipeline that runs demos
const DEMO_IN_PROGRESS_STAGE: Record<string, string> = {
  JRvrpfcwAlAOM38mPAUJ: "ffd18e7a-a59e-4a13-894d-d5371d0bfc90", // Email Design Demo Pipeline (AD FUNNEL)
  uEefctNze07YOCaGOSNE: "4e3b0980-9eb9-4d7d-9f4d-cf0dbac04ff8", // Email Design Demo Pipeline (ORGANIC FUNNEL)
  "9pk3LOPFgZucx0Q13Spj": "dc8cda15-0d9c-44d1-bf16-e8d9a82d921d", // Kracked Retention General Pipeline (MAIN WEBSITE)
  tZ2jrSx9nurGp08CWxWU: "013d35a0-c062-423f-884a-9afa96716f36", // Taylor's TikTok Pipeline
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ opportunityId: string }> }
) {
  const { opportunityId } = await params;

  // Optional webhook secret check — set WEBHOOK_SECRET env var to lock this down
  const secret = process.env.WEBHOOK_SECRET;
  if (secret) {
    const provided = req.headers.get("x-webhook-secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    // Fetch the opportunity to find which pipeline it belongs to
    const opp = await ghl.get<{ opportunity: { id: string; pipelineId: string } }>(
      `/opportunities/${opportunityId}`
    );

    const pipelineId = opp.opportunity?.pipelineId;
    if (!pipelineId) {
      return NextResponse.json({ error: "Opportunity not found or missing pipelineId" }, { status: 404 });
    }

    const stageId = DEMO_IN_PROGRESS_STAGE[pipelineId];
    if (!stageId) {
      return NextResponse.json(
        { error: `No Demo In Progress stage configured for pipeline ${pipelineId}` },
        { status: 422 }
      );
    }

    // Move opportunity to Demo In Progress
    const updated = await ghl.put(`/opportunities/${opportunityId}`, {
      pipelineStageId: stageId,
    });

    return NextResponse.json({ success: true, opportunityId, pipelineId, stageId, updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/ghl/opportunities/[id]/demo-in-progress]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
