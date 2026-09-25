// Pure validators/normalizers for the editable-proposal JSONB payloads. Used by the create route
// and the draft PATCH so nothing malformed (or oversized) is ever persisted. Copy is stored as
// markdown and rendered with react-markdown (no raw HTML) + the PDF markdown parser, so there is no
// HTML/script execution path; we still cap lengths and coerce types defensively.
import type {
  Deliverables,
  DeliverableItem,
  DeliverableGroup,
  ProposalContent,
  AdditionalRate,
  SignatureBlock,
} from "@/lib/proposals/content";

const str = (v: unknown, max: number): string =>
  (typeof v === "string" ? v : "").slice(0, max);
const numOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};
const GROUPS: DeliverableGroup[] = ["included", "exclusive", "custom"];

/** Validate/clean the structured deliverables blob. Returns null when there's nothing usable. */
export function normalizeDeliverables(input: unknown): Deliverables | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const rawItems = Array.isArray(o.items) ? o.items : [];
  const items: DeliverableItem[] = rawItems
    .slice(0, 200)
    .map((raw, i): DeliverableItem | null => {
      if (!raw || typeof raw !== "object") return null;
      const it = raw as Record<string, unknown>;
      const label = str(it.label, 300).trim();
      if (!label) return null;
      const group = GROUPS.includes(it.group as DeliverableGroup)
        ? (it.group as DeliverableGroup)
        : "included";
      const detail = str(it.detail, 500).trim();
      return {
        id: str(it.id, 60) || `d${i}`,
        label,
        ...(detail ? { detail } : {}),
        group,
        order: numOrNull(it.order) ?? i,
      };
    })
    .filter((x): x is DeliverableItem => x !== null)
    .sort((a, b) => a.order - b.order)
    .map((it, i) => ({ ...it, order: i }));

  const packageId = o.packageId == null ? null : str(o.packageId, 60) || null;
  const packageName = o.packageName == null ? null : str(o.packageName, 120) || null;
  const emails = numOrNull(o.emails);
  const popUps = numOrNull(o.popUps);

  if (!items.length && !packageId && emails == null && popUps == null) return null;
  return { packageId, packageName, emails, popUps, items };
}

function normalizeRates(input: unknown, fallback: AdditionalRate[]): AdditionalRate[] {
  if (!Array.isArray(input)) return fallback;
  const rows = input
    .slice(0, 40)
    .map((raw) => {
      if (!raw || typeof raw !== "object") return null;
      const r = raw as Record<string, unknown>;
      const item = str(r.item, 200).trim();
      const cost = str(r.cost, 100).trim();
      if (!item && !cost) return null;
      return { item, cost };
    })
    .filter((x): x is AdditionalRate => x !== null);
  return rows;
}

function normalizeSignature(input: unknown, fallback: SignatureBlock): SignatureBlock {
  if (!input || typeof input !== "object") return fallback;
  const s = input as Record<string, unknown>;
  return {
    company: str(s.company, 120) || fallback.company,
    title: str(s.title, 120) || fallback.title,
    name: str(s.name, 120) || fallback.name,
    email: str(s.email, 160) || fallback.email,
  };
}

const MD_MAX = 20000; // generous ceiling for a copy section

/** Validate/clean an incoming ProposalContent against a fallback (missing/invalid fields kept). */
export function normalizeContent(input: unknown, fallback: ProposalContent): ProposalContent {
  if (!input || typeof input !== "object") return fallback;
  const o = input as Record<string, unknown>;
  const md = (k: keyof ProposalContent) =>
    typeof o[k] === "string" ? str(o[k], MD_MAX) : (fallback[k] as string);
  return {
    docTitle: str(o.docTitle, 200) || fallback.docTitle,
    serviceLabel: str(o.serviceLabel, 200) || fallback.serviceLabel,
    intro: md("intro"),
    scopeIntro: md("scopeIntro"),
    defaultScope: md("defaultScope"),
    additionalScopeIntro: md("additionalScopeIntro"),
    additionalRates: normalizeRates(o.additionalRates, fallback.additionalRates),
    acceptance: md("acceptance"),
    terms: md("terms"),
    signature: normalizeSignature(o.signature, fallback.signature),
  };
}
