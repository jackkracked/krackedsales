/**
 * Normalising a Stripe price to a monthly figure, in ONE place.
 *
 * This logic was copy-pasted into eight files (stripe/sync, stripe/watchdog, kpis/metrics,
 * kpis/business, kpis/detail, customers/sync, kpi/stripe-series, kpi/engine/datasets/stripe).
 * They all agreed, which was fine until the 90-day "spread" price became `day x 30`: the generic
 * day formula (`unit x 365 / 12`) values a 30-day cycle at 1.0139 months, so a $1,500 retainer
 * would have reported as $1,520.83/mo in Management MRR across every one of those surfaces.
 *
 * A 30-day cycle IS the monthly retainer. It is billed 12.17 times a year rather than 12, but it
 * is sold, quoted and reported as $1,500/month, so that is what MRR must say.
 */

/** The spread plan's cadence. Kept in sync with SPREAD_CADENCE_DAYS in lib/proposals/billing.ts. */
const SPREAD_CADENCE_DAYS = 30;

/**
 * Value of one month of a recurring price, in the price's own units (cents in, cents out).
 * Returns 0 for a missing amount so callers can sum without guarding.
 */
export function monthlyAmount(
  unitAmount: number | null | undefined,
  interval: string | null | undefined,
  intervalCount: number | null | undefined,
  quantity: number | null | undefined = 1,
): number {
  const unit = unitAmount ?? 0;
  const count = intervalCount && intervalCount > 0 ? intervalCount : 1;
  const qty = quantity && quantity > 0 ? quantity : 1;
  const total = unit * qty;

  switch (interval) {
    case "year":
      return total / (12 * count);
    case "week":
      return (total * 52) / (12 * count);
    case "day":
      // A 30-day cycle is the monthly retainer, reported at its face value rather than
      // annualised. Any other day-based cadence still annualises normally.
      if (count === SPREAD_CADENCE_DAYS) return total;
      return (total * 365) / (12 * count);
    default: // "month"
      return total / count;
  }
}
