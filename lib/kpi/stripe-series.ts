/**
 * Stripe-sourced KPI series: cash collected (a flow, summed over a range) and
 * MRR (a level, reconstructed as-of any point in time).
 *
 * The shared /api/kpis/business endpoint only ever returns *current* MRR, so it
 * can't drive a trend or a period-over-period delta. Here we fetch every
 * subscription once (active + canceled) and reconstruct MRR at any date from each
 * sub's created / canceled_at timestamps — the standard ChartMogul-style approach.
 *
 * Cash is fetched once across the widest window the caller needs (current + the
 * comparison period) so we only hit Stripe a single time per request.
 */
import Stripe from "stripe";
import { stripe, hasStripe } from "@/lib/stripe/client";
import type { Bucket } from "./buckets";
import { bucketSum } from "./buckets";

async function paginateAll<T extends { id: string }>(
  fetcher: (startingAfter?: string) => Promise<{ data: T[]; has_more: boolean }>,
): Promise<T[]> {
  const all: T[] = [];
  let startingAfter: string | undefined;
  while (true) {
    const page = await fetcher(startingAfter);
    all.push(...page.data);
    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return all;
}

/** Normalise a subscription item's price to a monthly dollar amount. */
function toMonthlyDollars(item: Stripe.SubscriptionItem): number {
  const unitAmount = item.price.unit_amount ?? 0;
  const interval = item.price.recurring?.interval ?? "month";
  const count = item.price.recurring?.interval_count ?? 1;
  let monthlyCents: number;
  switch (interval) {
    case "year":  monthlyCents = unitAmount / (12 * count); break;
    case "week":  monthlyCents = (unitAmount * 52) / (12 * count); break;
    case "day":   monthlyCents = (unitAmount * 365) / (12 * count); break;
    default:      monthlyCents = unitAmount / count; // month
  }
  return monthlyCents / 100;
}

interface ChargePoint { created: number; amount: number } // created = unix seconds, amount = dollars
interface SubPoint { created: number; canceledAt: number | null; monthly: number }

export interface StripeKpiSeries {
  hasData: boolean;
  /** Cash collected (succeeded charges) summed over [start, end) in dollars. */
  cashInRange: (start: Date, end: Date) => number;
  /** Cash per bucket, in dollars. */
  cashByBuckets: (buckets: Bucket[]) => number[];
  /** Reconstructed MRR (dollars) as of an instant. */
  mrrAsOf: (date: Date) => number;
  /** MRR at the end of each bucket, in dollars. */
  mrrByBuckets: (buckets: Bucket[]) => number[];
  /** MRR right now. */
  currentMrr: number;
}

const EMPTY: StripeKpiSeries = {
  hasData: false,
  cashInRange: () => 0,
  cashByBuckets: (b) => b.map(() => 0),
  mrrAsOf: () => 0,
  mrrByBuckets: (b) => b.map(() => 0),
  currentMrr: 0,
};

/**
 * Load Stripe data once for the widest window the caller needs.
 * `fetchStart`/`fetchEnd` should span both the selected range and its comparison
 * period so a single fetch covers every cash calculation.
 */
export async function loadStripeKpiSeries(fetchStart: Date, fetchEnd: Date): Promise<StripeKpiSeries> {
  if (!hasStripe()) return EMPTY;

  const s = stripe();
  const startUnix = Math.floor(fetchStart.getTime() / 1000);
  const endUnix = Math.floor(fetchEnd.getTime() / 1000);

  let charges: ChargePoint[] = [];
  let subs: SubPoint[] = [];

  try {
    const [rawCharges, activeSubs, canceledSubs] = await Promise.all([
      paginateAll<Stripe.Charge>((after) =>
        s.charges.list({
          created: { gte: startUnix, lt: endUnix },
          limit: 100,
          ...(after ? { starting_after: after } : {}),
        }),
      ),
      paginateAll<Stripe.Subscription>((after) =>
        s.subscriptions.list({ status: "active", limit: 100, ...(after ? { starting_after: after } : {}) }),
      ),
      paginateAll<Stripe.Subscription>((after) =>
        s.subscriptions.list({ status: "canceled", limit: 100, ...(after ? { starting_after: after } : {}) }),
      ),
    ]);

    charges = rawCharges
      .filter((c) => c.status === "succeeded")
      .map((c) => ({ created: c.created, amount: c.amount / 100 }));

    subs = [...activeSubs, ...canceledSubs].map((sub) => {
      const item = sub.items.data[0];
      return {
        created: sub.created,
        canceledAt: sub.canceled_at ?? null,
        monthly: item ? toMonthlyDollars(item) : 0,
      };
    });
  } catch (e) {
    console.error("[kpi/stripe-series] Stripe fetch failed:", e);
    return EMPTY;
  }

  const cashInRange = (start: Date, end: Date): number => {
    const lo = Math.floor(start.getTime() / 1000);
    const hi = Math.floor(end.getTime() / 1000);
    return charges.filter((c) => c.created >= lo && c.created < hi).reduce((sum, c) => sum + c.amount, 0);
  };

  const cashByBuckets = (buckets: Bucket[]): number[] =>
    bucketSum(charges, (c) => new Date(c.created * 1000), (c) => c.amount, buckets);

  // MRR as-of an instant: subs created on/before the instant and not yet canceled at it.
  const mrrAsOf = (date: Date): number => {
    const t = Math.floor(date.getTime() / 1000);
    return subs
      .filter((sub) => sub.created <= t && (sub.canceledAt == null || sub.canceledAt > t))
      .reduce((sum, sub) => sum + sub.monthly, 0);
  };

  const mrrByBuckets = (buckets: Bucket[]): number[] =>
    // Level at the end of each bucket (clamped to now so the current bucket reads "today").
    buckets.map((b) => mrrAsOf(new Date(Math.min(b.end.getTime(), Date.now()))));

  return {
    hasData: true,
    cashInRange,
    cashByBuckets,
    mrrAsOf,
    mrrByBuckets,
    currentMrr: mrrAsOf(new Date()),
  };
}
