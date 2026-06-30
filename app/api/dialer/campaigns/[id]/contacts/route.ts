import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { dialerCampaigns, dialerCampaignReps, dialerCampaignContacts } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

interface IncomingContact { contactId: string; contactName?: string | null; phone?: string | null }

/**
 * POST /api/dialer/campaigns/[id]/contacts — add contacts to a campaign's queue
 * (the "Add to Power Dialer" action). Admin, the creator, or an assigned rep only.
 * Dedupes on (campaign, contact); appends at the end of the queue.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  try {
    const [camp] = await db().select().from(dialerCampaigns).where(eq(dialerCampaigns.id, id)).limit(1);
    if (!camp) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    // Authorize: admin, creator, or assigned rep.
    if (user.role !== "admin" && camp.createdBy !== user.id) {
      const assigned = await db().select({ id: dialerCampaignReps.id }).from(dialerCampaignReps)
        .where(and(eq(dialerCampaignReps.campaignId, id), eq(dialerCampaignReps.userId, user.id))).limit(1);
      if (!assigned.length) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const raw = Array.isArray(body.contacts) ? (body.contacts as unknown[]) : [];
    const clean: IncomingContact[] = raw
      .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
      .filter((c) => typeof c.contactId === "string" && (c.contactId as string).trim() !== "")
      .map((c) => ({
        contactId: (c.contactId as string).trim(),
        contactName: typeof c.contactName === "string" ? c.contactName : null,
        phone: typeof c.phone === "string" ? c.phone : null,
      }));
    if (!clean.length) return NextResponse.json({ error: "No valid contacts" }, { status: 400 });

    // Append after the current max position.
    const [{ maxPos }] = await db()
      .select({ maxPos: sql<number>`coalesce(max(${dialerCampaignContacts.position}), 0)::int` })
      .from(dialerCampaignContacts).where(eq(dialerCampaignContacts.campaignId, id));

    let pos = maxPos;
    const rows = clean.map((c) => ({
      campaignId: id,
      contactId: c.contactId,
      contactName: c.contactName,
      phone: c.phone,
      position: ++pos,
    }));

    const inserted = await db().insert(dialerCampaignContacts)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: dialerCampaignContacts.id });

    return NextResponse.json({ added: inserted.length, submitted: clean.length });
  } catch (err) {
    console.error("[POST /api/dialer/campaigns/[id]/contacts]", err);
    return NextResponse.json({ error: "Failed to add contacts" }, { status: 500 });
  }
}
