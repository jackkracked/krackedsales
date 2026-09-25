import crypto from "crypto";
import type Stripe from "stripe";
import { eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, customerPayments, localContacts } from "@/lib/db/schema";
import { hasStripe, stripe } from "@/lib/stripe/client";
import { monthlyAmount } from "@/lib/stripe/cycle";

/**
 * Customer sync — the single source of truth for the Customers tab.
 *
 * REVENUE SOURCE = PAID INVOICES (amount_paid, net of credit notes), grouped by email (fallback:
 * Stripe customer id). This is authoritative for this business: subscriptions, projects and deposits
 * are all invoiced, and invoices capture ACH / wire / out-of-band payments that never create a Stripe
 * `charge` (the reason the old charge-based sync missed clients like Josh's ongoing $20k/mo). Customers
 * who only ever paid by a non-invoice charge (rare one-offs) are added from charges as a fallback.
 *
 * STATUS: active = paid within 45 days OR a live subscription (active/trialing/past_due). Invoice-billed
 * clients have no Stripe subscription, so recency is the real "currently paying" signal here.
 *
 * READ-ONLY against Stripe. Only writes our own rows. Never clobbers contact_id or source (manual/backfill).
 */

const ACTIVE_SUB = new Set(["active", "trialing", "past_due"]);
const ACTIVE_WINDOW_MS = 45 * 24 * 60 * 60 * 1000;

function monthlyCents(unit: number, interval: string | undefined, intervalCount: number | undefined, qty: number | undefined): number {
  // Shared helper: a 30-day cycle is the monthly retainer, not 1.0139 months. See lib/stripe/cycle.ts.
  return Math.round(monthlyAmount(unit, interval, intervalCount, qty));
}
function detectTest(name: string, email: string, netCents: number): boolean {
  const hay = `${name} ${email}`.toLowerCase();
  if (/\btest\b|example\.com|probe|signprobe|\bdemo\b/.test(hay)) return true;
  if (netCents <= 500) return true;
  return false;
}

interface Agg {
  name: string;
  email: string;
  ids: Set<string>;
  net: number;
  gross: number;
  refunded: number;
  count: number;
  first: number;
  last: number;
  currencies: Set<string>;
  source: "invoice" | "charge";
}
function keyOf(email: string, cid: string | null): string {
  return email.toLowerCase().trim() || cid || "";
}
function ensure(map: Map<string, Agg>, k: string, name: string, email: string, source: Agg["source"]): Agg {
  let p = map.get(k);
  if (!p) {
    p = { name, email, ids: new Set(), net: 0, gross: 0, refunded: 0, count: 0, first: Number.MAX_SAFE_INTEGER, last: 0, currencies: new Set(), source };
    map.set(k, p);
  }
  if (!p.name && name) p.name = name;
  if (!p.email && email) p.email = email;
  return p;
}

export interface SyncResult { customers: number; active: number; durationMs: number }

export async function syncCustomersFromStripe(): Promise<SyncResult> {
  const started = Date.now();
  if (!hasStripe()) throw new Error("Stripe not configured");
  const s = stripe();

  // 1) PAID INVOICES — the authoritative revenue source.
  const people = new Map<string, Agg>();
  const custIds = new Set<string>();
  const payments: { dedupeKey: string; stripeId: string; source: string; amountNet: number; currency: string; paidAt: Date }[] = [];
  for await (const iv of s.invoices.list({ status: "paid", limit: 100, expand: ["data.customer"] })) {
    const cust = iv.customer && typeof iv.customer === "object" ? (iv.customer as Stripe.Customer) : null;
    const cid = cust ? cust.id : typeof iv.customer === "string" ? iv.customer : null;
    const email = cust?.email || iv.customer_email || "";
    const name = cust?.name || iv.customer_name || "";
    const k = keyOf(email, cid);
    if (!k) continue;
    if (cid) custIds.add(cid);
    const p = ensure(people, k, name, email, "invoice");
    if (cid) p.ids.add(cid);
    const credit = iv.post_payment_credit_notes_amount ?? 0;
    const net = iv.amount_paid - credit;
    const paidAt = iv.status_transitions?.paid_at ?? iv.created;
    p.net += net;
    p.gross += iv.amount_paid;
    p.refunded += credit;
    p.count += 1;
    p.first = Math.min(p.first, paidAt);
    p.last = Math.max(p.last, paidAt);
    if (iv.currency) p.currencies.add(iv.currency);
    if (iv.id) payments.push({ dedupeKey: k, stripeId: iv.id, source: "invoice", amountNet: net, currency: iv.currency ?? "usd", paidAt: new Date(paidAt * 1000) });
  }

  // Keep the per-payment table fresh (for the date-range aggregation). Bulk upsert in chunks.
  for (let i = 0; i < payments.length; i += 200) {
    await db()
      .insert(customerPayments)
      .values(payments.slice(i, i + 200))
      .onConflictDoUpdate({ target: customerPayments.stripeId, set: { dedupeKey: sql`excluded.dedupe_key`, amountNet: sql`excluded.amount_net`, paidAt: sql`excluded.paid_at` } });
  }

  // 2) Charges — only for people with NO invoices (true one-off / non-invoice payers).
  const chargePeople = new Map<string, Agg>();
  for await (const ch of s.charges.list({ limit: 100, expand: ["data.customer"] })) {
    if (ch.status !== "succeeded" || !ch.paid) continue;
    const cust = ch.customer && typeof ch.customer === "object" ? (ch.customer as Stripe.Customer) : null;
    const cid = cust ? cust.id : typeof ch.customer === "string" ? ch.customer : null;
    const email = cust?.email || ch.billing_details?.email || ch.receipt_email || "";
    const name = cust?.name || ch.billing_details?.name || "";
    const k = keyOf(email, cid) || `charge_${ch.id}`;
    const p = ensure(chargePeople, k, name, email, "charge");
    if (cid) p.ids.add(cid);
    p.net += ch.amount - ch.amount_refunded;
    p.gross += ch.amount;
    p.refunded += ch.amount_refunded;
    p.count += 1;
    p.first = Math.min(p.first, ch.created);
    p.last = Math.max(p.last, ch.created);
    if (ch.currency) p.currencies.add(ch.currency);
  }
  for (const [k, c] of chargePeople) {
    if (!people.has(k)) {
      people.set(k, c);
      for (const id of c.ids) custIds.add(id);
    }
  }

  // 3) Subscriptions per customer id (status + MRR).
  const subsByCust = new Map<string, Stripe.Subscription[]>();
  const ids = [...custIds];
  for (let i = 0; i < ids.length; i += 8) {
    await Promise.all(ids.slice(i, i + 8).map(async (id) => {
      try { subsByCust.set(id, (await s.subscriptions.list({ customer: id, status: "all", limit: 20 })).data); }
      catch { subsByCust.set(id, []); }
    }));
  }

  // 4) Build + upsert.
  const now = Date.now();
  let activeCount = 0;
  for (const [k, p] of people.entries()) {
    let allSubs: Stripe.Subscription[] = [];
    for (const id of p.ids) allSubs = allSubs.concat(subsByCust.get(id) ?? []);
    const liveSubs = allSubs.filter((x) => ACTIVE_SUB.has(x.status));
    const everSub = allSubs.length > 0;

    let mrr = 0;
    let subDetail: string | null = null;
    let subStatus = "none";
    if (liveSubs.length) {
      subStatus = liveSubs[0].status;
      for (const sub of liveSubs) for (const it of sub.items.data) mrr += monthlyCents(it.price.unit_amount ?? 0, it.price.recurring?.interval, it.price.recurring?.interval_count ?? undefined, it.quantity);
      const it0 = liveSubs[0].items.data[0];
      subDetail = `$${((it0?.price.unit_amount ?? 0) / 100).toLocaleString()}/${it0?.price.recurring?.interval ?? "mo"} (${subStatus}${liveSubs[0].cancel_at_period_end ? ", ending" : ""})`;
    } else if (everSub) {
      subStatus = allSubs[0].status;
      subDetail = `cancelled (was $${((allSubs[0].items.data[0]?.price.unit_amount ?? 0) / 100).toLocaleString()}/mo)`;
    }

    const paidRecently = now - p.last * 1000 <= ACTIVE_WINDOW_MS;
    const status = paidRecently || liveSubs.length ? "active" : "inactive";
    if (status === "active") activeCount++;
    const type = everSub ? "subscription" : "one_off";
    const name = p.name || p.email || "Unknown";

    const refreshable = {
      email: p.email || null,
      name,
      stripeCustomerIds: [...p.ids],
      ltvNet: p.net,
      grossPaid: p.gross,
      refunded: p.refunded,
      paymentsCount: p.count,
      currency: [...p.currencies][0] ?? "usd",
      firstPaidAt: p.first < Number.MAX_SAFE_INTEGER ? new Date(p.first * 1000) : null,
      lastPaidAt: p.last ? new Date(p.last * 1000) : null,
      status,
      type,
      currentMrr: mrr,
      subscriptionStatus: subStatus,
      subscriptionDetail: subDetail,
      isTest: detectTest(name, p.email, p.net),
      syncedAt: new Date(),
      updatedAt: new Date(),
    };

    await db()
      .insert(customers)
      .values({ dedupeKey: k, ...refreshable })
      .onConflictDoUpdate({ target: customers.dedupeKey, set: refreshable }); // contact_id + source preserved
  }

  return { customers: people.size, active: activeCount, durationMs: Date.now() - started };
}

/**
 * Link every unlinked customer to a contact: match an existing local_contact by email, else create a
 * LOCAL-ONLY contact (id `cust_<hash>`, source='stripe', never pushed to GHL). Keeps new payers wired
 * up automatically on each sync. Idempotent (only touches customers with no contact_id).
 */
export async function linkCustomersToContacts(): Promise<{ matched: number; created: number }> {
  const unlinked = await db()
    .select({ id: customers.id, dedupeKey: customers.dedupeKey, email: customers.email, name: customers.name, status: customers.status })
    .from(customers)
    .where(isNull(customers.contactId));

  let matched = 0;
  let created = 0;
  for (const c of unlinked) {
    let contactId: string | null = null;
    if (c.email) {
      const rows = await db()
        .select({ id: localContacts.id })
        .from(localContacts)
        .where(sql`lower(${localContacts.email}) = ${c.email.toLowerCase()}`)
        .orderBy(sql`(case when ${localContacts.id} like 'cust_%' then 1 else 0 end)`)
        .limit(1);
      contactId = rows[0]?.id ?? null;
    }
    if (contactId) {
      await db().update(localContacts).set({ isCustomer: true, customerStatus: c.status, updatedAt: new Date() }).where(eq(localContacts.id, contactId));
      matched++;
    } else {
      contactId = "cust_" + crypto.createHash("sha1").update(c.dedupeKey).digest("hex").slice(0, 24);
      const name = c.name || c.email || "Unknown";
      const parts = name.split(/\s+/);
      const brand = name.match(/\(([^)]+)\)/)?.[1] ?? null;
      await db()
        .insert(localContacts)
        .values({
          id: contactId,
          firstName: parts[0] || name,
          lastName: parts.slice(1).join(" ") || null,
          fullName: name,
          email: c.email ?? null,
          companyName: brand,
          source: "stripe",
          isCustomer: true,
          customerStatus: c.status,
        })
        .onConflictDoUpdate({ target: localContacts.id, set: { isCustomer: true, customerStatus: c.status, updatedAt: new Date() } });
      created++;
    }
    await db().update(customers).set({ contactId, updatedAt: new Date() }).where(eq(customers.id, c.id));
  }
  return { matched, created };
}

/** Push each linked customer's status onto its contact row (for the Contacts-tab badge). */
export async function mirrorCustomerStatusToContacts(): Promise<number> {
  const rows = await db()
    .select({ contactId: customers.contactId, status: customers.status })
    .from(customers)
    .where(isNotNull(customers.contactId));
  let n = 0;
  for (const r of rows) {
    if (!r.contactId) continue;
    await db()
      .update(localContacts)
      .set({ isCustomer: true, customerStatus: r.status, updatedAt: new Date() })
      .where(eq(localContacts.id, r.contactId));
    n++;
  }
  return n;
}
