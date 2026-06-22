import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals } from "@/lib/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { hasStripe, stripe } from "@/lib/stripe/client";

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
    .select({ id: proposals.id, subId: proposals.stripeSubscriptionId })
    .from(proposals)
    .where(
      and(
        eq(proposals.type, "management"),
        eq(proposals.autoRenew, false),
        isNotNull(proposals.stripeSubscriptionId),
      ),
    );

  const fixed: string[] = [];
  const errors: string[] = [];

  for (const r of rows) {
    if (!r.subId) continue;
    try {
      const sub = await stripe().subscriptions.retrieve(r.subId);
      // Only touch a still-active subscription that isn't already scheduled to stop.
      if (sub.status === "active" && !sub.cancel_at_period_end && !sub.cancel_at) {
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

  return NextResponse.json({ ok: true, dryRun, checked: rows.length, fixed, errors });
}

export async function GET(req: NextRequest) {
  return reconcile(req);
}
export async function POST(req: NextRequest) {
  return reconcile(req);
}
