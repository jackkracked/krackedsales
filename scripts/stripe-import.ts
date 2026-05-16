/**
 * Stripe → Proposals import script.
 *
 * Creates proposal records in the DB from real Stripe payment history so
 * that KPI metrics populate accurately.
 *
 * Run with:
 *   npx tsx --env-file=.env.backfill scripts/stripe-import.ts
 *
 * Safe to re-run — skips any subscription/invoice already imported.
 */

import Stripe from "stripe";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, or } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import crypto from "crypto";

const { proposals } = schema;

// ─── Clients ─────────────────────────────────────────────────────────────────

const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!.trim(), {
  // @ts-expect-error - version string
  apiVersion: "2026-04-22.dahlia",
});

const sql = neon((process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL)!);
const db = drizzle(sql, { schema });

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION = process.env.GHL_LOCATION_ID!;
const GHL_TOKEN = process.env.GHL_PRIVATE_TOKEN!;

// ─── GHL contact lookup (email → ghlContactId) ───────────────────────────────

const ghlContactCache = new Map<string, string | null>();

async function findGhlContact(email: string): Promise<string | null> {
  if (!email) return null;
  if (ghlContactCache.has(email)) return ghlContactCache.get(email)!;

  try {
    const url = `${GHL_BASE}/contacts/?locationId=${GHL_LOCATION}&query=${encodeURIComponent(email)}&limit=5`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${GHL_TOKEN}`,
        Version: "2021-07-28",
      },
    });
    if (!res.ok) {
      ghlContactCache.set(email, null);
      return null;
    }
    const data = await res.json() as { contacts?: Array<{ id: string; email?: string }> };
    const match = (data.contacts ?? []).find(
      (c) => c.email?.toLowerCase() === email.toLowerCase()
    );
    const id = match?.id ?? null;
    ghlContactCache.set(email, id);
    return id;
  } catch {
    ghlContactCache.set(email, null);
    return null;
  }
}

// ─── Check if proposal already imported ──────────────────────────────────────

async function alreadyImported(stripeSubscriptionId?: string | null, stripeInvoiceId?: string | null) {
  const conditions = [];
  if (stripeSubscriptionId) conditions.push(eq(proposals.stripeSubscriptionId, stripeSubscriptionId));
  if (stripeInvoiceId) conditions.push(eq(proposals.stripeInvoiceId, stripeInvoiceId));
  if (conditions.length === 0) return false;

  const rows = await db
    .select({ id: proposals.id })
    .from(proposals)
    .where(conditions.length === 1 ? conditions[0] : or(...conditions))
    .limit(1);

  return rows.length > 0;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  let managementCreated = 0;
  let managementSkipped = 0;
  let projectCreated = 0;
  let projectSkipped = 0;
  let cancellationsRecorded = 0;

  // ── 1. Active subscriptions → management proposals ───────────────────────
  console.log("\n1. Importing active subscriptions as management proposals...");

  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore) {
    const page = await stripeClient.subscriptions.list({
      status: "active",
      limit: 100,
      expand: ["data.customer"],
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    for (const sub of page.data) {
      if (await alreadyImported(sub.id, null)) {
        managementSkipped++;
        continue;
      }

      const customer = sub.customer as Stripe.Customer;
      const email = customer.email ?? "";
      const name = customer.name ?? email.split("@")[0] ?? "Unknown";

      // Get price details
      const item = sub.items.data[0];
      const unitAmount = item?.price.unit_amount ?? 0;
      const interval = item?.price.recurring?.interval ?? "month";
      const intervalCount = item?.price.recurring?.interval_count ?? 1;
      const currency = item?.price.currency ?? "usd";
      const amount = unitAmount / 100;

      // Try to match GHL contact by email
      const ghlContactId = (await findGhlContact(email)) ?? customer.id;

      const paidAt = new Date(sub.created * 1000);

      await db.insert(proposals).values({
        token: crypto.randomUUID(),
        title: `Email Retainer — ${name}`,
        type: "management",
        ghlContactId,
        contactName: name,
        contactEmail: email || null,
        status: "paid",
        totalAmount: amount,
        currency,
        paymentStructure: "subscription",
        billingInterval: interval,
        billingIntervalCount: intervalCount,
        stripeSubscriptionId: sub.id,
        stripeCustomerId: customer.id,
        paidAt,
        sentAt: paidAt,
        signedAt: paidAt,
        startDate: paidAt,
        createdAt: paidAt,
        updatedAt: new Date(),
      });

      console.log(`  ✓ ${name} (${email}) — $${amount}/${interval} [${sub.id}]`);
      managementCreated++;

      // Small delay to avoid GHL rate limits
      await new Promise((r) => setTimeout(r, 100));
    }

    hasMore = page.has_more;
    if (page.data.length > 0) startingAfter = page.data[page.data.length - 1].id;
  }

  // ── 2. Cancelled subscriptions → cancelled management proposals ──────────
  console.log("\n2. Importing cancelled subscriptions...");
  hasMore = true;
  startingAfter = undefined;

  while (hasMore) {
    const page = await stripeClient.subscriptions.list({
      status: "canceled",
      limit: 100,
      expand: ["data.customer"],
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    for (const sub of page.data) {
      if (await alreadyImported(sub.id, null)) {
        managementSkipped++;
        continue;
      }

      const customer = sub.customer as Stripe.Customer;
      const email = customer.email ?? "";
      const name = customer.name ?? email.split("@")[0] ?? "Unknown";

      const item = sub.items.data[0];
      const unitAmount = item?.price.unit_amount ?? 0;
      const interval = item?.price.recurring?.interval ?? "month";
      const intervalCount = item?.price.recurring?.interval_count ?? 1;
      const currency = item?.price.currency ?? "usd";
      const amount = unitAmount / 100;

      const ghlContactId = (await findGhlContact(email)) ?? customer.id;
      const paidAt = new Date(sub.created * 1000);
      const cancelledAt = sub.canceled_at ? new Date(sub.canceled_at * 1000) : new Date();

      await db.insert(proposals).values({
        token: crypto.randomUUID(),
        title: `Email Retainer — ${name}`,
        type: "management",
        ghlContactId,
        contactName: name,
        contactEmail: email || null,
        status: "paid",
        totalAmount: amount,
        currency,
        paymentStructure: "subscription",
        billingInterval: interval,
        billingIntervalCount: intervalCount,
        stripeSubscriptionId: sub.id,
        stripeCustomerId: customer.id,
        paidAt,
        cancelledAt,
        sentAt: paidAt,
        signedAt: paidAt,
        startDate: paidAt,
        createdAt: paidAt,
        updatedAt: new Date(),
      });

      console.log(`  ✓ ${name} (cancelled ${cancelledAt.toISOString().slice(0, 10)}) — $${amount}/${interval}`);
      managementCreated++;
      cancellationsRecorded++;

      await new Promise((r) => setTimeout(r, 100));
    }

    hasMore = page.has_more;
    if (page.data.length > 0) startingAfter = page.data[page.data.length - 1].id;
  }

  // ── 3. One-time paid invoices (non-subscription) → project proposals ─────
  console.log("\n3. Importing one-time paid invoices as project proposals...");
  hasMore = true;
  startingAfter = undefined;

  while (hasMore) {
    const page = await stripeClient.invoices.list({
      status: "paid",
      limit: 100,
      expand: ["data.customer"],
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    for (const invoice of page.data) {
      // Skip subscription invoices — already handled above
      if (invoice.subscription) {
        projectSkipped++;
        continue;
      }

      if (await alreadyImported(null, invoice.id)) {
        projectSkipped++;
        continue;
      }

      // Skip zero-value invoices
      if (!invoice.amount_paid || invoice.amount_paid === 0) {
        projectSkipped++;
        continue;
      }

      const customer = invoice.customer as Stripe.Customer;
      const email = customer.email ?? "";
      const name = customer.name ?? email.split("@")[0] ?? "Unknown";
      const amount = invoice.amount_paid / 100;
      const currency = invoice.currency ?? "usd";

      const ghlContactId = (await findGhlContact(email)) ?? customer.id;
      const paidAt = invoice.status_transitions?.paid_at
        ? new Date(invoice.status_transitions.paid_at * 1000)
        : new Date(invoice.created * 1000);

      const description = invoice.description ?? invoice.lines.data[0]?.description ?? null;

      await db.insert(proposals).values({
        token: crypto.randomUUID(),
        title: description ? description.slice(0, 100) : `Project — ${name}`,
        type: "project",
        ghlContactId,
        contactName: name,
        contactEmail: email || null,
        status: "paid",
        totalAmount: amount,
        currency,
        paymentStructure: "single",
        stripeInvoiceId: invoice.id,
        stripeCustomerId: customer.id,
        paidAt,
        sentAt: paidAt,
        signedAt: paidAt,
        createdAt: paidAt,
        updatedAt: new Date(),
      });

      console.log(`  ✓ ${name} — $${amount} [${invoice.id}]`);
      projectCreated++;

      await new Promise((r) => setTimeout(r, 100));
    }

    hasMore = page.has_more;
    if (page.data.length > 0) startingAfter = page.data[page.data.length - 1].id;
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n─── Import complete ─────────────────────────────────────────");
  console.log(`  Management proposals created:   ${managementCreated} (${cancellationsRecorded} cancelled)`);
  console.log(`  Management already existed:     ${managementSkipped}`);
  console.log(`  Project proposals created:      ${projectCreated}`);
  console.log(`  One-time invoices skipped:      ${projectSkipped}`);
  console.log("────────────────────────────────────────────────────────────\n");
}

run().catch((err) => {
  console.error("\nImport failed:", err);
  process.exit(1);
});
