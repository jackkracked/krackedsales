import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { dialerCampaignContacts, callDispositions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getCampaign, canWork, claimNext, maxPosition } from "@/lib/dialer/queue";

export const dynamic = "force-dynamic";

const SUPPRESS = new Set(["do_not_call", "bad_number"]);

/**
 * POST /api/dialer/contacts/[id]/disposition — record the outcome for a campaign
 * contact, advance the queue (terminal → done/suppressed; no-contact → requeue to
 * the back until max attempts, then exhausted), release the lock, and claim the
 * next contact for a seamless auto-advance.
 * Body: { outcome: string, requeue: boolean, notes?: string, callId?: string }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  try {
    const [cc] = await db().select().from(dialerCampaignContacts).where(eq(dialerCampaignContacts.id, id)).limit(1);
    if (!cc) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const campaign = await getCampaign(cc.campaignId);
    if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!(await canWork(user, campaign))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    let body: Record<string, unknown>;
    try { body = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const outcome = typeof body.outcome === "string" ? body.outcome.trim() : "";
    if (!outcome) return NextResponse.json({ error: "outcome is required" }, { status: 400 });
    const requeue = body.requeue === true;
    const notes = typeof body.notes === "string" ? body.notes : null;
    const callId = typeof body.callId === "string" ? body.callId : null;

    const now = new Date();
    const nextAttempts = cc.attempts + 1;

    const base = { attempts: nextAttempts, lockedByUserId: null, lockedAt: null, lastOutcome: outcome, lastAttemptAt: now };
    let update: Record<string, unknown>;
    if (requeue) {
      if (nextAttempts < campaign.maxAttempts) {
        update = { ...base, status: "queued", position: (await maxPosition(cc.campaignId)) + 1 };
      } else {
        update = { ...base, status: "exhausted" };
      }
    } else {
      update = { ...base, status: SUPPRESS.has(outcome) ? "suppressed" : "completed" };
    }

    await db().update(dialerCampaignContacts).set(update).where(eq(dialerCampaignContacts.id, id));
    await db().insert(callDispositions).values({
      callId, contactId: cc.contactId, contactName: cc.contactName, repEmail: user.email, outcome, notes,
    }).onConflictDoNothing();

    const next = await claimNext(cc.campaignId, user.id);
    return NextResponse.json({ ok: true, next, done: !next });
  } catch (err) {
    console.error("[POST /api/dialer/contacts/[id]/disposition]", err);
    return NextResponse.json({ error: "Failed to save outcome" }, { status: 500 });
  }
}
