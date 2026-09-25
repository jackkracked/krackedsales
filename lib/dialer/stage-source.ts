/**
 * Who in a pipeline stage can actually be called.
 *
 * Lives in lib/ and not in a route because BOTH the preview count and the actual queue write
 * must come from the same function. Computing the number in one place and the rows in another
 * is how a user gets told "241 ready to dial" and receives 194 with no explanation.
 *
 * Reads the local mirror only, so previewing or loading a 241-lead stage costs nothing at
 * GoHighLevel, whose rate limit the whole app shares.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export interface StageContact {
  contactId: string;
  contactName: string | null;
  phone: string;
}

export interface StageCounts {
  /** Distinct PEOPLE in the stage, not opportunity rows. */
  people: number;
  dialable: number;
  skippedNoPhone: number;
  skippedDnd: number;
  /** Extra opportunity rows collapsed because one person held several in this stage. */
  duplicatesMerged: number;
  /** True when the stage was larger than MAX_STAGE_CONTACTS and the result is partial. */
  truncated: boolean;
}

/** A single load is capped. Nothing legitimate needs more, and it bounds the query. */
const MAX_STAGE_CONTACTS = 2000;

export async function getDialableStageContacts(
  pipelineId: string,
  stageId: string,
): Promise<{ contacts: StageContact[]; counts: StageCounts }> {
  const rows = await db().execute<{
    contact_id: string | null;
    contact_name: string | null;
    phone: string | null;
    dnd: boolean | null;
  }>(sql`
    SELECT o.contact_id,
           -- The PERSON's name. Never o.name: that is the DEAL title ("Shop Hazel Lane -
           -- Email Retainer"), and it would be shown to the rep as the callee while they are
           -- live on the phone.
           coalesce(
             o.contact_name,
             c.full_name,
             nullif(trim(concat_ws(' ', c.first_name, c.last_name)), '')
           ) AS contact_name,
           -- Contact first: local_contacts.phone is refreshed by every ContactUpdate webhook,
           -- while local_opportunities.contact_phone only moves when the OPPORTUNITY re-syncs,
           -- so it can hold a number the person changed hours ago.
           coalesce(c.phone, o.contact_phone) AS phone,
           c.dnd
      FROM local_opportunities o
      LEFT JOIN local_contacts c ON c.id = o.contact_id
     WHERE o.pipeline_id = ${pipelineId}
       -- Stage read the way the BOARD reads it (lib/pipeline/mirror-source.ts renders from
       -- raw_data and skips rows without it), so the queue is exactly the set Kelsey is
       -- looking at. No column fallback: including rows the board hides would make the count
       -- disagree with her screen.
       AND o.raw_data->>'pipelineStageId' = ${stageId}
       AND o.deleted_in_ghl_at IS NULL
       AND o.status = 'open'
       AND o.contact_id IS NOT NULL
     ORDER BY o.created_at_ghl DESC NULLS LAST
     LIMIT ${MAX_STAGE_CONTACTS}
  `);

  const all = rows.rows ?? [];

  // Classify each PERSON once. Counting opportunity rows instead produces contradictions:
  // someone with two deals, one missing a phone, would be reported as both queued and
  // "skipped, no phone number" in the same breath.
  const byContact = new Map<string, { name: string | null; phone: string | null; dnd: boolean }>();
  let duplicatesMerged = 0;
  for (const r of all) {
    const id = r.contact_id!;
    const existing = byContact.get(id);
    if (existing) {
      duplicatesMerged++;
      // Keep the best information across that person's rows.
      if (!existing.phone && r.phone?.trim()) existing.phone = r.phone;
      if (!existing.name && r.contact_name) existing.name = r.contact_name;
      existing.dnd = existing.dnd || !!r.dnd;
      continue;
    }
    byContact.set(id, { name: r.contact_name, phone: r.phone, dnd: !!r.dnd });
  }

  const contacts: StageContact[] = [];
  let skippedNoPhone = 0;
  let skippedDnd = 0;

  for (const [contactId, p] of byContact) {
    // Do-not-contact is checked HERE and nowhere else in the dialer, which is the point:
    // adding people by hand meant a human saw the red "Do not contact" marker on the contact
    // row first. Loading a whole stage removes that human, so the rule has to move into the
    // query that replaces them.
    if (p.dnd) { skippedDnd++; continue; }
    const phone = (p.phone ?? "").trim();
    if (!phone) { skippedNoPhone++; continue; }
    contacts.push({ contactId, contactName: p.name, phone });
  }

  return {
    contacts,
    counts: {
      people: byContact.size,
      dialable: contacts.length,
      skippedNoPhone,
      skippedDnd,
      duplicatesMerged,
      truncated: all.length === MAX_STAGE_CONTACTS,
    },
  };
}
