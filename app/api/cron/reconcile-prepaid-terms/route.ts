import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, localStripeInvoices } from "@/lib/db/schema";
import { and, eq, isNotNull, gt } from "drizzle-orm";
import { hasStripe, stripe } from "@/lib/stripe/client";
import { MONTHS_IN_TERM } from "@/lib/proposals/ninety-day-billing";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Safety net for pay-in-full (auto-renew OFF) management subscriptions.
 *
 * A prepaid term is a Stripe subscription whose single period equals the whole term,
 * set to `cancel_at_period_end` so it bills EXACTLY ONCE and never renews. That flag is
 * normally set by the checkout.session.completed webhook. This cron guarantees it: if the
 * webhook ever failed to set it, the client would otherwise be charged a second full term
 * at renewal. Every day we find each active prepaid subscription that is NOT yet set to
 * cancel and set it — catching any miss long before the (months-away) renewal date.
 *
 * Protected by CRON_SECRET (this path is public in proxy.ts so the cron runner can reach it,
 * and the route validates the secret itself). Pass ?dryRun=1 to preview without changing Stripe.
 */
async function reconcile(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasStripe()) return NextResponse.json({ ok: true, skipped: "no stripe configured" });

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";

  // Every pay-in-full management proposal that has a live subscription.
  const rows = await db()
    .select({
      id: proposals.id,
      subId: proposals.stripeSubscriptionId,
      managementOption: proposals.managementOption,
      autoRebillMode: proposals.autoRebillMode,
    })
    .from(proposals)
    .where(
      and(
        eq(proposals.type, "management"),
        eq(proposals.autoRenew, false),
        isNotNull(proposals.stripeSubscriptionId),
      ),
    );

  const fixed: string[] = [];
  // Spread subs are reported, never auto-repaired: fixing one means writing to a live subscription.
  const skippedSpread: string[] = [];
  // Spread terms marked complete by the read-only backstop below.
  const completedTerms: string[] = [];
  const errors: string[] = [];

  for (const r of rows) {
    if (!r.subId) continue;
    try {
      const sub = await stripe().subscriptions.retrieve(r.subId);

      // ── Term completion backstop (READ-ONLY against Stripe) ─────────────────────────────
      // The primary signal is the customer.subscription.deleted webhook. That event has NEVER
      // been delivered to this endpoint (verified against stripe_events, which has 10 other
      // types), and it could not be confirmed as enabled because the Stripe API was unreachable.
      // If it is not subscribed, a fully-collected 90-day term would sit at "partial" forever.
      // This pass reaches the same conclusion from observed state instead of an event, so the
      // gap closes either way. It writes ONLY to our own database — it never modifies the
      // subscription — and it sends nothing.
      if (r.managementOption === "spread" && sub.status === "canceled") {
        // Identical rules to the customer.subscription.deleted handler in the Stripe webhook.
        // gt(amountPaid, 0): Stripe's $0 trial-opener invoices carry status 'paid' (7 such rows
        // in production), and counting them would let a churned 2-of-3 client read as complete.
        const paidInvoices = await db()
          .select({ id: localStripeInvoices.id, paidAt: localStripeInvoices.paidAt })
          .from(localStripeInvoices)
          .where(and(
            eq(localStripeInvoices.subscriptionId, r.subId),
            eq(localStripeInvoices.status, "paid"),
            gt(localStripeInvoices.amountPaid, 0),
          ));
        // Only a bill-then-stop term ends by design. On "monthly"/"full90" no cancel_at is ever
        // set, so a deleted subscription means the client CHURNED — never a completed term.
        const endsByDesign = (r.autoRebillMode ?? "none") === "none";
        if (paidInvoices.length >= MONTHS_IN_TERM && endsByDesign) {
          const [current] = await db()
            .select({ status: proposals.status, paidAt: proposals.paidAt })
            .from(proposals).where(eq(proposals.id, r.id)).limit(1);
          // Only on the transition, and never over a human's decision (lost/void).
          if (current && !["completed", "lost", "void"].includes(current.status)) {
            if (!dryRun) {
              await db().update(proposals).set({
                status: "completed",
                // paidAt was stamped at the first payment and MUST be preserved: commission and
                // unit economics key on it, not on status.
                // Backfill from the EARLIEST real payment, never `now` — commission and unit
                // economics key on paidAt, so stamping it here backdates the deal by ~90 days.
                ...(current.paidAt
                  ? {}
                  : {
                      paidAt: paidInvoices
                        .map((i) => i.paidAt)
                        .filter((d): d is Date => !!d)
                        .sort((a, b) => a.getTime() - b.getTime())[0] ?? new Date(),
                    }),
                updatedAt: new Date(),
              }).where(eq(proposals.id, r.id));
            }
            completedTerms.push(r.subId);
            console.log(`[reconcile-prepaid] Term COMPLETE for proposal ${r.id}: ${paidInvoices.length} payments collected, sub ${r.subId} canceled.`);
          }
        } else {
          console.warn(`[reconcile-prepaid] Sub ${r.subId} (proposal ${r.id}) is canceled with only ${paidInvoices.length}/${MONTHS_IN_TERM} collected — left alone for review.`);
        }
        continue;
      }

      // Only touch a still-active subscription that isn't already scheduled to stop.
      if (sub.status === "active" && !sub.cancel_at_period_end && !sub.cancel_at) {
        // `cancel_at_period_end` is only correct when ONE period IS the whole term: a
        // paid-in-full "upfront" sub (month x3) or a legacy monthly retainer.
        //
        // It is WRONG for a "spread" sub, whose period is a single 30-day instalment. Ending it
        // at the current period end stops the term after ONE $1,500 payment of $4,500, and this
        // loop would then report it as "fixed". Spread proposals DO reach here: they store
        // autoRenew=false (the "bill then stop" default) — verified against production, where
        // 4 of 4 spread rows have autoRenew=false and 2 already hold a live subscription.
        //
        // So a spread sub is SKIPPED and surfaced, never modified. Auto-repairing it would mean
        // writing to a live subscription, which is deliberately out of scope. This branch only
        // triggers when stopAfterTerm already failed, which already raised a Slack alert.
        if (r.managementOption === "spread") {
          skippedSpread.push(r.subId);
          console.warn(
            `[reconcile-prepaid] SKIPPED spread sub ${r.subId} (proposal ${r.id}): it has no cancel_at, ` +
              `but cancel_at_period_end would truncate the 90-day term to ONE payment. Needs a manual cancel_at.`,
          );
          continue;
        }
        if (!dryRun) {
          await stripe().subscriptions.update(r.subId, { cancel_at_period_end: true });
        }
        fixed.push(r.subId);
        console.log(`[reconcile-prepaid] Set cancel_at_period_end on ${r.subId} (proposal ${r.id})`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      errors.push(`${r.subId}: ${msg}`);
      console.error(`[reconcile-prepaid] Failed on ${r.subId} (proposal ${r.id}):`, msg);
    }
  }

  return NextResponse.json({ ok: true, dryRun, checked: rows.length, fixed, skippedSpread, completedTerms, errors });
}

export async function GET(req: NextRequest) {
  return reconcile(req);
}
export async function POST(req: NextRequest) {
  return reconcile(req);
}
