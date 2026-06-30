/**
 * ════════════════════════════════════════════════════════════════════════════
 *  KPI PACING ENGINE — honest "on-track" for any reporting window.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The skew this kills: a single absolute target ($100k) compared against whatever
 * window the page shows reads as "-97% below" on Today and fine on the month. So a
 * target now has up to three cadence slots — daily / weekly / monthly — and for the
 * selected window we compute a PACE TARGET (the cadence target scaled to the days
 * that have actually elapsed), then compare the value to that.
 *
 * Worked examples (all verified by the classification below):
 *   • Today (Jun 26)            → daily target, no proration.      $3.1k vs $3k  → +4%
 *   • Month to date (Jun 1–26)  → monthly × 26/30 = $86.7k.        $86.2k        → on pace
 *   • Whole month (Jun 1–Jul 1) → monthly × 30/30 = $100k.         exact
 *   • Week to date (Mon–Wed)    → weekly × 3/7.
 *   • Last 7 / Last 30 / custom → daily run-rate × elapsed days (no clean period).
 *   • Year to date              → monthly run-rate × elapsed days.
 *
 * Proration is whole-day: today counts as one elapsed day (no intraday math). That's
 * the standard pacing convention and it self-corrects by end of day. Everything here
 * is pure — no React, no I/O — so the configurator's live preview and the cell badge
 * read the exact same numbers.
 */

import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  getDay,
  getDaysInMonth,
  startOfDay,
  startOfMonth,
} from "date-fns";

export type Cadence = "daily" | "weekly" | "monthly";
export type TargetDirection = "higher" | "lower";

export const DAYS_PER_WEEK = 7;
/** 365.25 / 12 — keeps daily↔monthly conversions stable across month lengths. */
export const DAYS_PER_MONTH = 30.4375;

/** Within this band of the pace target reads as a neutral "on pace" (no good/bad call). */
export const ON_PACE_PCT = 3;

export interface CadenceTargets {
  daily: number | null;
  weekly: number | null;
  monthly: number | null;
}

// ─── Cadence conversion (everything routes through a per-day rate) ───────────────

function dailyRateOf(cadence: Cadence, value: number): number {
  if (cadence === "daily") return value;
  if (cadence === "weekly") return value / DAYS_PER_WEEK;
  return value / DAYS_PER_MONTH;
}

/** Convert a target from one cadence to another via its implied daily run-rate. */
export function convertCadence(from: Cadence, to: Cadence, value: number): number {
  const rate = dailyRateOf(from, value);
  if (to === "daily") return rate;
  if (to === "weekly") return rate * DAYS_PER_WEEK;
  return rate * DAYS_PER_MONTH;
}

/**
 * Given ONE cadence value, derive all three. The anchor keeps its exact value (no
 * float drift); the other two are run-rate conversions. Powers the configurator's
 * "set one, auto-derive the rest".
 */
export function deriveCadenceTargets(anchor: Cadence, value: number): CadenceTargets {
  const out: CadenceTargets = {
    daily: convertCadence(anchor, "daily", value),
    weekly: convertCadence(anchor, "weekly", value),
    monthly: convertCadence(anchor, "monthly", value),
  };
  out[anchor] = value;
  return out;
}

/**
 * The value for a requested cadence: the set value if present, else derived from the
 * nearest cadence that IS set. Returns null only when no cadence is set at all.
 */
export function resolveCadence(targets: CadenceTargets, want: Cadence): number | null {
  const direct = targets[want];
  if (direct != null) return direct;
  const fallbackOrder: Record<Cadence, Cadence[]> = {
    daily: ["weekly", "monthly"],
    weekly: ["daily", "monthly"],
    monthly: ["weekly", "daily"],
  };
  for (const from of fallbackOrder[want]) {
    const v = targets[from];
    if (v != null) return convertCadence(from, want, v);
  }
  return null;
}

export function hasAnyTarget(targets: CadenceTargets): boolean {
  return targets.daily != null || targets.weekly != null || targets.monthly != null;
}

// ─── Window classification ──────────────────────────────────────────────────────

/** Parse a YYYY-MM-DD as that calendar day at local midnight (matches the date picker). */
function parseDay(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** start is the 1st and the window stays inside that one calendar month. */
function isMonthAligned(start: Date, end: Date): boolean {
  if (start.getDate() !== 1) return false;
  const firstOfNextMonth = startOfMonth(addMonths(start, 1));
  return end.getTime() <= firstOfNextMonth.getTime();
}

/** start is a Monday and the window stays inside that one 7-day week. */
function isWeekAligned(start: Date, end: Date): boolean {
  if (getDay(start) !== 1) return false; // date-fns: 0 = Sun, 1 = Mon
  const weekEnd = addDays(start, DAYS_PER_WEEK);
  return end.getTime() <= weekEnd.getTime();
}

// ─── The result ─────────────────────────────────────────────────────────────────

export type PeriodKind = "day" | "week" | "month" | "rolling" | "upcoming";

export interface PaceResult {
  /** The number the value is judged against (the cadence target scaled to elapsed days). */
  expected: number;
  /** The un-prorated cadence target, for the "of $X" caption. */
  fullPeriodTarget: number;
  cadence: Cadence;
  periodKind: PeriodKind;
  /** True when `expected` was scaled below the full period (a partial/rolling window). */
  prorated: boolean;
  elapsedDays: number;
  periodDays: number;
  /** value ÷ expected, for the pace meter. ≥ 0; can exceed 1. 0 when there's no usable target. */
  ratio: number;
  deltaPct: number;
  isAbove: boolean;
  isGood: boolean;
  /** Within the on-pace band (or no usable target) — render neutral, no good/bad colour. */
  neutral: boolean;
  /** The target has no usable positive value (e.g. a 0 target) — render a calm chip. */
  zeroTarget: boolean;
}

export interface PaceInput {
  value: number;
  direction: TargetDirection;
  targets: CadenceTargets;
  /** YYYY-MM-DD; end exclusive — exactly what the page's date range provides. */
  window: { start: string; end: string };
  /** Defaults to now; injected in tests/preview for determinism. */
  now?: Date;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Compute the pace verdict for a window. Returns null when there's no target to judge
 * against or the window is empty — the caller then renders no badge (today's behaviour).
 */
export function paceForWindow(input: PaceInput): PaceResult | null {
  const { value, direction, targets, window } = input;
  if (!hasAnyTarget(targets)) return null;

  const start = parseDay(window.start);
  const end = parseDay(window.end);
  const spanDays = differenceInCalendarDays(end, start);
  if (!Number.isFinite(spanDays) || spanDays <= 0) return null;

  const now = input.now ?? new Date();
  const todayStart = startOfDay(now);
  // Only count days through the end of today — future days haven't happened.
  const elapsedEndMs = Math.min(end.getTime(), addDays(todayStart, 1).getTime());
  const elapsedDays = clamp(
    differenceInCalendarDays(new Date(elapsedEndMs), start),
    0,
    spanDays,
  );

  // Window is entirely in the future — nothing to judge yet.
  if (elapsedDays <= 0) {
    return {
      expected: 0,
      fullPeriodTarget: 0,
      cadence: "monthly",
      periodKind: "upcoming",
      prorated: false,
      elapsedDays: 0,
      periodDays: spanDays,
      ratio: 0,
      deltaPct: 0,
      isAbove: false,
      isGood: false,
      neutral: true,
      zeroTarget: false,
    };
  }

  // Pick the cadence this window represents, its natural length, and the full target.
  let cadence: Cadence;
  let periodDays: number;
  let periodKind: PeriodKind;
  let full: number | null;
  let expected: number;
  let prorated: boolean;

  if (spanDays === 1) {
    cadence = "daily";
    periodDays = 1;
    periodKind = "day";
    full = resolveCadence(targets, "daily");
    expected = full ?? 0; // a day is atomic — compare to the full daily target
    prorated = false;
  } else if (isMonthAligned(start, end)) {
    cadence = "monthly";
    periodDays = getDaysInMonth(start);
    periodKind = "month";
    full = resolveCadence(targets, "monthly");
    expected = full != null ? full * (elapsedDays / periodDays) : 0;
    prorated = elapsedDays < periodDays;
  } else if (isWeekAligned(start, end)) {
    cadence = "weekly";
    periodDays = DAYS_PER_WEEK;
    periodKind = "week";
    full = resolveCadence(targets, "weekly");
    expected = full != null ? full * (elapsedDays / DAYS_PER_WEEK) : 0;
    prorated = elapsedDays < DAYS_PER_WEEK;
  } else {
    // No clean period (Last 7/30, YTD, arbitrary custom): a daily run-rate from the
    // nearest cadence × elapsed days. The 4/10-day buckets only change the result when
    // the user has set DIVERGENT bespoke per-cadence values (auto-derived cadences share
    // one daily rate, so the bucket is moot for them).
    cadence = spanDays <= 4 ? "daily" : spanDays <= 10 ? "weekly" : "monthly";
    periodDays = spanDays;
    periodKind = "rolling";
    full = resolveCadence(targets, cadence);
    expected = full != null ? dailyRateOf(cadence, full) * elapsedDays : 0;
    prorated = elapsedDays < spanDays;
  }

  // No usable positive target → calm neutral chip (mirrors the old "vs 0 target").
  if (full == null || full <= 0 || expected <= 0) {
    return {
      expected: Math.max(0, expected),
      fullPeriodTarget: full ?? 0,
      cadence,
      periodKind,
      prorated,
      elapsedDays,
      periodDays,
      ratio: 0,
      deltaPct: 0,
      isAbove: false,
      isGood: false,
      neutral: true,
      zeroTarget: true,
    };
  }

  const deltaPct = ((value - expected) / expected) * 100;
  const absPct = Math.abs(deltaPct);
  const isAbove = deltaPct > 0;
  const neutral = absPct < ON_PACE_PCT;
  const isGood = direction === "higher" ? isAbove : !isAbove;

  return {
    expected,
    fullPeriodTarget: full,
    cadence,
    periodKind,
    prorated,
    elapsedDays,
    periodDays,
    ratio: value / expected,
    deltaPct,
    isAbove,
    isGood,
    neutral,
    zeroTarget: false,
  };
}
