import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { dialerCampaignReps, dialerCampaignContacts, users } from "@/lib/db/schema";
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
      campaign: { id: campaign.id, name: campaign.name, maxAttempts: campaign.maxAttempts, status: campaign.status, ownerScope: campaign.ownerScope },
      reps,
      counts,
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
