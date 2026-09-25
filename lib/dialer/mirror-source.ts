/**
 * lib/dialer/mirror-source.ts
 *
 * Mirror-backed replacements for the two cheap, fully-covered GHL calls the dialer cockpit
 * makes per contact: the contact record (/contacts/{id}) and the contact's opportunity
 * (/opportunities/search?contact_id=). Notes, message history, and custom-field DEFINITIONS
 * stay live (no mirror tables for those yet). Contact is rebuilt from local_contacts.rawData
 * (exact GHL JSON incl. customFields) with a projected-column fallback.
 */
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { localContacts, localOpportunities } from "@/lib/db/schema";

interface GHLContactShape {
  firstName?: string;
  lastName?: string;
  name?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  customFields?: Array<{ id: string; value?: unknown; field_value?: unknown }>;
  dateAdded?: string;
  /** GoHighLevel's own timezone for the contact. Passed through so the dialer can warn before
   *  calling someone in the middle of their night; believed only when it suits their number. */
  timezone?: string;
}

/** Contact for the dialer cockpit, shaped like GHL's /contacts/{id} response. */
export async function getContactFromMirror(contactId: string): Promise<{ contact: GHLContactShape }> {
  const [row] = await db()
    .select({
      rawData: localContacts.rawData,
      fullName: localContacts.fullName,
      firstName: localContacts.firstName,
      lastName: localContacts.lastName,
      companyName: localContacts.companyName,
      email: localContacts.email,
      phone: localContacts.phone,
      tags: localContacts.tags,
      customFields: localContacts.customFields,
      createdAtGhl: localContacts.createdAtGhl,
    })
    .from(localContacts)
    .where(eq(localContacts.id, contactId))
    .limit(1);

  if (!row) return { contact: {} };

  const raw = row.rawData as GHLContactShape | null;
  if (raw && (raw.name || raw.firstName || raw.email || raw.phone)) {
    return { contact: raw };
  }
  // Fallback: reconstruct from projected columns.
  return {
    contact: {
      name: row.fullName ?? undefined,
      firstName: row.firstName ?? undefined,
      lastName: row.lastName ?? undefined,
      companyName: row.companyName ?? undefined,
      email: row.email ?? undefined,
      phone: row.phone ?? undefined,
      tags: (row.tags as string[] | null) ?? [],
      customFields: (row.customFields as GHLContactShape["customFields"]) ?? [],
      dateAdded: row.createdAtGhl?.toISOString(),
    },
  };
}

/** The contact's opportunity (freshest) for the in-cockpit stage move. */
export async function resolveOpportunityFromMirror(
  contactId: string
): Promise<{ opportunityId: string | null; pipelineId: string | null; pipelineStageId: string | null }> {
  const empty = { opportunityId: null, pipelineId: null, pipelineStageId: null };
  const [row] = await db()
    .select({
      id: localOpportunities.id,
      pipelineId: localOpportunities.pipelineId,
      pipelineStageId: localOpportunities.pipelineStageId,
    })
    .from(localOpportunities)
    .where(eq(localOpportunities.contactId, contactId))
    .orderBy(sql`${localOpportunities.updatedAtGhl} desc nulls last`, desc(localOpportunities.syncedAt))
    .limit(1);

  if (!row) return empty;
  return { opportunityId: row.id, pipelineId: row.pipelineId ?? null, pipelineStageId: row.pipelineStageId ?? null };
}
