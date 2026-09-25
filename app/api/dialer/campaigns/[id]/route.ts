import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { refreshStageCampaign } from "@/lib/dialer/refresh-stage-campaign";
import { getSessionUser } from "@/lib/auth/session";
import { dialerCampaigns, dialerCampaignReps, dialerCampaignContacts, users } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { getCampaign, canWork } from "@/lib/dialer/queue";

export const dynamic = "force-dynamic";

/** GET /api/dialer/campaigns/[id] — campaign detail with the full roster + reps + counts. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  try {
    const campaign = await getCampaign(id);
    if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!(await canWork(user, campaign))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // A stage-built campaign is a LIVE VIEW of that stage, so opening it pulls in anyone who
    // has since entered and stands down anyone who has left. Reads the local mirror, so this
    // costs nothing at GoHighLevel. A hand-built campaign returns immediately, untouched.
    // Never allowed to fail the request: a stale queue is better than no queue.
    const refreshed = await refreshStageCampaign(id).catch((e) => {
      console.error("[dialer] stage refresh failed", e);
      return { added: 0, suppressed: 0, dynamic: false };
    });

    const [reps, contacts] = await Promise.all([
      db().select({ userId: users.id, name: users.name }).from(dialerCampaignReps)
        .innerJoin(users, eq(users.id, dialerCampaignReps.userId)).where(eq(dialerCampaignReps.campaignId, id)),
      db().select().from(dialerCampaignContacts).where(eq(dialerCampaignContacts.campaignId, id)).orderBy(asc(dialerCampaignContacts.position)),
    ]);

    const counts = { queued: 0, inProgress: 0, completed: 0, exhausted: 0, suppressed: 0, total: contacts.length };
    for (const c of contacts) {
      if (c.status === "queued") counts.queued++;
      else if (c.status === "in_progress") counts.inProgress++;
      else if (c.status === "completed") counts.completed++;
      else if (c.status === "exhausted") counts.exhausted++;
      else if (c.status === "suppressed") counts.suppressed++;
    }

    return NextResponse.json({
      campaign: {
        id: campaign.id, name: campaign.name, maxAttempts: campaign.maxAttempts,
        status: campaign.status, ownerScope: campaign.ownerScope,
        // So the UI can say this queue keeps itself current, rather than leaving the rep to
        // wonder whether today's new leads are in it.
        dynamic: refreshed.dynamic,
      },
      reps,
      counts,
      // What this open just changed, so an arrival is announced rather than silently appearing.
      refreshed: { added: refreshed.added, suppressed: refreshed.suppressed },
      contacts: contacts.map((c) => ({
        id: c.id, contactId: c.contactId, contactName: c.contactName, phone: c.phone,
        attempts: c.attempts, status: c.status, position: c.position,
      })),
    });
  } catch (err) {
    console.error("[GET /api/dialer/campaigns/[id]]", err);
    return NextResponse.json({ error: "Failed to load campaign" }, { status: 500 });
  }
}

/** DELETE /api/dialer/campaigns/[id] — ADMIN ONLY. Hard-deletes the campaign; its reps + queued
 *  contacts cascade away (FK on delete cascade), while logged calls keep their history with
 *  campaign_id set to null. Irreversible. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;

  try {
    const deleted = await db()
      .delete(dialerCampaigns)
      .where(eq(dialerCampaigns.id, id))
      .returning({ id: dialerCampaigns.id });
    if (!deleted.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/dialer/campaigns/[id]]", err);
    return NextResponse.json({ error: "Failed to delete campaign" }, { status: 500 });
  }
}
