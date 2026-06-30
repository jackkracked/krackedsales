import { db } from "@/lib/db";
import { dialerCampaigns, dialerCampaignReps, dialerCampaignContacts } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";

export interface SessionUserLite { id: string; role: string }
export type Campaign = typeof dialerCampaigns.$inferSelect;

export async function getCampaign(campaignId: string): Promise<Campaign | null> {
  const [c] = await db().select().from(dialerCampaigns).where(eq(dialerCampaigns.id, campaignId)).limit(1);
  return c ?? null;
}

/** Admin, the creator, or an assigned rep may work a campaign. */
export async function canWork(user: SessionUserLite, campaign: { id: string; createdBy: string | null }): Promise<boolean> {
  if (user.role === "admin") return true;
  if (campaign.createdBy === user.id) return true;
  const r = await db().select({ id: dialerCampaignReps.id }).from(dialerCampaignReps)
    .where(and(eq(dialerCampaignReps.campaignId, campaign.id), eq(dialerCampaignReps.userId, user.id))).limit(1);
  return r.length > 0;
}

export interface ClaimedContact { id: string; contactId: string; contactName: string | null; phone: string | null; attempts: number }

function rowsOf(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  if (res && typeof res === "object" && "rows" in res) return ((res as { rows?: unknown[] }).rows ?? []) as Record<string, unknown>[];
  return [];
}

/**
 * Atomically claim the next dialable contact for `userId`. A single statement
 * (SELECT ... FOR UPDATE SKIP LOCKED inside an UPDATE) so two reps never get the
 * same contact, and it auto-reclaims locks older than 5 minutes (a crashed/closed
 * tab never strands a contact). Works over the Neon HTTP driver (one round-trip).
 */
export async function claimNext(campaignId: string, userId: string): Promise<ClaimedContact | null> {
  const res = await db().execute(sql`
    UPDATE dialer_campaign_contacts
    SET status = 'in_progress', locked_by_user_id = ${userId}, locked_at = now()
    WHERE id = (
      SELECT id FROM dialer_campaign_contacts
      WHERE campaign_id = ${campaignId}
        AND (status = 'queued' OR (status = 'in_progress' AND locked_at < now() - interval '5 minutes'))
      ORDER BY position ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, contact_id, contact_name, phone, attempts
  `);
  const row = rowsOf(res)[0];
  if (!row) return null;
  return {
    id: String(row.id),
    contactId: String(row.contact_id),
    contactName: row.contact_name == null ? null : String(row.contact_name),
    phone: row.phone == null ? null : String(row.phone),
    attempts: Number(row.attempts ?? 0),
  };
}

/** Next free FIFO position (append to the back of the queue). */
export async function maxPosition(campaignId: string): Promise<number> {
  const [r] = await db()
    .select({ maxPos: sql<number>`coalesce(max(${dialerCampaignContacts.position}), 0)::int` })
    .from(dialerCampaignContacts).where(eq(dialerCampaignContacts.campaignId, campaignId));
  return r?.maxPos ?? 0;
}
