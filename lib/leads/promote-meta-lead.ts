/**
 * Promote a Meta/TikTok conversation into a REAL GoHighLevel lead when a demo is
 * submitted: create a GHL contact + an opportunity in the Email Design Demo Pipeline
 * (AD FUNNEL), at the "Demo In Progress" stage, tagged with the platform source.
 *
 * Mirrors the proven create pattern in app/api/ghl/contacts/create/route.ts. The local
 * mirror (the social_leads row + its ghl_contact_id / ghl_opportunity_id) is written by
 * the caller (the demo webhook), so this stays a single-purpose GHL writer.
 */
import { ghl, locationId } from "@/lib/ghl/client";

// Email Design Demo Pipeline (AD FUNNEL) + its "Demo In Progress" stage. These are the
// same IDs the demo-in-progress route uses for this pipeline.
export const AD_FUNNEL_PIPELINE_ID = "JRvrpfcwAlAOM38mPAUJ";
export const AD_FUNNEL_DEMO_IN_PROGRESS_STAGE = "ffd18e7a-a59e-4a13-894d-d5371d0bfc90";

export type MetaPlatform = "facebook" | "instagram" | "tiktok";

export interface PromoteMetaLeadInput {
  /** Full display name (we split into first/last for GHL). */
  name: string;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  /** Normalized platform — drives local source attribution. */
  platform: MetaPlatform;
  /** Human source label shown on the GHL opportunity (e.g. the demo form's Lead Source). */
  source?: string | null;
}

export interface PromoteMetaLeadResult {
  contactId: string;
  opportunityId: string;
}

function splitName(full: string): { firstName: string; lastName?: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  const firstName = parts.shift() || "Lead";
  const lastName = parts.length ? parts.join(" ") : undefined;
  return { firstName, lastName };
}

export async function promoteMetaLeadToGhl(
  input: PromoteMetaLeadInput,
): Promise<PromoteMetaLeadResult> {
  const { firstName, lastName } = splitName(input.name);
  const source = (input.source && input.source.trim()) || input.platform;

  const { contact } = await ghl.post<{ contact: { id: string } }>("/contacts", {
    firstName,
    lastName,
    email: input.email?.trim() || undefined,
    phone: input.phone?.trim() || undefined,
    website: input.website?.trim() || undefined,
    locationId: locationId(),
  });

  const { opportunity } = await ghl.post<{ opportunity: { id: string } }>("/opportunities", {
    pipelineId: AD_FUNNEL_PIPELINE_ID,
    pipelineStageId: AD_FUNNEL_DEMO_IN_PROGRESS_STAGE,
    locationId: locationId(),
    contactId: contact.id,
    name: input.name?.trim() || `${firstName} ${lastName ?? ""}`.trim(),
    source,
    monetaryValue: 0,
    status: "open",
  });

  return { contactId: contact.id, opportunityId: opportunity.id };
}
