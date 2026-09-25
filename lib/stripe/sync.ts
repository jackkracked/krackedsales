/**
 * lib/stripe/sync.ts
 *
 * Mirrors the Stripe entities the KPI engine reads (charges / invoices / subscriptions /
 * refunds) into local Postgres tables so the engine computes from the DB (~ms) instead of
 * paginating Stripe's API live (~seconds). Field mapping is 1:1 with the engine's dataset
 * loaders (lib/kpi/engine/datasets/stripe.ts) so the numbers reproduce to the cent:
 *   - charge.amount (cents) + expanded balance_transaction.fee (cents), on charge.created
 *   - invoice status/amount_paid/amount_remaining/parent.type(is_subscription)/created/due_date
 *   - subscription status/created/canceled_at + items.data[0].price (for toMonthlyDollars)
 * Money kept as integer CENTS; dates as Date(unix*1000) so .getTime() == the engine's epoch-ms.
 *
 * Idempotent upserts — safe to re-run (backfill + reconcile cron + webhook all call these).
 */
import Stripe from "stripe";
import { stripe, hasStripe } from "@/lib/stripe/client";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { localStripeCharges, localStripeInvoices, localStripeSubscriptions, localStripeRefunds } from "@/lib/db/schema";
import { monthlyAmount } from "@/lib/stripe/cycle";

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

/** Display label — name → email → id (matches the engine's customerName()). */
function customerName(c: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined): string {
  if (!c) return "Unknown";
  if (typeof c === "string") return c;
  if (c.deleted) return (c as Stripe.DeletedCustomer).id;
  return (c as Stripe.Customer).name || (c as Stripe.Customer).email || c.id;
}
function customerId(c: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined): string | null {
  if (!c) return null;
  return typeof c === "string" ? c : c.id;
}
/** Σ all items normalized to monthly cents (the customers-basis current_mrr; convenience only). */
function monthlyCents(item: Stripe.SubscriptionItem | undefined): number {
  if (!item) return 0;
  // Shared helper: a 30-day cycle is the monthly retainer, not 1.0139 months. See lib/stripe/cycle.ts.
  return Math.round(monthlyAmount(item.price.unit_amount, item.price.recurring?.interval, item.price.recurring?.interval_count, item.quantity));
}

async function chunkUpsert<T>(items: T[], fn: (batch: T[]) => Promise<void>, size = 50): Promise<void> {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size));
}

// ─── Charges ────────────────────────────────────────────────────────────────
type ECharge = Stripe.Charge & {
  customer: Stripe.Customer | Stripe.DeletedCustomer | string | null;
  balance_transaction: Stripe.BalanceTransaction | string | null;
};

export function chargeRow(c: ECharge) {
  return {
    id: c.id,
    customerId: customerId(c.customer),
    customerName: customerName(c.customer),
    status: c.status ?? null,
    amount: c.amount ?? 0,
    currency: c.currency ?? null,
    fee: c.balance_transaction && typeof c.balance_transaction !== "string" ? (c.balance_transaction.fee ?? 0) : 0,
    description: c.description ?? null,
    refunded: c.amount_refunded ?? 0,
    paid: c.paid ?? null,
    isTest: false,
    created: c.created ? new Date(c.created * 1000) : null,
    rawData: null as unknown as Record<string, unknown> | null,
    syncedAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function upsertCharge(c: ECharge): Promise<void> {
  await db().insert(localStripeCharges).values(chargeRow(c)).onConflictDoUpdate({
    target: localStripeCharges.id,
    set: {
      customerId: sql`excluded.customer_id`, customerName: sql`excluded.customer_name`,
      status: sql`excluded.status`, amount: sql`excluded.amount`, currency: sql`excluded.currency`,
      fee: sql`excluded.fee`, description: sql`excluded.description`, refunded: sql`excluded.refunded`,
      paid: sql`excluded.paid`, created: sql`excluded.created`, updatedAt: sql`excluded.updated_at`,
    },
  });
}

// ─── Invoices ───────────────────────────────────────────────────────────────
type EInvoice = Stripe.Invoice & { customer: Stripe.Customer | Stripe.DeletedCustomer | string | null };

export function invoiceRow(inv: EInvoice) {
  const parentType = inv.parent?.type ?? null;
  return {
    id: inv.id!,
    number: inv.number ?? null,
    customerId: customerId(inv.customer),
    customerName: customerName(inv.customer),
    status: inv.status ?? null,
    amountPaid: inv.amount_paid ?? 0,
    amountRemaining: inv.amount_remaining ?? 0,
    amountDue: inv.amount_due ?? 0,
    currency: inv.currency ?? null,
    parentType,
    billingReason: inv.billing_reason ?? null,
    isSubscription: parentType === "subscription_details",
    creditNotesAmount: inv.post_payment_credit_notes_amount ?? 0,
    subscriptionId: (inv.parent?.subscription_details?.subscription as string | null) ?? null,
    created: inv.created ? new Date(inv.created * 1000) : null,
    dueDate: inv.due_date != null ? new Date(inv.due_date * 1000) : null,
    paidAt: inv.status_transitions?.paid_at != null ? new Date(inv.status_transitions.paid_at * 1000) : null,
    rawData: null as unknown as Record<string, unknown> | null,
    syncedAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function upsertInvoice(inv: EInvoice): Promise<void> {
  await db().insert(localStripeInvoices).values(invoiceRow(inv)).onConflictDoUpdate({
    target: localStripeInvoices.id,
    set: {
      number: sql`excluded.number`, customerId: sql`excluded.customer_id`, customerName: sql`excluded.customer_name`,
      status: sql`excluded.status`, amountPaid: sql`excluded.amount_paid`, amountRemaining: sql`excluded.amount_remaining`,
      amountDue: sql`excluded.amount_due`, currency: sql`excluded.currency`, parentType: sql`excluded.parent_type`,
      billingReason: sql`excluded.billing_reason`, isSubscription: sql`excluded.is_subscription`,
      creditNotesAmount: sql`excluded.credit_notes_amount`, subscriptionId: sql`excluded.subscription_id`,
      created: sql`excluded.created`, dueDate: sql`excluded.due_date`, paidAt: sql`excluded.paid_at`,
      updatedAt: sql`excluded.updated_at`,
    },
  });
}

// ─── Subscriptions ────────────────────────────────────────────────────────────
type ESub = Stripe.Subscription & { customer: Stripe.Customer | Stripe.DeletedCustomer | string };

export function subscriptionRow(sub: ESub) {
  const item0 = sub.items.data[0];
  return {
    id: sub.id,
    customerId: customerId(sub.customer),
    customerName: customerName(sub.customer),
    status: sub.status ?? null,
    created: sub.created ? new Date(sub.created * 1000) : null,
    canceledAt: sub.canceled_at != null ? new Date(sub.canceled_at * 1000) : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end ?? null,
    item0UnitAmount: item0?.price.unit_amount ?? 0,
    item0Interval: item0?.price.recurring?.interval ?? "month",
    item0IntervalCount: item0?.price.recurring?.interval_count ?? 1,
    item0Quantity: item0?.quantity ?? 1,
    currentMrrCents: sub.items.data.reduce((s, it) => s + monthlyCents(it), 0),
    priceNickname: item0?.price.nickname ?? null,
    proposalId: (sub.metadata?.proposal_id as string | undefined) ?? null,
    items: sub.items.data.map((it) => ({
      unit_amount: it.price.unit_amount, interval: it.price.recurring?.interval,
      interval_count: it.price.recurring?.interval_count, quantity: it.quantity,
    })) as unknown as Record<string, unknown>,
    rawData: null as unknown as Record<string, unknown> | null,
    syncedAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function upsertSubscription(sub: ESub): Promise<void> {
  await db().insert(localStripeSubscriptions).values(subscriptionRow(sub)).onConflictDoUpdate({
    target: localStripeSubscriptions.id,
    set: {
      customerId: sql`excluded.customer_id`, customerName: sql`excluded.customer_name`, status: sql`excluded.status`,
      created: sql`excluded.created`, canceledAt: sql`excluded.canceled_at`, cancelAtPeriodEnd: sql`excluded.cancel_at_period_end`,
      item0UnitAmount: sql`excluded.item0_unit_amount`, item0Interval: sql`excluded.item0_interval`,
      item0IntervalCount: sql`excluded.item0_interval_count`, item0Quantity: sql`excluded.item0_quantity`,
      currentMrrCents: sql`excluded.current_mrr_cents`, priceNickname: sql`excluded.price_nickname`,
      proposalId: sql`excluded.proposal_id`, items: sql`excluded.items`, updatedAt: sql`excluded.updated_at`,
    },
  });
}

// ─── Refunds ────────────────────────────────────────────────────────────────
export function refundRow(r: Stripe.Refund) {
  return {
    id: r.id,
    chargeId: (typeof r.charge === "string" ? r.charge : r.charge?.id) ?? null,
    amount: r.amount ?? 0,
    currency: r.currency ?? null,
    created: r.created ? new Date(r.created * 1000) : null,
    rawData: null as unknown as Record<string, unknown> | null,
    syncedAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function upsertRefund(r: Stripe.Refund): Promise<void> {
  await db().insert(localStripeRefunds).values(refundRow(r)).onConflictDoUpdate({
    target: localStripeRefunds.id,
    set: {
      chargeId: sql`excluded.charge_id`, amount: sql`excluded.amount`, currency: sql`excluded.currency`,
      created: sql`excluded.created`, updatedAt: sql`excluded.updated_at`,
    },
  });
}

// ─── Full sync ────────────────────────────────────────────────────────────────
/**
 * Backfill / reconcile the Stripe mirror. `sinceUnix` bounds charges/invoices/refunds by
 * created (for the reconcile cron); subscriptions (active/canceled/past_due) + a full invoice
 * pass are always fetched whole so the snapshot metrics (MRR, open invoices) stay correct.
 * Omit sinceUnix for a full backfill.
 */
export async function syncStripe(sinceUnix?: number): Promise<Record<string, number>> {
  if (!hasStripe()) return { charges: 0, invoices: 0, subscriptions: 0, refunds: 0 };
  const s = stripe();
  const createdFilter = sinceUnix ? { created: { gte: sinceUnix } } : {};

  const [charges, invoices, subs, refunds] = await Promise.all([
    paginateAll<ECharge>((after) =>
      s.charges.list({ ...createdFilter, expand: ["data.customer", "data.balance_transaction"], limit: 100, ...(after ? { starting_after: after } : {}) }) as Promise<{ data: ECharge[]; has_more: boolean }>,
    ),
    paginateAll<EInvoice>((after) =>
      s.invoices.list({ ...createdFilter, expand: ["data.customer"], limit: 100, ...(after ? { starting_after: after } : {}) }) as Promise<{ data: EInvoice[]; has_more: boolean }>,
    ),
    Promise.all(["active", "canceled", "past_due"].map((status) =>
      paginateAll<ESub>((after) =>
        s.subscriptions.list({ status: status as Stripe.SubscriptionListParams.Status, expand: ["data.customer"], limit: 100, ...(after ? { starting_after: after } : {}) }) as Promise<{ data: ESub[]; has_more: boolean }>,
      ),
    )).then((groups) => groups.flat()),
    paginateAll<Stripe.Refund>((after) =>
      s.refunds.list({ ...createdFilter, limit: 100, ...(after ? { starting_after: after } : {}) }),
    ),
  ]);

  await chunkUpsert(charges, (b) => Promise.all(b.map(upsertCharge)).then(() => {}));
  await chunkUpsert(invoices, (b) => Promise.all(b.map(upsertInvoice)).then(() => {}));
  await chunkUpsert(subs, (b) => Promise.all(b.map(upsertSubscription)).then(() => {}));
  await chunkUpsert(refunds, (b) => Promise.all(b.map(upsertRefund)).then(() => {}));

  return { charges: charges.length, invoices: invoices.length, subscriptions: subs.length, refunds: refunds.length };
}

/**
 * Real-time mirror upsert from a Stripe webhook event. Re-fetches the changed object with the
 * same expands the KPI code uses (balance_transaction.fee + customer), so the mirror row is
 * complete. Idempotent + best-effort (never throws into the webhook). Keeps the mirror current
 * between reconcile-cron runs so KPIs read fresh money numbers.
 */
export async function syncStripeEventToMirror(event: Stripe.Event): Promise<void> {
  if (!hasStripe()) return;
  const s = stripe();
  const type = event.type;
  const obj = event.data.object as { id?: string };
  const id = obj?.id;
  if (!id) return;
  try {
    if (type.startsWith("charge.refund.") || type.startsWith("refund.")) {
      await upsertRefund(await s.refunds.retrieve(id));
    } else if (type.startsWith("charge.")) {
      await upsertCharge(await s.charges.retrieve(id, { expand: ["customer", "balance_transaction"] }) as ECharge);
    } else if (type.startsWith("invoice.")) {
      await upsertInvoice(await s.invoices.retrieve(id, { expand: ["customer"] }) as EInvoice);
    } else if (type.startsWith("customer.subscription.")) {
      await upsertSubscription(await s.subscriptions.retrieve(id, { expand: ["customer"] }) as ESub);
    }
  } catch (e) {
    console.error(`[stripe mirror] event sync failed for ${type}:`, e);
  }
}
