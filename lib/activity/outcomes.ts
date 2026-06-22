// Single source of truth for call-outcome presentation, shared by the contact
// modal Timeline and the opportunity modal Activity tab so they read identically.
// One disposition outcome → one friendly label + one semantic tone.

export type OutcomeTone = "negative" | "caution" | "progress" | "advancing" | "won";

interface OutcomeMeta {
  label: string;
  tone: OutcomeTone;
}

const OUTCOME_META: Record<string, OutcomeMeta> = {
  no_show:            { label: "No-show",            tone: "negative" },
  not_interested:     { label: "Not interested",     tone: "negative" },
  budget_objection:   { label: "Budget objection",   tone: "caution" },
  needs_time:         { label: "Needs time",         tone: "caution" },
  follow_up:          { label: "Follow-up",          tone: "progress" },
  rebooked:           { label: "Rebooked",           tone: "progress" },
  preparing_proposal: { label: "Preparing proposal", tone: "advancing" },
  sent_proposal:      { label: "Proposal sent",      tone: "advancing" },
  closed:             { label: "Closed — won",       tone: "won" },
};

/** Friendly label + tone for a raw outcome key, with a safe fallback. */
export function outcomeMeta(outcome: string): OutcomeMeta {
  return OUTCOME_META[outcome] ?? { label: outcome.replace(/_/g, " "), tone: "progress" };
}

// Tone → Tailwind class bundles. Literal strings so Tailwind keeps them.
// `pill`: the activity-tab chip. `icon` + `iconBg`: the timeline icon node.
export const OUTCOME_TONES: Record<OutcomeTone, { pill: string; icon: string; iconBg: string }> = {
  negative:  { pill: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",                 icon: "text-rose-600",     iconBg: "bg-rose-50 border-rose-200" },
  caution:   { pill: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",              icon: "text-amber-600",    iconBg: "bg-amber-50 border-amber-200" },
  progress:  { pill: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",                 icon: "text-blue-600",     iconBg: "bg-blue-50 border-blue-200" },
  advancing: { pill: "bg-[#0F3A5C]/[0.08] text-[#0F3A5C] ring-1 ring-[#0F3A5C]/20",   icon: "text-[#0F3A5C]",    iconBg: "bg-[#0F3A5C]/[0.06] border-[#0F3A5C]/20" },
  won:       { pill: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",        icon: "text-emerald-700",  iconBg: "bg-emerald-50 border-emerald-200" },
};
