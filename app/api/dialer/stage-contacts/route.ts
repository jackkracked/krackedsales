import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getDialableStageContacts } from "@/lib/dialer/stage-source";

export const dynamic = "force-dynamic";

/**
 * How many people in this stage can be called. COUNTS ONLY — deliberately no phone numbers.
 *
 * The preview exists so the dialer can say "241 ready to dial · 31 skipped, no phone number"
 * before anything is created. It does not need to hand the browser 241 phone numbers to do
 * that, and an endpoint that does is a bulk export of the CRM's phone book to anyone with a
 * session. The numbers are resolved server-side at the moment the queue is written
 * (POST /api/dialer/campaigns with `source`), from the same function, so the number shown and
 * the number queued cannot drift.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // `getSessionUser` reads isActive but no caller enforces it, so a deactivated rep with a
  // live cookie still authenticates. Enforce it here rather than inherit the gap.
  if (!user.isActive) return NextResponse.json({ error: "Account is deactivated" }, { status: 403 });

  const pipelineId = req.nextUrl.searchParams.get("pipelineId");
  const stageId = req.nextUrl.searchParams.get("stageId");
  if (!pipelineId || !stageId) {
    return NextResponse.json({ error: "pipelineId and stageId are required" }, { status: 400 });
  }

  try {
    const { counts } = await getDialableStageContacts(pipelineId, stageId);
    return NextResponse.json({ counts });
  } catch (err) {
    console.error("[GET /api/dialer/stage-contacts]", err);
    return NextResponse.json({ error: "Could not read that stage" }, { status: 500 });
  }
}
