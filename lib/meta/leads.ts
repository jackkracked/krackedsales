/**
 * Facebook / Instagram Lead Ads ingestion.
 *
 * The leadgen webhook only hands us a `leadgen_id` (plus page/form ids). The actual
 * person (name, email, phone) and its campaign/ad must be fetched from the Graph API
 * with a Page access token that has `leads_retrieval`. This module does that fetch,
 * flattens Meta's field_data into name/email/phone, and upserts one row per lead,
 * deduped on `leadgen_id` because Meta redelivers webhooks.
 *
 * Reuses the existing Meta client + connected-page tokens (lib/meta/client.ts,
 * meta_pages table). No new token mechanism.
 */
import { db } from "@/lib/db";
import { facebookLeads } from "@/lib/db/schema";
import { metaForPage, getPageToken } from "@/lib/meta/client";

/** One answer in Meta's lead form payload. */
type LeadField = { name: string; values: string[] };

/** The lead node as returned by GET /{leadgen_id}. */
export interface MetaLead {
  id: string;
  created_time?: string;
  ad_id?: string;
  ad_name?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  form_id?: string;
  platform?: string; // "fb" | "ig" | "instagram"
  is_organic?: boolean;
  field_data?: LeadField[];
}

const LEAD_FIELDS =
  "id,created_time,ad_id,ad_name,adset_name,campaign_id,campaign_name,form_id,platform,is_organic,field_data";

/** First value for any of the given field-name candidates (case-insensitive, prefix-tolerant). */
function pickField(fields: LeadField[], candidates: string[]): string | null {
  for (const cand of candidates) {
    const hit = fields.find((f) => f.name?.toLowerCase() === cand);
    if (hit?.values?.length) return hit.values[0] || null;
  }
  // Fallback: prefix match (Meta sometimes suffixes custom question ids).
  for (const cand of candidates) {
    const hit = fields.find((f) => f.name?.toLowerCase().startsWith(cand));
    if (hit?.values?.length) return hit.values[0] || null;
  }
  return null;
}

/** Flatten Meta's field_data into a human name (handles full_name vs first/last). */
export function leadFullName(fields: LeadField[]): string | null {
  const full = pickField(fields, ["full_name", "name"]);
  if (full) return full;
  const first = pickField(fields, ["first_name"]);
  const last = pickField(fields, ["last_name"]);
  const joined = [first, last].filter(Boolean).join(" ").trim();
  return joined || null;
}

/** Normalise Meta's platform code to our stored value. */
function normalizePlatform(platform?: string): "facebook" | "instagram" {
  const p = (platform ?? "").toLowerCase();
  return p === "ig" || p === "instagram" ? "instagram" : "facebook";
}

/**
 * Persist a fetched lead. Deduped on leadgen_id (Meta redelivers), so this is safe
 * to call repeatedly. Returns true if a new row was inserted.
 */
export async function upsertFacebookLead(
  lead: MetaLead,
  ctx: { pageId?: string; pageName?: string } = {},
): Promise<boolean> {
  const fields = lead.field_data ?? [];
  const inserted = await db()
    .insert(facebookLeads)
    .values({
      leadgenId: lead.id,
      formId: lead.form_id ?? null,
      pageId: ctx.pageId ?? null,
      pageName: ctx.pageName ?? null,
      platform: normalizePlatform(lead.platform),
      campaignId: lead.campaign_id ?? null,
      campaignName: lead.campaign_name ?? null,
      adsetName: lead.adset_name ?? null,
      adName: lead.ad_name ?? null,
      fullName: leadFullName(fields),
      email: pickField(fields, ["email"]),
      phone: pickField(fields, ["phone_number", "phone"]),
      fieldData: fields,
      isOrganic: Boolean(lead.is_organic),
      createdTime: lead.created_time ? new Date(lead.created_time) : new Date(),
    })
    .onConflictDoNothing({ target: facebookLeads.leadgenId })
    .returning({ id: facebookLeads.id });
  return inserted.length > 0;
}

/**
 * Fetch a single lead by its leadgen_id using the page's token, then store it.
 * Called from the webhook. Never throws into the caller.
 */
export async function ingestLeadgen(params: {
  leadgenId: string;
  pageId?: string;
}): Promise<boolean> {
  try {
    // Meta lead ids are numeric, reject anything else so a crafted id can't
    // inject extra path/query segments into the Graph call.
    if (!/^\d+$/.test(params.leadgenId)) {
      console.warn("[meta/leads] Ignoring non-numeric leadgen id:", params.leadgenId);
      return false;
    }
    const token = await getPageToken(params.pageId);
    const lead = await metaForPage(token).get<MetaLead>(`/${params.leadgenId}`, {
      fields: LEAD_FIELDS,
    });
    return await upsertFacebookLead(lead, { pageId: params.pageId });
  } catch (err) {
    console.error(`[meta/leads] ingestLeadgen(${params.leadgenId}) failed:`, err);
    return false;
  }
}

type LeadForm = { id: string; name?: string };

/** All lead forms on a page. */
export async function listPageForms(pageId: string, token: string): Promise<LeadForm[]> {
  return metaForPage(token).paginate<LeadForm>(`/${pageId}/leadgen_forms`, { fields: "id,name" });
}

/**
 * Backfill historical leads for one connected page so the drawer is populated the
 * moment Lead Ads is connected (rather than empty until the next new submission).
 * Walks every form on the page and upserts each lead. Returns how many NEW leads
 * were stored. Best-effort: a failing form is logged and skipped.
 */
export async function backfillPageLeads(page: {
  pageId: string;
  pageName?: string | null;
  pageAccessToken: string;
}): Promise<{ inserted: number; forms: number }> {
  let inserted = 0;
  let forms = 0;
  const client = metaForPage(page.pageAccessToken);
  const formList = await listPageForms(page.pageId, page.pageAccessToken).catch((err) => {
    console.error(`[meta/leads] listPageForms(${page.pageId}) failed:`, err);
    return [] as LeadForm[];
  });
  for (const form of formList) {
    forms++;
    try {
      const leads = await client.paginate<MetaLead>(`/${form.id}/leads`, { fields: LEAD_FIELDS });
      for (const lead of leads) {
        const isNew = await upsertFacebookLead(
          { ...lead, form_id: lead.form_id ?? form.id },
          { pageId: page.pageId, pageName: page.pageName ?? undefined },
        );
        if (isNew) inserted++;
      }
    } catch (err) {
      console.error(`[meta/leads] backfill form ${form.id} failed:`, err);
    }
  }
  return { inserted, forms };
}
