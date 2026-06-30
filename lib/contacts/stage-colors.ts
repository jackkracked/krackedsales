/**
 * Stage pill colours, shared by the contacts table and the change-stage modal.
 * Kept in its own module so both can import without a circular dependency.
 */
export const STAGE_COLORS: Record<string, string> = {
  "New Lead":             "bg-blue-50 text-blue-700 border-blue-200",
  "Initial Contact Made": "bg-amber-50 text-amber-700 border-amber-200",
  "Intro Call (Booked)":  "bg-violet-50 text-violet-700 border-violet-200",
  "Demo In Progress":     "bg-indigo-50 text-indigo-700 border-indigo-200",
  "Demo Sent":            "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Proposal Sent":        "bg-teal-50 text-teal-700 border-teal-200",
  "Closed (Won)":         "bg-green-50 text-green-700 border-green-200",
  "Not Qualified":        "bg-muted text-muted-foreground border-border",
};

const FALLBACK = "bg-muted text-muted-foreground border-border";

/** Resolve the colour classes for a stage name (fuzzy: matches on substring). */
export function stageClass(stage: string | null | undefined): string {
  if (!stage) return FALLBACK;
  const hit = Object.entries(STAGE_COLORS).find(([k]) =>
    stage.toLowerCase().includes(k.toLowerCase())
  );
  return hit?.[1] ?? FALLBACK;
}

/**
 * Map a stage name to a calm semantic status token, consumed ONLY by the r10n
 * theme's `data-status` hook on stage pills (won → lime, lost/not-qualified →
 * red, everything in-flight → neutral steel). Mirrors the pipeline status idiom
 * so a single semantic accent reads, never eight loud per-stage colours. Inert
 * in the default theme: nothing reads this attribute there.
 */
export function stageStatus(stage: string | null | undefined): "won" | "lost" | "neutral" {
  if (!stage) return "neutral";
  const lc = stage.toLowerCase();
  if (lc.includes("won") || lc.includes("closed (won)")) return "won";
  if (lc.includes("not qualified") || lc.includes("lost") || lc.includes("disqualified")) return "lost";
  return "neutral";
}

/* ─── R10N per-stage colour resolver ───
   The default STAGE_COLORS map gives every stage a loud Tailwind family
   (blue/amber/violet/indigo/emerald/teal/green/muted). Under the r10n theme we
   want each stage DISTINCT but cohesive: we read that default family and
   translate it into the system palette. Additive + pure: the default theme never
   reads this. It is consumed only via an inline `--r10n-stage` CSS var that the
   `[data-theme="r10n"]` pill rules apply (with the var defaulting to the loud
   classes when r10n is off, so default stays byte-for-byte identical). */

/** R10N palette anchors (mirror the [data-theme="r10n"] tokens in globals.css). */
const R10N_INFO = "#2A6FDB"; // blue / sky / indigo / violet family
const R10N_POSITIVE = "#1FA463"; // green / emerald / teal family (in-flight)
const R10N_SIGNAL = "#2563EB"; // signal blue (matches --r10n-signal); was lime #C7FF41 before the accent refresh. Closing "won"/"proposal"/"sale" stages. The globals.css legibility guard `[data-r10n-stage-pill][style*="#2563EB"]` darkens this to readable #1D4ED8 text.
const R10N_WARNING = "#E08B00"; // amber / orange / yellow family
const R10N_NEGATIVE = "#D7263D"; // red / rose family
const R10N_STEEL = "#6E7179"; // gray / slate / zinc / neutral / muted family

/** Pull the Tailwind colour family token out of a STAGE_COLORS class string. */
function familyFromClasses(classes: string): string {
  // e.g. "bg-emerald-50 text-emerald-700 border-emerald-200" → "emerald"
  const match = classes.match(/text-([a-z]+)-\d{2,3}/);
  return match?.[1] ?? "muted";
}

/**
 * Resolve a single R10N hex for a stage, derived from its DEFAULT colour family
 * translated into the R10N palette. Closing/"won" green stages get Signal lime;
 * other greens get Positive, so a "Demo Sent" stays green-positive while a
 * "Closed (Won)" pops lime. Returns a hex string suitable for `--r10n-stage`.
 */
export function r10nStageColor(stage: string | null | undefined): string {
  if (!stage) return R10N_STEEL;
  const lc = stage.toLowerCase();

  // Closing stages read as the system's "this is the win" accent (lime),
  // regardless of which green family the default map assigned them.
  if (
    lc.includes("won") ||
    lc.includes("proposal sent") ||
    (lc.includes("sale") && !lc.includes("unsale")) ||
    lc.includes("closed (won)")
  ) {
    return R10N_SIGNAL;
  }

  // Otherwise translate the default Tailwind family into the R10N palette.
  const classes = stageClass(stage);
  const family = familyFromClasses(classes);
  switch (family) {
    case "blue":
    case "sky":
    case "indigo":
    case "violet":
    case "purple":
      return R10N_INFO;
    case "green":
    case "emerald":
    case "teal":
      return R10N_POSITIVE;
    case "amber":
    case "orange":
    case "yellow":
      return R10N_WARNING;
    case "red":
    case "rose":
      return R10N_NEGATIVE;
    case "gray":
    case "slate":
    case "zinc":
    case "neutral":
    case "muted":
    default:
      return R10N_STEEL;
  }
}
