/**
 * ════════════════════════════════════════════════════════════════════════════
 *  CRO ENGINE — Gage's "Book A Call Dashboard", as software.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Pure functions. No I/O, no DB, no integrations — you hand it the 10 weekly
 * numbers + the unit-economics assumptions, it returns the entire diagnostic:
 * every funnel rate, the per-stage status against Gage's Conservative/Good/Great
 * ladder, the ONE constraint to fix this week, the scaling-gate verdict, and the
 * "Constraint-to-Scale Bridge" (simulate the fix forward → are we cleared to
 * scale?). This is the brain; the API/UI/cron are just plumbing around it.
 *
 * Fidelity to Gage's sheet is load-bearing (his 7 stages, his exact names/order,
 * his Conservative/Good/Great words, his 3:1 gate, his four scaling bands).
 *
 * Decisions baked in (confirmed by Jack):
 *   - LTGP is the PROFIT definition: ACV × months × grossMargin (his cell says
 *     "Lifetime Gross Profit", and it's the only way the margin input matters).
 *   - Conversion rates use STRICT prior-stage denominators (lead CVR = leads ÷
 *     clicks, not ÷ impressions) — the corrected method.
 *   - A stage can't BE the constraint on a tiny sample (1 close ≠ a 5% close
 *     rate you should act on); low-sample stages are flagged, not blamed.
 *   - The master rule: never recommend "scale" while LTGP:CAC < 3 — encoded once,
 *     here, so no surface can contradict it.
 */

// ─── Inputs ──────────────────────────────────────────────────────────────────

/** The 10 weekly numbers (9 auto-filled from integrations, Conversations from GHL). */
export interface FunnelInputs {
  adSpend: number;
  impressions: number;
  clicks: number;
  leads: number;
  conversations: number; // leads who replied
  callsBooked: number;
  callsShowed: number;
  closed: number;
  revenue: number; // cash collected from closed deals
}

/** The three blue assumption cells from Gage's Funnel Benchmarks tab. */
export interface UnitAssumptions {
  acv: number; // average contract value per month
  retentionMonths: number;
  grossMargin: number; // 0..1 (e.g. 0.8 for 80%)
}

/** One stage's Conservative / Good / Great thresholds, as fractions (0..1). */
export interface Benchmark {
  conservative: number;
  good: number;
  great: number;
}

/** Gage's ladder keyed by stage. `good` is the target line (his Dashboard "Target"). */
export type BenchmarkLadder = Record<StageKey, Benchmark>;

// ─── Stages ──────────────────────────────────────────────────────────────────

export type StageKey =
  | "ctr"
  | "leadCvr"
  | "leadToConv"
  | "convToBooked"
  | "showRate"
  | "closeRate";

/** Ordered stage definitions — top of funnel first (the order Gage reads). */
export const STAGES: {
  key: StageKey;
  label: string; // Gage's language
  /** input (denominator) + output (numerator) keys on FunnelInputs. */
  input: keyof FunnelInputs;
  output: keyof FunnelInputs;
  unit: "percent";
  /** Plain-English coaching — Gage's "How to Fix" voice. */
  howToFix: string;
}[] = [
  {
    key: "ctr",
    label: "Click-Through Rate",
    input: "impressions",
    output: "clicks",
    unit: "percent",
    howToFix:
      "The ad creative is the lever. Test new hooks, first frames and angles. A low CTR means the scroll-stopper isn't landing, not that the audience is wrong.",
  },
  {
    key: "leadCvr",
    label: "Lead CVR",
    input: "clicks",
    output: "leads",
    unit: "percent",
    howToFix:
      "Clicks aren't becoming leads — the landing page or form is the leak. Tighten the headline to match the ad, cut form fields, make the offer unmissable above the fold.",
  },
  {
    key: "leadToConv",
    label: "Lead to Conversation",
    input: "leads",
    output: "conversations",
    unit: "percent",
    howToFix:
      "Leads aren't replying. Speed-to-lead is everything: message within 5 minutes. Rework the opening message and the follow-up sequence so it earns a response.",
  },
  {
    key: "convToBooked",
    label: "Conversation to Booked",
    input: "conversations",
    output: "callsBooked",
    unit: "percent",
    howToFix:
      "Conversations aren't turning into booked calls. Lead with the booking link earlier, qualify less and invite more, and remove friction from the calendar step.",
  },
  {
    key: "showRate",
    label: "Show Rate",
    input: "callsBooked",
    output: "callsShowed",
    unit: "percent",
    howToFix:
      "Booked calls aren't showing. Add reminder sequences (SMS + email), confirm the value of the call, and shorten the gap between booking and the call.",
  },
  {
    key: "closeRate",
    label: "Close Rate",
    input: "callsShowed",
    output: "closed",
    unit: "percent",
    howToFix:
      "Calls aren't closing. Tighten qualification before the call, sharpen the offer and pricing frame, and confirm decision-maker and budget early.",
  },
];

/**
 * Gage's $10M-Leads benchmark ladder (Funnel Benchmarks tab), as fractions.
 * Stored as the default; a DB row can override per-stage later.
 */
export const DEFAULT_BENCHMARKS: BenchmarkLadder = {
  ctr: { conservative: 0.01, good: 0.02, great: 0.03 },
  leadCvr: { conservative: 0.1, good: 0.2, great: 0.3 },
  leadToConv: { conservative: 0.3, good: 0.5, great: 0.7 },
  convToBooked: { conservative: 0.5, good: 0.7, great: 0.9 },
  showRate: { conservative: 0.5, good: 0.7, great: 0.9 },
  closeRate: { conservative: 0.15, good: 0.22, great: 0.3 },
};

// ─── Tunables ────────────────────────────────────────────────────────────────

/** A stage with fewer than this many OUTCOMES (numerator) is too thin to blame. */
export const MIN_OUTCOMES = 5;
/** ...or fewer than this many ATTEMPTS (denominator). */
export const MIN_ATTEMPTS = 10;
/** LTGP:CAC must clear this before any "scale" verdict (Gage's 3:1 gate). */
export const SCALE_GATE = 3;

// ─── Result types ────────────────────────────────────────────────────────────

export type StageStatus = "on_track" | "getting_there" | "below" | "no_data";

export interface StageResult {
  key: StageKey;
  label: string;
  rate: number | null; // fraction; null when denominator is 0
  /** Raw receipts: 24 of 86. */
  numerator: number;
  denominator: number;
  benchmark: Benchmark;
  /** target = the "Good" line (Gage's Dashboard Target column). */
  target: number;
  status: StageStatus;
  /** Relative shortfall vs the Good line, 0..1 (0 = at/above target). */
  shortfall: number;
  /** True when the sample is too thin to treat as the constraint. */
  lowSample: boolean;
  howToFix: string;
}

export interface UnitEconomics {
  ltgp: number; // ACV × months × margin (profit definition)
  targetCac: number; // LTGP / 3
  maxCac: number; // LTGP (break-even ceiling)
  cac: number | null; // adSpend / closed (null when 0 closed)
  ltgpCacRatio: number | null; // LTGP / CAC (null when 0 closed)
  revenuePerLead: number | null;
  revenuePerCall: number | null; // per call showed
}

export type ScalingBand = "pause" | "fix" | "scale" | "aggressive";

export interface ScalingVerdict {
  band: ScalingBand;
  /** Gage's language. */
  label: string;
  action: string;
  ratio: number | null;
  /** Hard truth: may we increase budget right now? Never true under the 3:1 gate. */
  clearedToScale: boolean;
}

export interface Bridge {
  /** Whether a forward simulation was possible (a real constraint + data). */
  available: boolean;
  constraintKey: StageKey | null;
  /** Projected closed deals if the constraint hits its Good line. */
  projectedClosed: number;
  currentClosed: number;
  projectedCac: number | null;
  currentCac: number | null;
  projectedRatio: number | null;
  currentRatio: number | null;
  crossesGate: boolean;
  /** One sentence, in Gage's voice, for the hero card. */
  sentence: string;
}

export interface CroDiagnosis {
  stages: StageResult[];
  econ: UnitEconomics;
  scaling: ScalingVerdict;
  /** The single stage to fix this week (null when everything is on track). */
  constraint: StageResult | null;
  bridge: Bridge;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const rate = (num: number, den: number): number | null => (den > 0 ? num / den : null);
const safeNum = (v: number): number => (Number.isFinite(v) ? v : 0);

/** Status for an actual rate against its ladder. null rate → no_data. */
export function statusFor(r: number | null, b: Benchmark): StageStatus {
  if (r === null) return "no_data";
  if (r >= b.good) return "on_track";
  if (r >= b.conservative) return "getting_there";
  return "below";
}

// ─── Stage computation ───────────────────────────────────────────────────────

export function computeStages(
  inputs: FunnelInputs,
  benchmarks: BenchmarkLadder = DEFAULT_BENCHMARKS,
): StageResult[] {
  return STAGES.map((s) => {
    const numerator = safeNum(inputs[s.output] as number);
    const denominator = safeNum(inputs[s.input] as number);
    const r = rate(numerator, denominator);
    const b = benchmarks[s.key];
    const status = statusFor(r, b);
    const shortfall = r === null || r >= b.good ? 0 : (b.good - r) / b.good;
    // Too thin to act on: not enough outcomes OR not enough attempts.
    const lowSample = numerator < MIN_OUTCOMES || denominator < MIN_ATTEMPTS;
    return {
      key: s.key,
      label: s.label,
      rate: r,
      numerator,
      denominator,
      benchmark: b,
      target: b.good,
      status,
      shortfall,
      lowSample,
      howToFix: s.howToFix,
    };
  });
}

// ─── Unit economics (profit definition) ──────────────────────────────────────

export function computeEconomics(inputs: FunnelInputs, a: UnitAssumptions): UnitEconomics {
  const ltgp = safeNum(a.acv * a.retentionMonths * a.grossMargin);
  const targetCac = ltgp / SCALE_GATE;
  const maxCac = ltgp;
  const cac = inputs.closed > 0 ? inputs.adSpend / inputs.closed : null;
  const ltgpCacRatio = cac && cac > 0 ? ltgp / cac : null;
  return {
    ltgp,
    targetCac,
    maxCac,
    cac,
    ltgpCacRatio,
    revenuePerLead: rate(inputs.revenue, inputs.leads),
    revenuePerCall: rate(inputs.revenue, inputs.callsShowed),
  };
}

// ─── Scaling gate (Gage's four bands, lower-bound inclusive) ──────────────────

export function computeScaling(ratio: number | null): ScalingVerdict {
  if (ratio === null) {
    return {
      band: "fix",
      label: "Fix the Funnel",
      action: "No closed deals yet, so there's no CAC to judge. Fix the constraint before spending more.",
      ratio: null,
      clearedToScale: false,
    };
  }
  let band: ScalingBand;
  let label: string;
  let action: string;
  if (ratio < 1) {
    band = "pause";
    label = "Pause";
    action = "You're losing money on every deal. Pause spend and fix the economics before anything else.";
  } else if (ratio < SCALE_GATE) {
    band = "fix";
    label = "Fix the Funnel";
    action = "Profitable, but not enough headroom to scale. Fix the funnel constraint before increasing budget.";
  } else if (ratio < 4) {
    band = "scale";
    label = "Healthy — Scale";
    action = "Healthy margin. You're cleared to increase budget while watching the constraint.";
  } else {
    band = "aggressive";
    label = "Aggressive Scale";
    action = "Strong margin. Scale aggressively while the ratio holds above 4:1.";
  }
  return { band, label, action, ratio, clearedToScale: ratio >= SCALE_GATE };
}

// ─── Constraint finder ───────────────────────────────────────────────────────

/**
 * The ONE stage to fix this week: the biggest relative shortfall vs its Good
 * line, among stages with a real sample. Ties (within an epsilon) break UPSTREAM
 * — fixing the top of the funnel cascades through every stage below it. Returns
 * null when every eligible stage is on track.
 */
export function findConstraint(stages: StageResult[]): StageResult | null {
  const EPS = 0.02;
  const eligible = stages.filter((s) => !s.lowSample && s.status !== "no_data" && s.shortfall > 0);
  if (eligible.length === 0) return null;
  // STAGES is already top-of-funnel first; keep that order so ties favour upstream.
  let best: StageResult | null = null;
  for (const s of eligible) {
    if (!best || s.shortfall > best.shortfall + EPS) best = s;
  }
  return best;
}

// ─── Constraint-to-Scale Bridge ──────────────────────────────────────────────

const fmtMoney = (n: number | null): string =>
  n === null ? "n/a" : `$${Math.round(n).toLocaleString("en-US")}`;
const fmtPct = (n: number | null): string => (n === null ? "n/a" : `${(n * 100).toFixed(1)}%`);

/**
 * Simulate fixing the constraint to its Good line, holding every downstream rate
 * constant, and recompute closed → CAC → LTGP:CAC. Answers the only question that
 * matters: if you fix this one thing, are you cleared to scale?
 */
export function computeBridge(
  inputs: FunnelInputs,
  stages: StageResult[],
  econ: UnitEconomics,
  constraint: StageResult | null,
): Bridge {
  const currentClosed = inputs.closed;
  const currentCac = econ.cac;
  const currentRatio = econ.ltgpCacRatio;

  if (!constraint) {
    return {
      available: false,
      constraintKey: null,
      projectedClosed: currentClosed,
      currentClosed,
      projectedCac: currentCac,
      currentCac,
      projectedRatio: currentRatio,
      currentRatio,
      crossesGate: (currentRatio ?? 0) >= SCALE_GATE,
      sentence:
        "Every stage with a real sample is on or above its target. Hold the line and watch the scaling gate.",
    };
  }

  const idx = STAGES.findIndex((s) => s.key === constraint.key);
  // Output of the fixed stage if it hit its Good line.
  let count = constraint.denominator * constraint.benchmark.good;
  // Propagate through downstream stages at their CURRENT actual rates.
  for (let j = idx + 1; j < STAGES.length; j++) {
    const r = stages[j].rate ?? 0;
    count = count * r;
  }
  const projectedClosed = count;
  const projectedCac = projectedClosed > 0 ? inputs.adSpend / projectedClosed : null;
  const projectedRatio = projectedCac && projectedCac > 0 ? econ.ltgp / projectedCac : null;
  const crossesGate = (projectedRatio ?? 0) >= SCALE_GATE;

  const closedNow = Math.round(currentClosed);
  const closedThen = Math.max(closedNow, Math.round(projectedClosed));
  const gateClause = crossesGate
    ? `your LTGP:CAC crosses ${SCALE_GATE}:1, and then you're cleared to scale.`
    : `your LTGP:CAC moves to ${projectedRatio === null ? "n/a" : projectedRatio.toFixed(1)}:1 — still under ${SCALE_GATE}:1, so keep fixing before you scale.`;

  const sentence =
    `${constraint.label} is your constraint at ${fmtPct(constraint.rate)}. ` +
    `Hit the ${fmtPct(constraint.benchmark.good)} Good line and you go from ${closedNow} ` +
    `close${closedNow === 1 ? "" : "s"} to about ${closedThen}, CAC drops from ${fmtMoney(currentCac)} ` +
    `to about ${fmtMoney(projectedCac)}, and ${gateClause}`;

  return {
    available: true,
    constraintKey: constraint.key,
    projectedClosed,
    currentClosed,
    projectedCac,
    currentCac,
    projectedRatio,
    currentRatio,
    crossesGate,
    sentence,
  };
}

// ─── Top-level diagnosis ─────────────────────────────────────────────────────

/** Run the full CRO diagnosis for one week's inputs. Pure + deterministic. */
export function diagnose(
  inputs: FunnelInputs,
  assumptions: UnitAssumptions,
  benchmarks: BenchmarkLadder = DEFAULT_BENCHMARKS,
): CroDiagnosis {
  const stages = computeStages(inputs, benchmarks);
  const econ = computeEconomics(inputs, assumptions);
  const scaling = computeScaling(econ.ltgpCacRatio);
  const constraint = findConstraint(stages);
  const bridge = computeBridge(inputs, stages, econ, constraint);
  return { stages, econ, scaling, constraint, bridge };
}
