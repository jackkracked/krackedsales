import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { dialerCampaignContacts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getCampaign, canWork, claimNext, maxPosition } from "@/lib/dialer/queue";

export const dynamic = "force-dynamic";

/**
 * POST /api/dialer/contacts/[id]/skip — send the current contact to the back of the
 * queue WITHOUT charging an attempt, release its lock, and claim the next one.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  try {
    const [cc] = await db().select().from(dialerCampaignContacts).where(eq(dialerCampaignContacts.id, id)).limit(1);
    if (!cc) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const campaign = await getCampaign(cc.campaignId);
    if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!(await canWork(user, campaign))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    await db().update(dialerCampaignContacts)
      .set({ status: "queued", position: (await maxPosition(cc.campaignId)) + 1, lockedByUserId: null, lockedAt: null })
      .where(eq(dialerCampaignContacts.id, id));

    const next = await claimNext(cc.campaignId, user.id);
    return NextResponse.json({ ok: true, next, done: !next });
  } catch (err) {
    console.error("[POST /api/dialer/contacts/[id]/skip]", err);
    return NextResponse.json({ error: "Failed to skip" }, { status: 500 });
  }
}
