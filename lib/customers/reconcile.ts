import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

/**
 * Recompute a single customer's cached money aggregates from customer_payments after a
 * MANUAL payment is added / edited / deleted, so the slide-over hero, the table row and the
 * all-time ribbon all agree with the payments list.
 *
 * ltv_net       = sum(amount_net) over ALL rows (Stripe + manual).
 * gross_paid    = ltv_net + refunded. Uses the identity gross = net + refunded; `refunded`
 *                 is Stripe-only and left untouched (manual payments never have refunds), so
 *                 gross correctly rises by the manual amount without needing per-row gross.
 * payments_count / first_paid_at / last_paid_at = straight from customer_payments.
 *
 * Status/MRR are intentionally left to the Stripe sync (out of scope for manual entries).
 */
export async function reconcileCustomerAggregates(dedupeKey: string): Promise<void> {
  await db().execute(sql`
    UPDATE customers c SET
      ltv_net = agg.net,
      gross_paid = agg.net + c.refunded,
      payments_count = agg.cnt,
      first_paid_at = agg.first_at,
      last_paid_at = agg.last_at,
      updated_at = now()
    FROM (
      SELECT
        COALESCE(SUM(amount_net), 0)::int AS net,
        COUNT(*)::int AS cnt,
        MIN(paid_at) AS first_at,
        MAX(paid_at) AS last_at
      FROM customer_payments
      WHERE dedupe_key = ${dedupeKey}
    ) AS agg
    WHERE c.dedupe_key = ${dedupeKey}
  `);
}
