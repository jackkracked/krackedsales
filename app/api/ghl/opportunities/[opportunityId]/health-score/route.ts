import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calls, followupSends, pipelineStageEvents } from "@/lib/db/schema";
import { eq, and, gte, count } from "drizzle-orm";
import { computeHealthScore } from "@/lib/deal-health";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ opportunityId: string }> }
) {
  const { opportunityId } = await params;
  const url = new URL(req.url);
  const contactId = url.searchParams.get("contactId") ?? "";
  const stageName = url.searchParams.get("stageName") ?? "";
  const updatedAt = url.searchParams.get("updatedAt") ?? new Date().toISOString();
  const status = url.searchParams.get("status") ?? "open";

  try {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const [callCount, noShowRows, lastFollowup] = await Promise.all([
      // Calls with this contact in last 14 days
      contactId
        ? db()
            .select({ cnt: count() })
            .from(calls)
            .where(and(eq(calls.contactId, contactId), gte(calls.startedAt, fourteenDaysAgo)))
            .then((r) => r[0]?.cnt ?? 0)
        : Promise.resolve(0),

      // Did this opp ever hit a no-show stage?
      db()
        .select({ stageName: pipelineStageEvents.stageName })
        .from(pipelineStageEvents)
        .where(eq(pipelineStageEvents.opportunityId, opportunityId))
        .then((rows) =>
          rows.some((r) => r.stageName.toLowerCase().includes("no show") || r.stageName.toLowerCase().includes("noshow"))
        ),

      // Most recent follow-up send for this contact
      contactId
        ? db()
            .select({ resultedInResponse: followupSends.resultedInResponse })
            .from(followupSends)
            .where(eq(followupSends.ghlContactId, contactId))
            .orderBy(followupSends.sentAt)
            .limit(1)
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
    ]);

    // Demo completed = opp ever reached "Sale In Progress" or later stage
    const stageHistory = await db()
      .select({ stageName: pipelineStageEvents.stageName })
      .from(pipelineStageEvents)
      .where(eq(pipelineStageEvents.opportunityId, opportunityId));

    const demoCompleted = stageHistory.some((r) => {
      const s = r.stageName.toLowerCase();
      return s.includes("sale in progress") || s.includes("proposal") || s.includes("close");
    });

    const result = computeHealthScore({
      stageName,
      updatedAt,
      status,
      callsLast14Days: Number(callCount),
      hadNoShow: noShowRows,
      demoCompleted,
      lastFollowupGotResponse: lastFollowup
        ? lastFollowup.resultedInResponse
        : null,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[GET health-score]", err);
    return NextResponse.json({ error: "Failed to compute score" }, { status: 500 });
  }
}
