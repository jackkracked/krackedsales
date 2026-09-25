/**
 * Turning a lead's stored answers back into the EXACT questions they were asked.
 *
 * The requirement (Jack, 2026-08-07): "whichever questions are asked on that form relevant to
 * that lead should be shown in that sidebar, like the exact questions and the exact answers."
 *
 * Exact is the hard word, and two plausible shortcuts both produce questions nobody was asked:
 *
 *   1. De-snake-casing Meta's field KEY. The key
 *      `how_much_revenue_does_your_store_generate_monthly?` renders as "How much revenue does
 *      your store generate monthly?", but on form 1743802753464547 that field's real label is
 *      "What is your brand doing in annual revenue?" and on form 2089751008240489 the SAME key
 *      reads "Where is your brand right now?". One key, different questions per form.
 *
 *   2. GHL's custom-field name. GHL calls one field "What's your current email situation?"
 *      where the form actually asked "Who runs your email right now?" — a different question
 *      with a different meaning. Jack, explicitly: "Who runs your email right now is not the
 *      same as what's your current email situation."
 *
 * So THE FORM IS THE SOURCE OF TRUTH. This module iterates the form's questions and fills in
 * the answers, rather than iterating stored answers and captioning them. A stored answer that
 * cannot be tied to a real question is never given one; it is returned separately as a CRM
 * field so the UI can show it honestly instead of dressing it up as form Q&A.
 *
 * Answers are tied to questions by OPTION VALUE: "Ready to move now" is an option of exactly
 * one question on the form. Provable, not fuzzy. Verified against Vynka Greenhalgh, where it
 * resolved every multiple-choice answer to its exact question including the two GHL stored
 * under operator shorthand ("Revenue Range", "Open Text Field").
 */
import type { LeadForm, FormQuestion } from "@/lib/meta/lead-forms";

export interface Answer {
  /** The exact question text from the form. Never a key, never an id, never a paraphrase. */
  question: string;
  /** What the lead said. */
  answer: string;
  /**
   * form — the question is verbatim from the Meta form this lead submitted
   * crm  — no form question could be proven; this is a GHL field name, shown separately
   */
  source: "form" | "crm";
}

type MetaField = { name?: string; values?: string[] };
type GhlField = { id?: string; value?: unknown };

/** Identity fields live in the drawer header; repeating them as Q&A is noise. */
const IDENTITY_TYPES = new Set(["FULL_NAME", "EMAIL", "PHONE", "WEBSITE"]);
const IDENTITY_KEYS = /^(full_name|first_name|last_name|email|phone_number|phone|city|state|country|zip|post_code)$/i;

/** GHL names that are operator shorthand rather than anything a lead ever read. */
const SHORTHAND = /^(open text field|revenue range( fb)?|untitled|custom field|single line|text field|brand name|companyname|job title|booked call)$/i;

/**
 * Index a form's option values to the question that owns them.
 *
 * A value claimed by MORE THAN ONE question is dropped, not guessed. "Yes" belongs to every
 * yes/no question on a form; attributing it to the wrong one would be precisely the
 * confident-and-wrong failure this file exists to prevent.
 */
function indexOptions(form: LeadForm): Map<string, FormQuestion> {
  const claims = new Map<string, FormQuestion[]>();
  for (const q of form.questions) {
    if (IDENTITY_TYPES.has(q.type)) continue;
    for (const opt of q.options) {
      const key = opt.trim().toLowerCase();
      if (!key) continue;
      const list = claims.get(key);
      if (list) list.push(q);
      else claims.set(key, [q]);
    }
  }
  const unique = new Map<string, FormQuestion>();
  for (const [value, questions] of claims) {
    if (questions.length === 1) unique.set(value, questions[0]);
  }
  return unique;
}

function readValue(raw: unknown): string {
  const value = Array.isArray(raw) ? raw.filter(Boolean).join(", ") : String(raw ?? "");
  return value.trim();
}

/**
 * Build the answer list for one lead's drawer.
 *
 * @param form             the Meta form THIS lead submitted, when we could resolve it
 * @param metaFieldData    facebook_leads.field_data — present only for webhook-caught leads
 * @param ghlCustomFields  local_contacts.custom_fields — the source for every GHL lead
 * @param ghlLabels        GHL custom-field id -> name, fetched once per request and cached
 */
export function buildAnswers(
  form: LeadForm | null | undefined,
  metaFieldData: unknown,
  ghlCustomFields: unknown,
  ghlLabels: Record<string, string> = {},
  /**
   * Option value -> question text, across every form on the account. Used only when this
   * lead's own form could not be fetched (deleted form, or GHL stored its own id). Values
   * that two different questions claim anywhere in the library are absent from this map, so
   * anything it does resolve is unambiguous account-wide.
   */
  libraryIndex?: Map<string, string>,
): Answer[] {
  // Flatten every stored answer into one pool, then draw from it. Values are consumed as they
  // are matched so a single answer can never caption two different questions.
  const pool: { label: string | null; value: string; used: boolean }[] = [];

  if (Array.isArray(metaFieldData)) {
    for (const f of metaFieldData as MetaField[]) {
      const key = f?.name;
      const value = readValue(f?.values?.filter(Boolean).join(", "));
      if (!key || !value || IDENTITY_KEYS.test(key)) continue;
      pool.push({ label: key, value, used: false });
    }
  }
  if (Array.isArray(ghlCustomFields)) {
    for (const f of ghlCustomFields as GhlField[]) {
      const id = f?.id;
      const value = readValue(f?.value);
      if (!id || !value) continue;
      pool.push({ label: ghlLabels[id] ?? null, value, used: false });
    }
  }

  // No form on file (deleted form, GHL's own id, or a genuinely non-Meta lead). Fall back to
  // the account-wide index: the lead still answered a real question, and an option value that
  // only one question anywhere asks is safe to attribute. Anything left is a CRM field.
  if (!form) {
    if (libraryIndex?.size) {
      const resolved: Answer[] = [];
      for (const entry of pool) {
        const label = libraryIndex.get(entry.value.toLowerCase());
        if (!label || resolved.some((a) => a.question === label)) continue;
        entry.used = true;
        resolved.push({ question: label, answer: entry.value, source: "form" });
      }
      return [...resolved, ...crmOnly(pool)];
    }
    return crmOnly(pool);
  }

  const byOption = indexOptions(form);
  const answers: Answer[] = [];

  // ── Pass 1: exact key match from Meta's own field_data ───────────────────────────────
  for (const q of form.questions) {
    if (IDENTITY_TYPES.has(q.type)) continue;
    const hit = pool.find((p) => !p.used && p.label === q.key);
    if (!hit) continue;
    hit.used = true;
    answers.push({ question: q.label, answer: hit.value, source: "form" });
  }

  // ── Pass 2: the answer is a unique option of exactly one question ────────────────────
  for (const entry of pool) {
    if (entry.used) continue;
    const q = byOption.get(entry.value.toLowerCase());
    if (!q) continue;
    if (answers.some((a) => a.question === q.label)) continue;
    entry.used = true;
    answers.push({ question: q.label, answer: entry.value, source: "form" });
  }

  // ── Pass 3: free-text questions, by elimination ──────────────────────────────────────
  // Only when exactly one free-text question and one unmatched answer remain. Any other ratio
  // is a guess, and a guess here prints the wrong question under a real answer.
  const openQuestions = form.questions.filter(
    (q) =>
      !IDENTITY_TYPES.has(q.type) &&
      !q.options.length &&
      !answers.some((a) => a.question === q.label),
  );
  const unmatched = pool.filter((p) => !p.used);
  if (openQuestions.length === 1 && unmatched.length === 1) {
    unmatched[0].used = true;
    answers.push({ question: openQuestions[0].label, answer: unmatched[0].value, source: "form" });
  }

  // Order as the lead was asked, so the drawer reads like the form they filled in.
  const order = new Map(form.questions.map((q, i) => [q.label, i]));
  answers.sort((a, b) => (order.get(a.question) ?? 1e9) - (order.get(b.question) ?? 1e9));

  // Anything still unmatched is a genuine CRM field (booked-call flags, notes GHL collected
  // outside the form). Shown separately, never as a form question.
  return [...answers, ...crmOnly(pool.filter((p) => !p.used))];
}

/** GHL fields we could not tie to a form question. Labelled with GHL's own name, or dropped. */
function crmOnly(pool: { label: string | null; value: string; used: boolean }[]): Answer[] {
  const out: Answer[] = [];
  const seen = new Set<string>();
  for (const entry of pool) {
    if (entry.used) continue;
    const label = entry.label;
    // A raw field id or operator shorthand tells the reader nothing. Omitting the row is
    // better than captioning a real answer with a meaningless or misleading question.
    if (!label || SHORTHAND.test(label) || /^[A-Za-z0-9]{20,}$/.test(label)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ question: label, answer: entry.value, source: "crm" });
  }
  return out;
}
