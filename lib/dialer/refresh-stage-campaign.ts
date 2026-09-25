/**
 * Keep a stage-built dial queue current.
 *
 * Jack, 2026-09-22: "if we work it one day, and then the next day we come back to it, but in
 * the meantime there's been new leads in that stage, are the new leads going to be in this
 * campaign? That's how I want it to work, like a dynamic campaign."
 *
 * So a stage campaign is a LIVE VIEW of the stage, not a photograph of it.
 *
 * TWO HALVES, AND ONLY ONE OF THEM IS OBVIOUS
 *
 * 1. Anyone who has since ENTERED the stage is added to the back of the queue. This is what
 *    Jack asked for.
 *
 * 2. Anyone who has since LEFT the stage is SUPPRESSED, not deleted. A queue built from
 *    "Unresponsive (Demo Not Started)" exists to call people who are unresponsive. Once
 *    someone books a call or closes, ringing them off that list is the kind of mistake a
 *    prospect notices. Suppressing is reversible and keeps their attempt history; deleting
 *    would throw away the record of work already done.
 *
 * Someone MID-CALL is never touched: rows locked by a rep, or already completed or exhausted,
 * are left exactly as they are.
 *
 * Costs nothing at GoHighLevel: the stage is read from the local mirror.
 */
import { and, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { dialerCampaigns, dialerCampaignContacts } from "@/lib/db/schema";
import { getDialableStageContacts } from "@/lib/dialer/stage-source";

export interface RefreshResult {
  added: number;
  suppressed: number;
  /** Null when the campaign is hand-built and has no source to refresh from. */
  dynamic: boolean;
}

export async function refreshStageCampaign(campaignId: string): Promise<RefreshResult> {
  const [camp] = await db()
    .select({
      id: dialerCampaigns.id,
      pipelineId: dialerCampaigns.sourcePipelineId,
      stageId: dialerCampaigns.sourceStageId,
    })
    .from(dialerCampaigns)
    .where(eq(dialerCampaigns.id, campaignId))
    .limit(1);

  // A hand-built campaign is left completely alone.
  if (!camp?.pipelineId || !camp.stageId) return { added: 0, suppressed: 0, dynamic: false };

  const { contacts } = await getDialableStageContacts(camp.pipelineId, camp.stageId);
  const liveIds = contacts.map((c) => c.contactId);

  const existing = await db()
    .select({ contactId: dialerCampaignContacts.contactId })
    .from(dialerCampaignContacts)
    .where(eq(dialerCampaignContacts.campaignId, campaignId));
  const known = new Set(existing.map((r) => r.contactId));

  // ── 1. New arrivals go to the back of the queue ────────────────────────────────────────
  const arrivals = contacts.filter((c) => !known.has(c.contactId));
  let added = 0;
  if (arrivals.length) {
    const [{ maxPos }] = await db()
      .select({ maxPos: sql<number>`coalesce(max(${dialerCampaignContacts.position}), 0)::int` })
      .from(dialerCampaignContacts)
      .where(eq(dialerCampaignContacts.campaignId, campaignId));

    let pos = maxPos;
    const rows = arrivals.map((c) => ({
      campaignId,
      contactId: c.contactId,
      contactName: c.contactName,
      phone: c.phone,
      position: ++pos,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const inserted = await db()
        .insert(dialerCampaignContacts)
        .values(rows.slice(i, i + 500))
        .onConflictDoNothing()
        .returning({ id: dialerCampaignContacts.id });
      added += inserted.length;
    }
  }

  // ── 2. Anyone who has moved on is suppressed ───────────────────────────────────────────
  // Only rows still waiting to be dialled: never touch one a rep has locked, nor one already
  // completed or exhausted, because those record work that actually happened.
  let suppressed = 0;
  if (liveIds.length) {
    const gone = await db()
      .update(dialerCampaignContacts)
      .set({ status: "suppressed" })
      .where(and(
        eq(dialerCampaignContacts.campaignId, campaignId),
        eq(dialerCampaignContacts.status, "queued"),
        isNull(dialerCampaignContacts.lockedByUserId),
        notInArray(dialerCampaignContacts.contactId, liveIds),
      ))
      .returning({ id: dialerCampaignContacts.id });
    suppressed = gone.length;
  }

  // ── 3. And anyone who came BACK is un-suppressed ───────────────────────────────────────
  // A lead can move out of a stage and return. Without this they would sit suppressed
  // forever, invisible, and never be called again.
  if (liveIds.length) {
    await db()
      .update(dialerCampaignContacts)
      .set({ status: "queued" })
      .where(and(
        eq(dialerCampaignContacts.campaignId, campaignId),
        eq(dialerCampaignContacts.status, "suppressed"),
        inArray(dialerCampaignContacts.contactId, liveIds),
        ne(dialerCampaignContacts.status, "completed"),
      ));
  }

  await db()
    .update(dialerCampaigns)
    .set({ sourceSyncedAt: new Date() })
    .where(eq(dialerCampaigns.id, campaignId));

  return { added, suppressed, dynamic: true };
}
