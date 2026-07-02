import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, proposalInstalments } from "@/lib/db/schema";
import { eq, isNull, and, inArray } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { stripe, hasStripe } from "@/lib/stripe/client";
import { settleDeposits } from "@/lib/proposals/deposit-billing";

export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!hasStripe()) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const stripeClient = stripe();

  let invoicesProcessed = 0;
  let proposalsUpdated = 0;
  let instalmentsUpdated = 0;
  let subscriptionsLinked = 0;
  let cancellationsRecorded = 0;

  // ─── 1. Paid invoices ─────────────────────────────────────────────────────
  // Fetches every paid invoice from Stripe and matches it to proposals/instalments.
  {
    let hasMore = true;
    let startingAfter: string | undefined = undefined;

    while (hasMore) {
      const page = await stripeClient.invoices.list({
        status: "paid",
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });

      for (const invoice of page.data) {
        invoicesProcessed++;
        const meta = invoice.metadata ?? {};
        const proposalId = meta.proposal_id ?? null;
        const instalmentNumber = meta.instalment_number ?? null;

        const paidAt = invoice.status_transitions?.paid_at
          ? new Date(invoice.status_transitions.paid_at * 1000)
          : new Date(invoice.created * 1000);

        // Instalment payment
        if (proposalId && instalmentNumber) {
          const result = await db()
            .update(proposalInstalments)
            .set({ status: "paid", paidAt })
            .where(
              and(
                eq(proposalInstalments.stripeInvoiceId, invoice.id),
                inArray(proposalInstalments.status, ["pending", "failed"])
              )
            )
            .returning({ id: proposalInstalments.id });

          instalmentsUpdated += result.length;

          // Deposit instalments must settle through settleDeposits so the subscription is
          // created (and the deposit gate + start date honoured), never flip the proposal
          // paid directly. This closes the gap where a missed webhook + a backfill would
          // mark a deposit deal paid with no recurring subscription.
          if (meta.is_deposit === "true") {
            await settleDeposits(proposalId).catch((e) => console.error("[backfill] settleDeposits failed:", e));
            continue;
          }

          // Non-deposit instalment plan: mark the parent proposal paid once all are paid.
          if (result.length > 0) {
            const allInstalments = await db()
              .select({ status: proposalInstalments.status })
              .from(proposalInstalments)
              .where(eq(proposalInstalments.proposalId, proposalId));

            if (allInstalments.every((i) => i.status === "paid")) {
              const r = await db()
                .update(proposals)
                .set({ status: "paid", paidAt, updatedAt: new Date() })
                .where(and(eq(proposals.id, proposalId), isNull(proposals.paidAt)))
                .returning({ id: proposals.id });
              proposalsUpdated += r.length;
            }
          }
          continue;
        }

        // Single / subscription first-payment — match by metadata.proposal_id
        if (proposalId) {
          const r = await db()
            .update(proposals)
            .set({ status: "paid", paidAt, updatedAt: new Date() })
            .where(and(eq(proposals.id, proposalId), isNull(proposals.paidAt)))
            .returning({ id: proposals.id });
          proposalsUpdated += r.length;
          continue;
        }

        // Fallback: match by stripeInvoiceId stored on the proposal
        if (invoice.id) {
          const r = await db()
            .update(proposals)
            .set({ status: "paid", paidAt, updatedAt: new Date() })
            .where(
              and(
                eq(proposals.stripeInvoiceId, invoice.id),
                isNull(proposals.paidAt)
              )
            )
            .returning({ id: proposals.id });
          proposalsUpdated += r.length;
        }
      }

      hasMore = page.has_more;
      if (page.data.length > 0) {
        startingAfter = page.data[page.data.length - 1].id;
      }
    }
  }

  // ─── 2. Active subscriptions ──────────────────────────────────────────────
  // Ensures proposals for active subscriptions are marked paid and have the
  // subscription ID linked (in case the checkout.session.completed webhook was missed).
  {
    let hasMore = true;
    let startingAfter: string | undefined = undefined;

    while (hasMore) {
      const page = await stripeClient.subscriptions.list({
        status: "active",
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });

      for (const sub of page.data) {
        const meta = sub.metadata ?? {};
        const proposalId = meta.proposal_id ?? null;

        const paidAt = new Date(sub.created * 1000);

        if (proposalId) {
          const r = await db()
            .update(proposals)
            .set({
              status: "paid",
              paidAt,
              stripeSubscriptionId: sub.id,
              updatedAt: new Date(),
            })
            .where(and(eq(proposals.id, proposalId), isNull(proposals.paidAt)))
            .returning({ id: proposals.id });
          subscriptionsLinked += r.length;
        } else {
          // Match by stripeSubscriptionId already stored
          const r = await db()
            .update(proposals)
            .set({ status: "paid", paidAt, updatedAt: new Date() })
            .where(
              and(
                eq(proposals.stripeSubscriptionId, sub.id),
                isNull(proposals.paidAt)
              )
            )
            .returning({ id: proposals.id });
          subscriptionsLinked += r.length;
        }
      }

      hasMore = page.has_more;
      if (page.data.length > 0) {
        startingAfter = page.data[page.data.length - 1].id;
      }
    }
  }

  // ─── 3. Cancelled subscriptions ───────────────────────────────────────────
  // Records cancelledAt for any subscriptions that ended.
  {
    let hasMore = true;
    let startingAfter: string | undefined = undefined;

    while (hasMore) {
      const page = await stripeClient.subscriptions.list({
        status: "canceled",
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });

      for (const sub of page.data) {
        if (!sub.canceled_at) continue;
        const cancelledAt = new Date(sub.canceled_at * 1000);

        const r = await db()
          .update(proposals)
          .set({ cancelledAt, updatedAt: new Date() })
          .where(
            and(
              eq(proposals.stripeSubscriptionId, sub.id),
              isNull(proposals.cancelledAt)
            )
          )
          .returning({ id: proposals.id });

        cancellationsRecorded += r.length;
      }

      hasMore = page.has_more;
      if (page.data.length > 0) {
        startingAfter = page.data[page.data.length - 1].id;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    summary: {
      invoicesProcessed,
      proposalsUpdated,
      instalmentsUpdated,
      subscriptionsLinked,
      cancellationsRecorded,
    },
  });
}
