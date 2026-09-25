/**
 * Promote a Meta/TikTok conversation into a REAL GoHighLevel lead when a demo is submitted.
 *
 * THE RULE THAT MATTERS: never create a contact we already hold.
 *
 * The previous version always did `ghl.post("/contacts")` before creating the opportunity. That
 * is safe for a comment lead who genuinely does not exist in GHL, and a duplicate-contact
 * incident for everyone else. 958 of our contacts arrived via Instagram and ALREADY exist as GHL
 * contacts with no opportunity: they are exactly the people Gage wants to submit demos for, and
 * exactly the people the old code would have duplicated. Pass `existingContactId` whenever the
 * caller knows it (the contact modal, the inbox drawer, the dialer) and contact creation is
 * skipped entirely.
 *
 * Second guard: a contact who already has an OPEN opportunity gets that one returned rather than
 * a second one created. A person should never sit in a pipeline twice.
 *
 * Destination (Jack, 2026-08-24): Email Design Demo Pipeline (ORGANIC FUNNEL), "Demo In
 * Progress". Submitting the demo form is when the WORK STARTS, so it is In Progress, not Sent.
 * Anyone reaching this path has no opportunity yet, which means they never entered the ad funnel
 * regardless of their first-touch attribution.
 */
import { ghl, locationId } from "@/lib/ghl/client";

/** Email Design Demo Pipeline (ORGANIC FUNNEL) + its "Demo In Progress" stage. */
export const ORGANIC_FUNNEL_PIPELINE_ID = "uEefctNze07YOCaGOSNE";
export const ORGANIC_FUNNEL_DEMO_IN_PROGRESS_STAGE = "4e3b0980-9eb9-4d7d-9f4d-cf0dbac04ff8";

/**
 * Email Design Demo Pipeline (AD FUNNEL). Kept for reference only: the demo-in-progress routes
 * hardcode these same literals rather than importing them, so nothing here has an importer.
 */
export const AD_FUNNEL_PIPELINE_ID = "JRvrpfcwAlAOM38mPAUJ";
export const AD_FUNNEL_DEMO_IN_PROGRESS_STAGE = "ffd18e7a-a59e-4a13-894d-d5371d0bfc90";

export type MetaPlatform = "facebook" | "instagram" | "tiktok";

export interface PromoteMetaLeadInput {
  /** Full display name (we split into first/last for GHL). */
  name: string;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  /** Normalized platform when the lead came from a social DM. Null for ordinary contacts. */
  platform?: MetaPlatform | null;
  /** Human source label shown on the GHL opportunity (e.g. the demo form's Lead Source). */
  source?: string | null;
  /**
   * The GHL contact id when the caller already has one. When set, NO contact is created.
   * This is the entire duplicate-prevention mechanism: pass it whenever you know it.
   */
  existingContactId?: string | null;
}

export interface PromoteMetaLeadResult {
  contactId: string;
  opportunityId: string;
  /** True when we reused a contact rather than creating one. */
  reusedContact: boolean;
  /** True when the contact already had an open opportunity and we returned that instead. */
  reusedOpportunity: boolean;
}

function splitName(full: string): { firstName: string; lastName?: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  const firstName = parts.shift() || "Lead";
  const lastName = parts.length ? parts.join(" ") : undefined;
  return { firstName, lastName };
}

/** Thrown when we cannot establish whether the contact already has an opportunity. */
export class OpportunityLookupFailed extends Error {
  constructor(cause: unknown) {
    super(`Could not verify existing opportunities: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "OpportunityLookupFailed";
  }
}

interface OpportunityLite {
  id: string;
  status?: string;
  contact?: { id?: string };
}

/**
 * The contact's existing opportunity, if any.
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT DO, both of which have burned this codebase before:
 *
 * 1. It does not trust `opportunities[0]`. GHL's `contact_id` filter is unreliable, which is
 *    documented in app/api/ghl/contacts/[contactId]/opportunity/route.ts along with the incident
 *    where a positional read pulled ANOTHER client's opportunity and messaged the wrong person.
 *    Every result is re-verified against the contact id before it is trusted. The id returned
 *    here gets WRITTEN to social_leads, so a wrong one is permanent.
 * 2. It does not fail open. If the lookup errors we throw, because "the lookup broke" is not
 *    evidence that no opportunity exists, and guessing wrong creates exactly the duplicate this
 *    whole function exists to prevent.
 *
 * `status` is NOT filtered server-side: a contact whose only opportunity is `won` is still very
 * much in a pipeline, and creating a fresh demo opportunity for an existing customer is wrong.
 */
async function findExistingOpportunity(
  contactId: string,
): Promise<{ id: string; status: string } | null> {
  let res: { opportunities?: OpportunityLite[] };
  try {
    res = await ghl.get<{ opportunities?: OpportunityLite[] }>(
      `/opportunities/search?location_id=${locationId()}&contact_id=${encodeURIComponent(contactId)}&limit=20`,
    );
  } catch (e) {
    throw new OpportunityLookupFailed(e);
  }

  const mine = (res.opportunities ?? []).filter((o) => o?.contact?.id === contactId);
  if (mine.length === 0) return null;

  // An open one always wins: that is the live pipeline entry to reuse.
  const open = mine.find((o) => (o.status ?? "").toLowerCase() === "open");
  if (open) return { id: open.id, status: "open" };

  // Otherwise report the most meaningful terminal state so the caller can decide.
  const won = mine.find((o) => (o.status ?? "").toLowerCase() === "won");
  if (won) return { id: won.id, status: "won" };

  return { id: mine[0].id, status: (mine[0].status ?? "unknown").toLowerCase() };
}

export async function promoteMetaLeadToGhl(
  input: PromoteMetaLeadInput,
): Promise<PromoteMetaLeadResult> {
  const { firstName, lastName } = splitName(input.name);
  const source = (input.source && input.source.trim()) || input.platform || "app";

  // ── 1. Contact: reuse whenever we can ──────────────────────────────────────────────────
  const known = input.existingContactId?.trim() || null;
  let contactId: string;
  if (known) {
    contactId = known;
  } else {
    const { contact } = await ghl.post<{ contact: { id: string } }>("/contacts", {
      firstName,
      lastName,
      email: input.email?.trim() || undefined,
      phone: input.phone?.trim() || undefined,
      website: input.website?.trim() || undefined,
      locationId: locationId(),
    });
    contactId = contact.id;
  }

  // ── 2. Opportunity: never put one person in a pipeline twice ───────────────────────────
  // Throws on lookup failure. The caller treats that as "promotion deferred", never as
  // "no opportunity exists".
  const existing = await findExistingOpportunity(contactId);
  if (existing) {
    // Reuse open AND won. A won deal is a customer, and a customer does not belong back at the
    // top of the demo funnel. A lost one may legitimately re-engage, so that falls through.
    if (existing.status === "open" || existing.status === "won") {
      return {
        contactId,
        opportunityId: existing.id,
        reusedContact: !!known,
        reusedOpportunity: true,
      };
    }
  }

  const { opportunity } = await ghl.post<{ opportunity: { id: string } }>("/opportunities", {
    pipelineId: ORGANIC_FUNNEL_PIPELINE_ID,
    pipelineStageId: ORGANIC_FUNNEL_DEMO_IN_PROGRESS_STAGE,
    locationId: locationId(),
    contactId,
    name: input.name?.trim() || `${firstName} ${lastName ?? ""}`.trim(),
    source,
    monetaryValue: 0,
    status: "open",
  });

  return {
    contactId,
    opportunityId: opportunity.id,
    reusedContact: !!known,
    reusedOpportunity: false,
  };
}
