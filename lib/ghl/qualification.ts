import { cleanUrl, looksLikeUrl, isQualificationNote, parseQualificationNote } from "@/lib/utils/url";

/** Custom field definition from /api/ghl/custom-fields */
export interface FieldDef {
  name: string;
  fieldKey: string;
  folder?: string;
}

/**
 * Legacy custom-field ids that explicitly held the website on OLD GHL forms.
 * Checked by stable id (priority 2) before falling back to URL-shape detection,
 * so an old lead resolves even if the field value is oddly formatted.
 *   te2hH1PWliUW8R18epQn = "Your website"
 *   48zVkYYk45nGYTwIndE0 = "Full Website URL"
 */
export const LEGACY_WEBSITE_FIELD_IDS = ["te2hH1PWliUW8R18epQn", "48zVkYYk45nGYTwIndE0"];

/** Minimal contact shape needed to resolve a website (standard + custom fields). */
export interface WebsiteContact {
  website?: string | null;
  customFields?: Array<{ id: string; field_value?: unknown; value?: unknown }>;
  customField?: Array<{ id: string; field_value?: unknown; value?: unknown }>;
}

/** Read a custom-field value (string | number | array) as a trimmed string. */
function fieldValueToString(f: { field_value?: unknown; value?: unknown }): string {
  const raw = f.field_value ?? f.value ?? "";
  const s = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.join(", ") : String(raw);
  return s.trim();
}

/**
 * Resolve a contact's website, future-proof and form-agnostic.
 * Priority (field-first, structure-tolerant, note last):
 *   1. standard `contact.website` (where NEW forms write it)
 *   2. a legacy website custom field by stable id (OLD forms)
 *   3. ANY custom field whose value looks like a URL (unknown/future forms)
 *   4. a URL inside the qualification note (oldest / Zapier leads)
 * Returns a cleaned URL (https-normalized) or null. Keys off the standard
 * field + URL shape, NOT specific question strings, so new forms still resolve.
 */
export function deriveWebsite(
  contact: WebsiteContact | null | undefined,
  notes?: Array<{ body: string }>,
): string | null {
  if (contact) {
    // 1. Standard website field.
    const std = (contact.website ?? "").trim();
    if (std && looksLikeUrl(std)) return cleanUrl(std);

    const fields = contact.customFields ?? contact.customField ?? [];

    // 2. Legacy website custom field by stable id.
    for (const id of LEGACY_WEBSITE_FIELD_IDS) {
      const f = fields.find((x) => x.id === id);
      if (f) {
        const v = fieldValueToString(f);
        if (v && looksLikeUrl(v)) return cleanUrl(v);
      }
    }

    // 3. Any custom field whose value looks like a URL.
    for (const f of fields) {
      const v = fieldValueToString(f);
      if (v && looksLikeUrl(v)) return cleanUrl(v);
    }
  }

  // 4. Qualification-note fallback.
  if (notes?.length) {
    const qualNote = notes.find((n) => isQualificationNote(n.body));
    if (qualNote) {
      const urlPair = parseQualificationNote(qualNote.body).find((qa) => qa.isUrl && qa.cleanedUrl);
      if (urlPair?.cleanedUrl) return urlPair.cleanedUrl;
    }
  }

  return null;
}

/** A resolved qualification item — a question (label) and its answer (value). */
export interface QualItem {
  label: string;
  value: string;
  folder?: string;
  isUrl: boolean;
  cleanedUrl?: string;
}

/** Fields to promote to the top of the qualification view. */
const PROMOTED_KEYWORDS = ["website", "url", "company", "brand", "revenue"];
const SKIP_VALUES = ["", "--", "N/A", "n/a", "null", "undefined"];

/**
 * Map a contact's raw GHL custom fields (lead-form answers) to resolved
 * question→answer items, using the field-definition map for human labels.
 * Empty/placeholder values are dropped; promoted fields sort to the top.
 */
export function resolveCustomFields(
  rawFields: Array<{ id: string; field_value?: unknown; value?: unknown }>,
  fieldDefs: Record<string, FieldDef>
): QualItem[] {
  const results: QualItem[] = [];

  for (const f of rawFields) {
    // GHL custom-field values can be strings, numbers, or arrays (multi-select).
    // Coerce to a string before any string ops so a numeric/array field never crashes.
    const raw = f.field_value ?? f.value ?? "";
    const rawValue = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.join(", ") : String(raw);
    if (!rawValue || SKIP_VALUES.includes(rawValue.trim())) continue;

    const def = fieldDefs[f.id];
    const label = def?.name ?? f.id;
    const folder = def?.folder;
    const isUrl = looksLikeUrl(rawValue);

    results.push({
      label,
      value: rawValue,
      folder,
      isUrl,
      cleanedUrl: isUrl ? cleanUrl(rawValue) : undefined,
    });
  }

  return results.sort((a, b) => {
    const aPromoted = PROMOTED_KEYWORDS.some((k) => a.label.toLowerCase().includes(k));
    const bPromoted = PROMOTED_KEYWORDS.some((k) => b.label.toLowerCase().includes(k));
    if (aPromoted && !bPromoted) return -1;
    if (!aPromoted && bPromoted) return 1;
    const folderCmp = (a.folder ?? "").localeCompare(b.folder ?? "");
    if (folderCmp !== 0) return folderCmp;
    return a.label.localeCompare(b.label);
  });
}
