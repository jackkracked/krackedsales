/**
 * One-time Stripe backfill script.
 * Run with: npx tsx --env-file=.env.backfill scripts/stripe-backfill.ts
 */

import Stripe from "stripe";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, isNull, and, inArray } from "drizzle-orm";
import * as schema from "../lib/db/schema";

const { proposals, proposalInstalments } = schema;

const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-04-22.dahlia" as Parameters<typeof Stripe>[1]["apiVersion"],
});

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

async function run() {
  let invoicesProcessed = 0;
  let proposalsUpdated = 0;
  let instalmentsUpdated = 0;
  let subscriptionsLinked = 0;
  let cancellationsRecorded = 0;

  // ─── 1. Paid invoices ─────────────────────────────────────────────────────
  console.log("Fetching paid invoices...");
  let hasMore = true;
  let startingAfter: string | undefined;

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

      if (proposalId && instalmentNumber) {
        // Instalment payment
        const result = await db
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

        if (result.length > 0) {
          const all = await db
            .select({ status: proposalInstalments.status })
            .from(proposalInstalments)
            .where(eq(proposalInstalments.proposalId, proposalId));

          if (all.every((i) => i.status === "paid")) {
            const r = await db
              .update(proposals)
              .set({ status: "paid", paidAt, updatedAt: new Date() })
              .where(and(eq(proposals.id, proposalId), isNull(proposals.paidAt)))
              .returning({ id: proposals.id });
            proposalsUpdated += r.length;
            if (r.length) console.log(`  Proposal ${proposalId} marked paid (all instalments done)`);
          }
        }
        continue;
      }

      if (proposalId) {
        const r = await db
          .update(proposals)
          .set({ status: "paid", paidAt, updatedAt: new Date() })
          .where(and(eq(proposals.id, proposalId), isNull(proposals.paidAt)))
          .returning({ id: proposals.id });
        proposalsUpdated += r.length;
        if (r.length) console.log(`  Proposal ${proposalId} marked paid (invoice ${invoice.id})`);
        continue;
      }

      // Fallback: match by stripeInvoiceId stored on the proposal row
      const r = await db
        .update(proposals)
        .set({ status: "paid", paidAt, updatedAt: new Date() })
        .where(
          and(eq(proposals.stripeInvoiceId, invoice.id), isNull(proposals.paidAt))
        )
        .returning({ id: proposals.id });
      proposalsUpdated += r.length;
      if (r.length) console.log(`  Proposal matched by invoiceId ${invoice.id}`);
    }

    hasMore = page.has_more;
    if (page.data.length > 0) startingAfter = page.data[page.data.length - 1].id;
  }

  console.log(`\nInvoices processed: ${invoicesProcessed}`);

  // ─── 2. Active subscriptions ──────────────────────────────────────────────
  console.log("\nFetching active subscriptions...");
  hasMore = true;
  startingAfter = undefined;

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
        const r = await db
          .update(proposals)
          .set({ status: "paid", paidAt, stripeSubscriptionId: sub.id, updatedAt: new Date() })
          .where(and(eq(proposals.id, proposalId), isNull(proposals.paidAt)))
          .returning({ id: proposals.id });
        subscriptionsLinked += r.length;
        if (r.length) console.log(`  Subscription ${sub.id} linked to proposal ${proposalId}`);
      } else {
        const r = await db
          .update(proposals)
          .set({ status: "paid", paidAt, updatedAt: new Date() })
          .where(
            and(eq(proposals.stripeSubscriptionId, sub.id), isNull(proposals.paidAt))
          )
          .returning({ id: proposals.id });
        subscriptionsLinked += r.length;
        if (r.length) console.log(`  Subscription ${sub.id} backfilled via stripeSubscriptionId`);
      }
    }

    hasMore = page.has_more;
    if (page.data.length > 0) startingAfter = page.data[page.data.length - 1].id;
  }

  // ─── 3. Cancelled subscriptions ───────────────────────────────────────────
  console.log("\nFetching cancelled subscriptions...");
  hasMore = true;
  startingAfter = undefined;

  while (hasMore) {
    const page = await stripeClient.subscriptions.list({
      status: "canceled",
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    for (const sub of page.data) {
      if (!sub.canceled_at) continue;
      const cancelledAt = new Date(sub.canceled_at * 1000);

      const r = await db
        .update(proposals)
        .set({ cancelledAt, updatedAt: new Date() })
        .where(
          and(eq(proposals.stripeSubscriptionId, sub.id), isNull(proposals.cancelledAt))
        )
        .returning({ id: proposals.id });

      cancellationsRecorded += r.length;
      if (r.length) console.log(`  Cancellation recorded for subscription ${sub.id}`);
    }

    hasMore = page.has_more;
    if (page.data.length > 0) startingAfter = page.data[page.data.length - 1].id;
  }

  console.log("\n─── Backfill complete ───────────────────────────────────────");
  console.log(`  Invoices scanned:        ${invoicesProcessed}`);
  console.log(`  Proposals updated:       ${proposalsUpdated}`);
  console.log(`  Instalments updated:     ${instalmentsUpdated}`);
  console.log(`  Subscriptions linked:    ${subscriptionsLinked}`);
  console.log(`  Cancellations recorded:  ${cancellationsRecorded}`);
  console.log("────────────────────────────────────────────────────────────\n");
}

run().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
