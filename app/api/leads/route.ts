import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, ilike, inArray, or, sql as raw } from "drizzle-orm";
import { db } from "@/lib/db";
import { localContacts, socialLeads, facebookLeads, metaLeads, META_LEAD_STAGES } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { buildAnswers } from "@/lib/leads/question-labels";
import { getGhlFieldLabels } from "@/lib/leads/ghl-field-labels";
import { getLeadForms, getFormLibraryIndex } from "@/lib/meta/lead-forms";

export const dynamic = "force-dynamic";

/**
 * Leads Centre feed.
 *
 * SOURCE OF TRUTH IS GHL (local_contacts), never facebook_leads. Leads arrive through GHL's
 * Facebook integration; facebook_leads is a side-store whose only job is carrying Meta's
 * 15-17 digit lead id, which GHL does not pass through. We LEFT JOIN it on email purely to
 * enrich. It must never create a row, or the same person appears twice — exactly the
 * duplication Jack ruled out.
 *
 * "Meta-attributed" means GHL recorded a Facebook ad id in the contact's attribution blob.
 * We match on the presence of utmAdId rather than a hardcoded form or campaign id, so Gage
 * can create, rename or retire forms freely without anything here breaking.
 */

const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const tab = searchParams.get("tab") === "comments" ? "comments" : "form";
  const stage = searchParams.get("stage");
  const search = searchParams.get("q")?.trim() ?? "";
  const page = Math.max(0, Number(searchParams.get("page") ?? 0));

  if (tab === "comments") return commentLeads({ search, page });
  return formLeads({ stage, search, page });
}

/** Meta lead-ads leads, as GHL delivered them. */
async function formLeads(opts: { stage: string | null; search: string; page: number }) {
  const database = db();

  // Meta attribution lives in GHL's raw payload. Presence of an ad id == came from a Meta ad.
  const isMetaLead = raw`${localContacts.rawData}::text ILIKE '%"utmAdId"%'`;

  const where = [isMetaLead];
  if (opts.stage && (META_LEAD_STAGES as readonly string[]).includes(opts.stage)) {
    where.push(eq(localContacts.metaLeadStage, opts.stage));
  } else if (opts.stage === "untriaged") {
    where.push(raw`${localContacts.metaLeadStage} IS NULL`);
  } else if (opts.stage) {
    // Fail loudly. Silently ignoring an unknown stage returns EVERY lead, which reads as
    // "this stage has 553 leads" — a wrong answer is worse than an error.
    throw new Error(`unknown stage: ${opts.stage}`);
  }
  if (opts.search) {
    const term = `%${opts.search}%`;
    where.push(
      or(
        ilike(localContacts.fullName, term),
        ilike(localContacts.email, term),
        ilike(localContacts.phone, term),
      )!,
    );
  }

  const rows = await database
    .select({
      id: localContacts.id,
      ghlId: localContacts.locationId,
      fullName: localContacts.fullName,
      email: localContacts.email,
      phone: localContacts.phone,
      companyName: localContacts.companyName,
      website: localContacts.website,
      customFields: localContacts.customFields,
      rawData: localContacts.rawData,
      createdAtGhl: localContacts.createdAtGhl,
      stage: localContacts.metaLeadStage,
      stageAt: localContacts.metaLeadStageAt,
      capiStatus: localContacts.capiStatus,
      capiSentAt: localContacts.capiSentAt,
      capiError: localContacts.capiError,
      // facebook_leads enrichment is fetched SEPARATELY, below. See enrichWithMetaLeads.
    })
    .from(localContacts)
    .where(and(...where))
    .orderBy(desc(localContacts.createdAtGhl))
    .limit(PAGE_SIZE)
    .offset(opts.page * PAGE_SIZE);

  // Resolve GHL custom-field ids to their names once per request (cached). These are only a
  // fallback for fields that belong to no form question — see lib/leads/question-labels.ts.
  const ghlLabels = await getGhlFieldLabels();
  const metaByEmail = await enrichWithMetaLeads(rows.map((r) => r.email));

  // The real questions, per form, for every form represented on this page. Cached an hour.
  const attributions = rows.map((r) => pickAttribution(r.rawData));
  const forms = await getLeadForms(attributions.map((a) => a.formId));

  // Only pay for the account-wide index when some lead on this page needs it.
  const needsLibrary = attributions.some((a) => !a.formId || !forms.has(a.formId));
  const libraryIndex = needsLibrary ? await getFormLibraryIndex() : undefined;

  const leads = rows.map((r, i) => {
    const attribution = attributions[i];
    const meta = r.email ? metaByEmail.get(r.email.toLowerCase()) : undefined;
    const form = attribution.formId ? forms.get(attribution.formId) : undefined;
    return {
      id: r.id,
      name: r.fullName || r.email || "Unknown",
      email: r.email,
      phone: r.phone,
      company: r.companyName,
      website: r.website,
      createdAt: r.createdAtGhl,
      stage: r.stage,
      stageAt: r.stageAt,
      // The signal receipt. Surfaced so a failed send is visible, never silent.
      capi: { status: r.capiStatus, sentAt: r.capiSentAt, error: r.capiError },
      // Present only when the leadgen webhook caught it. Exact CAPI matching depends on it.
      metaLeadId: meta?.leadgenId ?? null,
      source: attribution.adId ? "Paid" : "Organic",
      campaign: attribution.campaign,
      adName: attribution.adName,
      formId: attribution.formId,
      // Meta's own form name beats facebook_leads', which is frequently null.
      formName: form?.name ?? meta?.formName ?? null,
      answers: buildAnswers(form, meta?.fieldData ?? null, r.customFields, ghlLabels, libraryIndex),
    };
  });

  /**
   * Stage rail counts — from the META MIRROR, so they are Meta's numbers by construction.
   *
   * These used to be a GROUP BY over local_contacts, which could never agree with Meta: 162
   * of Meta's 711 leads are organic Instagram/Messenger submissions with no email and no
   * phone, so they are not GHL contacts and no stage could ever be stored for them. Intake
   * read 9 against Meta's 16 and Converted 135 against 187 — not a filter bug, a population
   * one. meta_leads holds Meta's own rows verbatim (scripts/import-meta-leads.mjs).
   *
   * `untriaged` still comes from local_contacts: it means "a Meta-attributed lead WE have
   * that Meta's last export did not carry" — post-cutover arrivals, which belong on the page
   * even though Meta has not been re-exported since.
   */
  const [mirrorCounts, untriagedRow] = await Promise.all([
    database
      .select({ stage: metaLeads.stage, n: raw<number>`count(*)::int` })
      .from(metaLeads)
      .groupBy(metaLeads.stage),
    database
      .select({ n: raw<number>`count(*)::int` })
      .from(localContacts)
      .where(and(isMetaLead, raw`${localContacts.metaLeadStage} IS NULL`)),
  ]);

  const countsOut: Record<string, number> = Object.fromEntries(
    mirrorCounts.map((c) => [c.stage, c.n]),
  );
  const untriaged = untriagedRow[0]?.n ?? 0;
  if (untriaged > 0) countsOut.untriaged = untriaged;

  return NextResponse.json({
    leads,
    counts: countsOut,
    page: opts.page,
    hasMore: rows.length === PAGE_SIZE,
  });
}

interface MetaLeadEnrichment {
  leadgenId: string | null;
  fieldData: unknown;
  formName: string | null;
}

/**
 * Look up the Meta lead record for a page of contacts, keyed by email.
 *
 * THIS REPLACES A CORRELATED SUBQUERY THAT SILENTLY RETURNED THE WRONG ROW FOR EVERY LEAD.
 *
 * The original was `WHERE LOWER(fl.email) = LOWER(${localContacts.email})` inside a raw
 * fragment. The outer column rendered UNQUALIFIED, and because `facebook_leads` also has an
 * `email` column, Postgres resolved the bare `email` to the INNER table. The predicate became
 * `LOWER(fl.email) = LOWER(fl.email)` — true for every row — so all 553 contacts inherited
 * whichever facebook_leads row was newest. In production that was a Meta test lead, so every
 * single lead in the Leads Centre displayed `<test lead: dummy data for ...>` as its answers.
 *
 * It did not throw, did not log, and returned a plausible-looking id. That is exactly the
 * class of failure this codebase has been bitten by before.
 *
 * An explicit keyed fetch is used instead of "the same subquery but aliased" because the bug
 * was one of implicit scope. There is no scope to get wrong here: one query, one map, and the
 * join happens in TypeScript where it is visible.
 */
async function enrichWithMetaLeads(emails: (string | null)[]): Promise<Map<string, MetaLeadEnrichment>> {
  const out = new Map<string, MetaLeadEnrichment>();
  const keys = [...new Set(emails.filter(Boolean).map((e) => e!.toLowerCase()))];
  if (!keys.length) return out;

  // DISTINCT ON keeps the newest submission per email. facebook_leads.email is NOT unique
  // (only leadgen_id is), so without this a person who submitted twice yields two rows.
  const rows = await db()
    .select({
      email: facebookLeads.email,
      leadgenId: facebookLeads.leadgenId,
      fieldData: facebookLeads.fieldData,
      formName: facebookLeads.formName,
    })
    .from(facebookLeads)
    // inArray, NOT `= ANY(${keys})`. Drizzle expands a JS array into a tuple `($1, $2, ...)`,
    // which Postgres rejects for ANY with "op ANY/ALL (array) requires array on right side".
    // (The raw neon driver DOES bind arrays natively, so this passes in a scratch script and
    // fails in the app — verify array predicates through Drizzle, not the driver.)
    .where(inArray(raw`LOWER(${facebookLeads.email})`, keys))
    .orderBy(raw`LOWER(${facebookLeads.email})`, desc(facebookLeads.createdTime));

  for (const r of rows) {
    if (!r.email) continue;
    const key = r.email.toLowerCase();
    // First row per email wins — the ORDER BY already put the newest submission first.
    if (out.has(key)) continue;
    out.set(key, { leadgenId: r.leadgenId, fieldData: r.fieldData, formName: r.formName });
  }
  return out;
}

/** Comment leads. Deliberately NOT pipeline leads until a demo is submitted. */
async function commentLeads(opts: { search: string; page: number }) {
  const where = opts.search
    ? [or(ilike(socialLeads.name, `%${opts.search}%`), ilike(socialLeads.commentText, `%${opts.search}%`))!]
    : [];

  const rows = await db()
    .select()
    .from(socialLeads)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(socialLeads.createdAt))
    .limit(PAGE_SIZE)
    .offset(opts.page * PAGE_SIZE);

  return NextResponse.json({
    leads: rows.map((r) => ({
      id: r.id,
      name: r.name,
      platform: r.platform,
      commentText: r.commentText,
      keyword: r.keyword,
      email: r.email,
      phone: r.phone,
      website: r.website,
      notes: r.notes,
      contactedAt: r.contactedAt,
      demoStartedAt: r.demoStartedAt,
      // Once promoted to GHL it IS a pipeline lead; the UI marks that clearly.
      promoted: Boolean(r.ghlContactId),
      createdAt: r.createdAt,
    })),
    page: opts.page,
    hasMore: rows.length === PAGE_SIZE,
  });
}

/** GHL stores attribution as an array of touches; the LAST touch is the one that converted. */
function pickAttribution(rawData: unknown): {
  adId: string | null;
  campaign: string | null;
  adName: string | null;
  formId: string | null;
} {
  const empty = { adId: null, campaign: null, adName: null, formId: null };
  if (!rawData || typeof rawData !== "object") return empty;
  const blob = rawData as Record<string, unknown>;
  const list = Array.isArray(blob.attributions)
    ? (blob.attributions as Record<string, string>[])
    : blob.attributionSource
    ? [blob.attributionSource as Record<string, string>]
    : [];
  if (!list.length) return empty;
  const last = list.find((a) => a.isLast) ?? list[list.length - 1];
  return {
    adId: last.utmAdId ?? null,
    campaign: last.utmCampaign ?? null,
    adName: last.utmContent ?? null,
    // GHL carries Meta's lead FORM id here. Verified against Jeremy Conti's record.
    formId: last.mediumId ?? null,
  };
}
