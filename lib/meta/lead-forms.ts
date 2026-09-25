/**
 * The real questions on a Meta lead form.
 *
 * WHY THIS EXISTS, because the obvious alternatives are both wrong:
 *
 * 1. De-snake-casing the field key gives a question NOBODY WAS ASKED. The key
 *    `how_much_revenue_does_your_store_generate_monthly?` renders as "How much revenue does
 *    your store generate monthly?" — but on form 1743802753464547 that field's real label is
 *    "What is your brand doing in annual revenue?", and on form 2089751008240489 the SAME key
 *    reads "Where is your brand right now?". One key, different questions per form. Any answer
 *    derived from the key alone is fiction.
 *
 * 2. GHL's custom-field names are paraphrases, not the questions. GHL calls one field
 *    "What's your current email situation?" where the form actually asked "Who runs your email
 *    right now?". Two of them are pure operator shorthand ("Revenue Range", "Open Text Field").
 *
 * So the questions come from Meta, per form, and answers are matched to them by their OPTION
 * VALUES — see lib/leads/question-labels.ts. Requires `pages_manage_ads`, granted 2026-08-07.
 */
import { db } from "@/lib/db";
import { metaPages } from "@/lib/db/schema";

const GRAPH_VERSION = "v25.0";

export interface FormQuestion {
  /** Meta's field key, e.g. `what_platform_are_you_on?` */
  key: string;
  /** The exact text the lead read. This is the only trustworthy question source. */
  label: string;
  /** FULL_NAME | EMAIL | PHONE | WEBSITE | CUSTOM — identity types are shown in the header. */
  type: string;
  /** Present for multiple-choice questions. The key to matching a stored answer back. */
  options: string[];
}

export interface LeadForm {
  id: string;
  name: string;
  questions: FormQuestion[];
}

/**
 * Cached for an hour. Forms change when Gage builds a new one, which is weekly at most, and
 * the Leads Centre would otherwise hit Graph once per form per page load.
 *
 * A form that fails to load is cached as `null` for the same hour, deliberately: without it a
 * revoked token or a deleted form would re-request on every render and stall the feed.
 */
const cache = new Map<string, { at: number; form: LeadForm | null }>();
const TTL_MS = 60 * 60 * 1000;

let tokenCache: { at: number; token: string | null } | null = null;

async function pageToken(): Promise<string | null> {
  if (tokenCache && Date.now() - tokenCache.at < TTL_MS) return tokenCache.token;
  try {
    const [page] = await db().select({ token: metaPages.pageAccessToken }).from(metaPages).limit(1);
    tokenCache = { at: Date.now(), token: page?.token ?? null };
  } catch (err) {
    console.error("[lead-forms] could not read page token:", err);
    tokenCache = { at: Date.now(), token: null };
  }
  return tokenCache.token;
}

/** Fetch one form's questions. Never throws — a Graph blip must not blank the drawer. */
async function fetchForm(formId: string, token: string): Promise<LeadForm | null> {
  const fields = "id,name,questions.fields(key,label,type,options)";
  const url =
    `https://graph.facebook.com/${GRAPH_VERSION}/${formId}` +
    `?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch(url);
    const body = (await res.json()) as {
      id?: string;
      name?: string;
      questions?: { key?: string; label?: string; type?: string; options?: { value?: string }[] }[];
      error?: { message?: string };
    };
    if (body.error || !body.id) {
      console.error(`[lead-forms] ${formId}: ${body.error?.message ?? "no id returned"}`);
      return null;
    }
    return {
      id: body.id,
      name: body.name ?? formId,
      questions: (body.questions ?? [])
        .filter((q) => q.key && q.label)
        .map((q) => ({
          key: q.key!,
          label: q.label!,
          type: q.type ?? "CUSTOM",
          options: (q.options ?? []).map((o) => o.value).filter((v): v is string => Boolean(v)),
        })),
    };
  } catch (err) {
    console.error(`[lead-forms] ${formId} fetch failed:`, err);
    return null;
  }
}

/**
 * Every question across every lead form on the page, as one option-value index.
 *
 * WHY: a lead's own form is not always fetchable. Some carry a form id Meta will not return
 * (deleted, or owned by another page), and GHL sometimes stores its own alphanumeric id in
 * `mediumId` instead of Meta's. Those leads still answered a real question — "Founder, doing
 * it myself" is an option of "Who runs your email right now?" on the forms we CAN read, and
 * Gage reuses the same question set across form versions.
 *
 * A value claimed by two DIFFERENT question texts anywhere in the library is dropped, so this
 * only ever resolves answers whose question is unambiguous account-wide. Same rule as the
 * per-form index, applied one scope wider.
 *
 * Built lazily and cached for an hour: it costs one listing plus ~30 form reads, and is only
 * needed when a lead's own form could not be resolved.
 */
let libraryCache: { at: number; index: Map<string, string> } | null = null;

export async function getFormLibraryIndex(): Promise<Map<string, string>> {
  if (libraryCache && Date.now() - libraryCache.at < TTL_MS) return libraryCache.index;

  const empty = new Map<string, string>();
  const token = await pageToken();
  if (!token) return empty;

  try {
    const listUrl =
      `https://graph.facebook.com/${GRAPH_VERSION}/me/leadgen_forms` +
      `?fields=id&limit=100&access_token=${encodeURIComponent(token)}`;
    const listRes = await fetch(listUrl);
    const list = (await listRes.json()) as { data?: { id?: string }[]; error?: { message?: string } };
    if (list.error || !list.data) {
      console.error(`[lead-forms] library listing failed: ${list.error?.message ?? "no data"}`);
      libraryCache = { at: Date.now(), index: empty };
      return empty;
    }

    const ids = list.data.map((f) => f.id).filter((id): id is string => Boolean(id));
    const forms = (await Promise.all(ids.map((id) => fetchForm(id, token)))).filter(
      (f): f is LeadForm => Boolean(f),
    );

    // value -> the set of DISTINCT question texts claiming it. Ambiguous values are dropped.
    const claims = new Map<string, Set<string>>();
    for (const form of forms) {
      for (const q of form.questions) {
        if (!q.options.length) continue;
        for (const opt of q.options) {
          const key = opt.trim().toLowerCase();
          if (!key) continue;
          const set = claims.get(key) ?? new Set<string>();
          set.add(q.label);
          claims.set(key, set);
        }
      }
    }
    const index = new Map<string, string>();
    for (const [value, labels] of claims) {
      if (labels.size === 1) index.set(value, [...labels][0]);
    }

    console.log(`[lead-forms] library index: ${forms.length} forms, ${index.size} unambiguous answers`);
    libraryCache = { at: Date.now(), index };
    return index;
  } catch (err) {
    console.error("[lead-forms] library index failed:", err);
    libraryCache = { at: Date.now(), index: empty };
    return empty;
  }
}

/**
 * Resolve many form ids at once, for one page of leads.
 *
 * Forms are fetched CONCURRENTLY. A page of 50 leads typically spans 2-4 distinct forms, so
 * this is a handful of requests, and doing them in series would add latency for no reason.
 */
export async function getLeadForms(formIds: (string | null | undefined)[]): Promise<Map<string, LeadForm>> {
  const out = new Map<string, LeadForm>();

  // Meta form ids are numeric. GHL's `mediumId` sometimes carries its own alphanumeric id
  // (e.g. "M76E0edO2ZfonEXiQ5bf") for non-Meta sources — requesting those returns a
  // guaranteed error, so they are filtered out rather than burning a round trip each.
  const ids = [...new Set(formIds.filter((id): id is string => Boolean(id) && /^\d+$/.test(id!)))];
  if (!ids.length) return out;

  const now = Date.now();
  const fresh = ids.filter((id) => {
    const hit = cache.get(id);
    if (hit && now - hit.at < TTL_MS) {
      if (hit.form) out.set(id, hit.form);
      return false;
    }
    return true;
  });

  if (!fresh.length) return out;

  const token = await pageToken();
  if (!token) {
    console.error("[lead-forms] no Meta page token stored — falling back to GHL labels");
    return out;
  }

  const fetched = await Promise.all(fresh.map((id) => fetchForm(id, token)));
  fresh.forEach((id, i) => {
    const form = fetched[i];
    cache.set(id, { at: Date.now(), form });
    if (form) out.set(id, form);
  });

  return out;
}
