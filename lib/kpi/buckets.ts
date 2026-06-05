/**
 * Adaptive trend buckets for KPI sparklines.
 *
 * A date range can be a single day or a full year. Plotting one point per day
 * works for short ranges but is meaningless (and huge) for "Year to Date", so we
 * pick the granularity from the span:
 *   - ≤ 35 days  → one point per day
 *   - ≤ 182 days → one point per week
 *   - otherwise  → one point per month
 *
 * The window is always clamped to `now`, so a range that runs into the future
 * (e.g. Month to Date, where the picker's end is tomorrow) never renders a tail
 * of zero points — which is what made the New Leads sparkline "spike then flatline".
 */
import {
  eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval,
  startOfDay, startOfWeek, startOfMonth,
  addDays, addWeeks, addMonths,
  differenceInCalendarDays, format,
} from "date-fns";

export type Granularity = "day" | "week" | "month";

export interface Bucket {
  /** Inclusive start of the bucket. */
  start: Date;
  /** Exclusive end of the bucket — test membership with `t >= start && t < end`. */
  end: Date;
  /** Human label for the x-axis / tooltip. */
  label: string;
}

/**
 * Build trend buckets across [start, end), clamped so we never bucket the future.
 */
export function getAdaptiveBuckets(start: Date, end: Date, now: Date = new Date()): Bucket[] {
  // Clamp the visible window to "now" so trailing future days aren't plotted as zeros.
  const cap = end.getTime() < now.getTime() ? end : now;
  if (cap.getTime() <= start.getTime()) return [];

  const spanDays = differenceInCalendarDays(cap, start) + 1;
  const granularity: Granularity = spanDays <= 35 ? "day" : spanDays <= 182 ? "week" : "month";

  let raw: Bucket[];
  if (granularity === "day") {
    raw = eachDayOfInterval({ start, end: cap }).map((d) => {
      const s = startOfDay(d);
      return { start: s, end: addDays(s, 1), label: format(s, "MMM d") };
    });
  } else if (granularity === "week") {
    raw = eachWeekOfInterval({ start, end: cap }, { weekStartsOn: 1 }).map((d) => {
      const s = startOfWeek(d, { weekStartsOn: 1 });
      return { start: s, end: addWeeks(s, 1), label: format(s, "MMM d") };
    });
  } else {
    raw = eachMonthOfInterval({ start, end: cap }).map((d) => {
      const s = startOfMonth(d);
      return { start: s, end: addMonths(s, 1), label: format(s, "MMM") };
    });
  }

  if (!raw.length) return raw;
  // Weekly/monthly buckets snap to calendar boundaries that can fall outside the
  // selected window — clamp the first/last bucket so edge points never count
  // events before `start` or after the clamped `cap`.
  raw[0] = { ...raw[0], start: raw[0].start < start ? start : raw[0].start };
  const lastIdx = raw.length - 1;
  raw[lastIdx] = { ...raw[lastIdx], end: raw[lastIdx].end > cap ? cap : raw[lastIdx].end };
  return raw;
}

/** Count rows whose date falls in each bucket. */
export function bucketCount<T>(
  rows: T[],
  getDate: (row: T) => Date | string | null | undefined,
  buckets: Bucket[],
): number[] {
  const times = rows
    .map((r) => {
      const d = getDate(r);
      return d ? new Date(d).getTime() : NaN;
    })
    .filter((t) => !Number.isNaN(t));
  return buckets.map((b) => {
    const lo = b.start.getTime();
    const hi = b.end.getTime();
    return times.filter((t) => t >= lo && t < hi).length;
  });
}

/** Sum a numeric field over rows whose date falls in each bucket. */
export function bucketSum<T>(
  rows: T[],
  getDate: (row: T) => Date | string | null | undefined,
  getValue: (row: T) => number,
  buckets: Bucket[],
): number[] {
  return buckets.map((b) => {
    const lo = b.start.getTime();
    const hi = b.end.getTime();
    return rows.reduce((sum, r) => {
      const d = getDate(r);
      if (!d) return sum;
      const t = new Date(d).getTime();
      return t >= lo && t < hi ? sum + getValue(r) : sum;
    }, 0);
  });
}
