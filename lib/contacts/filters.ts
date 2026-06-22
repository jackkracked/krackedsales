// ─── Contacts filter model ──────────────────────────────────────────────────
//
// The contacts list filters SERVER-SIDE via a generic rules engine in
// app/api/contacts/route.ts (applyRule). The toggle-pill filter sheet is a
// friendly producer of those rules: each active filter card becomes one
// FilterRule with operator "is_any_of" (OR within the card); cards are joined
// with connector "and" (AND across cards). This file owns the shared types, the
// pill catalogs, and the conversions between the UI model, server rules, and the
// URL query string.

// ─── Server rule types (shared with the API + smart lists) ───────────────────

export type FilterField =
  | "platform"
  | "channel"
  | "stageId"
  | "assignedTo"
  | "urgency"
  | "daysInCurrentStage"
  | "hasDemo"
  | "hasProposal"
  | "reachableChannels"
  // legacy fields still understood by the API (back-compat / search):
  | "source"
  | "pipelineId"
  | "brandCategory"
  | "daysSinceLastTouch"
  | "name"
  | "email";

export type FilterOperator =
  | "is_any_of"
  | "is_none_of"
  | "contains"
  | "not_contains"
  | "gt"
  | "lt"
  | "is";

export interface FilterRule {
  id: string;
  field: FilterField;
  operator: FilterOperator;
  values: string[];
  connector?: "and" | "or";
}

// ─── UI filter model ─────────────────────────────────────────────────────────

export type TriState = "yes" | "no" | null;

export interface ContactFilters {
  optIn: string[]; // platform values
  channel: string[]; // lastChannel data values ("SMS" | "Email" | "Instagram")
  stageId: string[]; // GHL stage ids
  rep: string[]; // assignedTo ids, plus UNASSIGNED
  urgency: string | null; // "today" | "3to5" | "7plus" | "<number>" (custom days+)
  daysInStage: number | null; // matches > N days in current stage
  demo: TriState;
  proposal: TriState;
  avail: string[]; // "email_only" | "sms_only" | "both"
}

export const EMPTY_FILTERS: ContactFilters = {
  optIn: [],
  channel: [],
  stageId: [],
  rep: [],
  urgency: null,
  daysInStage: null,
  demo: null,
  proposal: null,
  avail: [],
};

export const UNASSIGNED = "__unassigned__";

// ─── Static pill catalogs ────────────────────────────────────────────────────

export const OPT_IN_OPTIONS: { value: string; label: string; dot: string }[] = [
  { value: "lead_form", label: "Lead form", dot: "bg-[#0F3A5C]" },
  { value: "facebook", label: "Facebook", dot: "bg-blue-500" },
  { value: "instagram", label: "Instagram", dot: "bg-pink-500" },
  { value: "tiktok", label: "TikTok", dot: "bg-slate-700" },
];

// label shows "Instagram DM"; the value is the stored lastChannel ("Instagram")
export const CHANNEL_OPTIONS: { value: string; label: string }[] = [
  { value: "SMS", label: "SMS" },
  { value: "Email", label: "Email" },
  { value: "Instagram", label: "Instagram DM" },
];

export const URGENCY_OPTIONS: { value: string; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "3to5", label: "3–5 days" },
  { value: "7plus", label: "7+ days" },
];

export const AVAIL_OPTIONS: { value: string; label: string }[] = [
  { value: "email_only", label: "Email only" },
  { value: "sms_only", label: "SMS only" },
  { value: "both", label: "SMS + Email" },
];

// Selected-stage pill tint, keyed by a substring of the stage name so it tracks
// the same colour language as the contacts table. Falls back to navy fill.
const STAGE_TINTS: { match: string; cls: string }[] = [
  { match: "new lead", cls: "bg-blue-50 text-blue-700 ring-blue-300" },
  { match: "initial contact", cls: "bg-amber-50 text-amber-700 ring-amber-300" },
  { match: "intro call", cls: "bg-violet-50 text-violet-700 ring-violet-300" },
  { match: "demo in progress", cls: "bg-indigo-50 text-indigo-700 ring-indigo-300" },
  { match: "demo sent", cls: "bg-emerald-50 text-emerald-700 ring-emerald-300" },
  { match: "proposal sent", cls: "bg-teal-50 text-teal-700 ring-teal-300" },
  { match: "won", cls: "bg-green-50 text-green-700 ring-green-300" },
  { match: "not qualified", cls: "bg-rose-50 text-rose-600 ring-rose-300" },
  { match: "nurture", cls: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-300" },
];

const STAGE_TINT_FALLBACK = "bg-primary text-primary-foreground ring-primary";

export function stageTint(name: string): string {
  const lc = name.toLowerCase();
  return STAGE_TINTS.find((s) => lc.includes(s.match))?.cls ?? STAGE_TINT_FALLBACK;
}

// ─── Active-card count (for the toolbar badge) ───────────────────────────────

export function countActive(f: ContactFilters): number {
  return (
    (f.optIn.length ? 1 : 0) +
    (f.channel.length ? 1 : 0) +
    (f.stageId.length ? 1 : 0) +
    (f.rep.length ? 1 : 0) +
    (f.urgency ? 1 : 0) +
    (f.daysInStage != null ? 1 : 0) +
    (f.demo ? 1 : 0) +
    (f.proposal ? 1 : 0) +
    (f.avail.length ? 1 : 0)
  );
}

export function hasAnyFilter(f: ContactFilters): boolean {
  return countActive(f) > 0;
}

// ─── UI model → server rules ─────────────────────────────────────────────────

export function filtersToRules(f: ContactFilters): FilterRule[] {
  const rules: FilterRule[] = [];
  let n = 0;
  const push = (field: FilterField, operator: FilterOperator, values: string[]) =>
    rules.push({ id: `f${n++}`, field, operator, values, connector: "and" });

  if (f.optIn.length) push("platform", "is_any_of", f.optIn);
  if (f.channel.length) push("channel", "is_any_of", f.channel);
  if (f.stageId.length) push("stageId", "is_any_of", f.stageId);
  if (f.rep.length) push("assignedTo", "is_any_of", f.rep);
  if (f.urgency) push("urgency", "is", [f.urgency]);
  if (f.daysInStage != null) push("daysInCurrentStage", "gt", [String(f.daysInStage)]);
  if (f.demo) push("hasDemo", "is_any_of", [f.demo === "yes" ? "true" : "false"]);
  if (f.proposal) push("hasProposal", "is_any_of", [f.proposal === "yes" ? "true" : "false"]);
  if (f.avail.length) push("reachableChannels", "is_any_of", f.avail);

  return rules;
}

// ─── UI model ↔ URL query params ─────────────────────────────────────────────

export function filtersToParams(f: ContactFilters): Record<string, string> {
  const p: Record<string, string> = {};
  if (f.optIn.length) p.optin = f.optIn.join(",");
  if (f.channel.length) p.ch = f.channel.join(",");
  if (f.stageId.length) p.stage = f.stageId.join(",");
  if (f.rep.length) p.rep = f.rep.join(",");
  if (f.urgency) p.urg = f.urgency;
  if (f.daysInStage != null) p.instage = String(f.daysInStage);
  if (f.demo) p.demo = f.demo;
  if (f.proposal) p.prop = f.proposal;
  if (f.avail.length) p.avail = f.avail.join(",");
  return p;
}

export function parseFilters(sp: URLSearchParams): ContactFilters {
  const list = (k: string): string[] => {
    const v = sp.get(k);
    return v ? v.split(",").filter(Boolean) : [];
  };
  const instage = sp.get("instage");
  const tri = (k: string): TriState => {
    const v = sp.get(k);
    return v === "yes" || v === "no" ? v : null;
  };
  return {
    optIn: list("optin"),
    channel: list("ch"),
    stageId: list("stage"),
    rep: list("rep"),
    urgency: sp.get("urg") || null,
    daysInStage: instage != null && instage !== "" && !Number.isNaN(Number(instage)) ? Number(instage) : null,
    demo: tri("demo"),
    proposal: tri("prop"),
    avail: list("avail"),
  };
}
