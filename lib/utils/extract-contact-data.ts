/**
 * Extracts contact-enrichable data (URLs, emails, phone numbers) from a text string.
 * Used to surface "Add to contact" chips inside chat threads.
 */

import { cleanUrl } from "@/lib/utils/url";

// Emails first — extracted before URL matching so email domains aren't captured as URLs
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// URLs: https/http links, bare www. domains, or bare domains with common TLDs
// e.g. "AmberwingOrganics.com" or "www.example.com" or "https://example.com"
const COMMON_TLDS =
  "com|net|org|io|co|shop|store|biz|info|us|uk|ca|au|nz|de|fr|es|it|nl|be|ch|at|se|no|dk|fi|ie|sg|hk|jp|in|br|mx|za|ae|sa";

const URL_RE = new RegExp(
  `(https?:\\/\\/[^\\s<>()[\\]"']+` +
  `|www\\.[a-z0-9\\-]+\\.[a-z]{2,}[^\\s<>()[\\]"']*` +
  `|\\b[a-zA-Z0-9][a-zA-Z0-9\\-]*\\.(?:${COMMON_TLDS})\\b[^\\s<>()[\\]"']*)`,
  "gi"
);

// US phone numbers: +1 (555) 123-4567 / 555-123-4567 / 5551234567 etc.
const PHONE_RE =
  /(?:\+?1[-.\s]?)?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})(?!\d)/g;

// Domains that are GHL internals, our own infrastructure, or asset hosts. None of these is
// ever a CONTACT's data, so offering them for enrichment only invites saving a storage bucket
// or one of our own demo pages as a client's website.
const BLOCKED_DOMAINS = [
  "blooio.com",        // GHL file attachment CDN
  "msgsndr.com",       // GHL messaging infrastructure
  "leadconnectorhq.com",
  "highlevel.com",
  "gohighlevel.com",
  // GHL stores message media in a Google bucket, so attachments surfaced as "contact data".
  // The paths give it away: storage.googleapis.com/msgsndr/...
  "storage.googleapis.com",
  // Ours. Every demo we send is demo.krackedretention.com/<client>, so it was being detected
  // on exactly the threads where we had just sent one. The apex covers every subdomain.
  "krackedretention.com",
];

function isBlockedDomain(url: string): boolean {
  try {
    const host = url.match(/^https?:\/\//)
      ? new URL(url).hostname
      : url.split("/")[0].split("?")[0];
    return BLOCKED_DOMAINS.some((d) => host === d || host.endsWith("." + d));
  } catch {
    return false;
  }
}

export interface ExtractedData {
  urls: string[];
  emails: string[];
  phones: string[];
}

export function extractContactData(text: string | null | undefined): ExtractedData {
  // Media/story/reaction messages (e.g. Instagram) can have no text body — never crash on them.
  if (!text) return { urls: [], emails: [], phones: [] };
  const emails = [...(text.match(EMAIL_RE) ?? [])];

  // Strip emails before URL matching to avoid matching email domains as URLs
  const stripped = text.replace(EMAIL_RE, "");
  const rawUrls = [...(stripped.match(URL_RE) ?? [])];
  const urls = rawUrls.filter((u) => !isBlockedDomain(u));

  const phoneMatches = [...text.matchAll(PHONE_RE)];
  const phones = phoneMatches.map((m) => m[0].trim());

  return { urls, emails, phones };
}

/**
 * Scans all inbound messages in a thread and returns every unique enrichable value found.
 */
export function scanThread(
  messages: Array<{ body?: string | null; direction?: string }>
): ExtractedData {
  const urls = new Set<string>();
  const emails = new Set<string>();
  const phones = new Set<string>();

  for (const msg of messages) {
    if (msg.direction !== "inbound" || !msg.body) continue;
    const { urls: u, emails: e, phones: p } = extractContactData(msg.body);
    u.forEach((v) => urls.add(v));
    e.forEach((v) => emails.add(v));
    p.forEach((v) => phones.add(v));
  }

  return { urls: [...urls], emails: [...emails], phones: [...phones] };
}

// ── Normalization + already-on-file filtering (for the inbox "only show new data" UX) ──

/** Normalize a detected/stored value so equal-but-differently-formatted values compare equal. */
export function normalizeForCompare(type: "url" | "email" | "phone", value: string): string {
  if (type === "email") return value.trim().toLowerCase();
  if (type === "phone") {
    // Strip a leading US country code so a typed "555-123-4567" matches GHL's E.164 "+15551234567".
    const d = value.replace(/\D/g, "");
    return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  }
  return cleanUrl(value).toLowerCase().replace(/\/+$/, "");
}

export interface ExistingContactData {
  email?: string | null;
  phone?: string | null;
  website?: string | null;
}

/**
 * Drop any detected value the contact/lead already has on file, comparing on normalized
 * form (so "Acme.com" vs "https://acme.com/" match). Powers the inbox rule: only ever
 * surface data we don't already have.
 */
/** Collapse values that are equal once normalized (e.g. "http://x.com" + "x.com" + "www.x.com/"),
 *  keeping the first, so a detected website only ever shows as ONE chip. */
function dedupeNormalized(type: "url" | "email" | "phone", arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of arr) {
    const n = normalizeForCompare(type, v);
    if (n && !seen.has(n)) { seen.add(n); out.push(v); }
  }
  return out;
}

export function filterAlreadyOnFile(
  data: ExtractedData,
  existing: ExistingContactData | undefined | null
): ExtractedData {
  const haveEmail = existing?.email ? normalizeForCompare("email", existing.email) : null;
  const havePhone = existing?.phone ? normalizeForCompare("phone", existing.phone) : null;
  const haveWebsite = existing?.website ? normalizeForCompare("url", existing.website) : null;
  return {
    urls: dedupeNormalized("url", data.urls).filter((v) => !haveWebsite || normalizeForCompare("url", v) !== haveWebsite),
    emails: dedupeNormalized("email", data.emails).filter((v) => !haveEmail || normalizeForCompare("email", v) !== haveEmail),
    phones: dedupeNormalized("phone", data.phones).filter((v) => !havePhone || normalizeForCompare("phone", v) !== havePhone),
  };
}
