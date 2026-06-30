import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getCampaign, canWork, claimNext } from "@/lib/dialer/queue";

export const dynamic = "force-dynamic";

/**
 * POST /api/dialer/campaigns/[id]/next — atomically claim the next dialable contact
 * for the current rep (locks it). Called on Start and to advance. Returns the
 * contact, or { done:true } when the queue is empty.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  try {
    const campaign = await getCampaign(id);
    if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!(await canWork(user, campaign))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const contact = await claimNext(id, user.id);
    return NextResponse.json({ contact, done: !contact });
  } catch (err) {
    console.error("[POST /api/dialer/campaigns/[id]/next]", err);
    return NextResponse.json({ error: "Failed to claim next contact" }, { status: 500 });
  }
}
