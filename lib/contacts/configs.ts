/**
 * Shared contact display configs — used by the contacts table AND the contact modal
 * header so the source/status chips look identical in both places.
 */

/** Source / funnel badge by platform (the lead form they opted in through). */
export const PLATFORM_BADGE: Record<string, { label: string; className: string }> = {
  lead_form: { label: "Meta",   className: "bg-[#0F3A5C]/10 text-[#0F3A5C]" },
  facebook:  { label: "FB",     className: "bg-blue-50 text-blue-700" },
  instagram: { label: "IG",     className: "bg-pink-50 text-pink-700" },
  tiktok:    { label: "TikTok", className: "bg-slate-100 text-slate-700" },
};

/** Contact response/status pill. */
export const RESPONSE_CONFIG: Record<string, { label: string; className: string }> = {
  awaiting_reply: { label: "Awaiting reply", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  no_response:    { label: "No response",    className: "bg-red-50 text-red-600 border-red-200" },
  replied:        { label: "Replied",        className: "bg-muted text-muted-foreground border-border" },
};
