/**
 * lib/kpi/engine/datasets/stripe-local.ts
 *
 * Mirror-backed loaders for the Stripe KPI datasets. Each returns the EXACT same normalized
 * RawRow shape as the live loader in stripe.ts, just sourced from local_stripe_* instead of
 * Stripe's API. Money is stored as cents in the mirror → /100 here to match the live dollars;
 * dates are timestamptz → .getTime() reproduces the live `created * 1000` epoch-ms.
 */
import type Stripe from "stripe";
import { and, gte, lt, inArray, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { localStripeCharges, localStripeInvoices, localStripeSubscriptions, localStripeRefunds, proposals } from "@/lib/db/schema";
import type { LoadCtx, RawRow } from "../types";
import { monthlyAmount } from "@/lib/stripe/cycle";

function toMonthlyDollars(unit: number, interval: string | null, count: number): number {
  // Shared helper: a 30-day cycle is the monthly retainer, not 1.0139 months. See lib/stripe/cycle.ts.
  // This is the LOCAL mirror path (stripeSource=local); it must agree with the live path exactly,
  // or the same client reports $1,500/mo on one and $1,520.83/mo on the other.
  return monthlyAmount(unit, interval, count) / 100;
}

export async function loadChargesLocal({ fetchStart, fetchEnd }: LoadCtx): Promise<RawRow[]> {
  const rows = await db()
    .select({
      customerName: localStripeCharges.customerName,
      status: localStripeCharges.status,
      amount: localStripeCharges.amount,
      fee: localStripeCharges.fee,
      currency: localStripeCharges.currency,
      description: localStripeCharges.description,
      created: localStripeCharges.created,
    })
    .from(localStripeCharges)
    .where(and(gte(localStripeCharges.created, fetchStart), lt(localStripeCharges.created, fetchEnd)));
  return rows.map((r) => ({
    customer: r.customerName ?? "Unknown",
    status: r.status,
    amount: (r.amount ?? 0) / 100,
    fee: (r.fee ?? 0) / 100,
    currency: r.currency,
    description: r.description ?? "",
    created: r.created ? r.created.getTime() : 0,
  }));
}

export async function loadInvoicesLocal({ fetchStart, fetchEnd }: LoadCtx): Promise<RawRow[]> {
  const now = Date.now();
  const rows = await db()
    .select({
      customerName: localStripeInvoices.customerName,
      number: localStripeInvoices.number,
      id: localStripeInvoices.id,
      status: localStripeInvoices.status,
      amountPaid: localStripeInvoices.amountPaid,
      amountRemaining: localStripeInvoices.amountRemaining,
      isSubscription: localStripeInvoices.isSubscription,
      created: localStripeInvoices.created,
      dueDate: localStripeInvoices.dueDate,
    })
    .from(localStripeInvoices)
    .where(and(gte(localStripeInvoices.created, fetchStart), lt(localStripeInvoices.created, fetchEnd)));
  return rows.map((inv) => ({
    customer: inv.customerName ?? "Unknown",
    number: inv.number ?? inv.id ?? "",
    status: inv.status ?? "open",
    amount_paid: (inv.amountPaid ?? 0) / 100,
    amount_remaining: (inv.amountRemaining ?? 0) / 100,
    is_subscription: inv.isSubscription ?? false,
    due_date_passed: inv.dueDate != null && inv.dueDate.getTime() < now,
    created: inv.created ? inv.created.getTime() : 0,
    due_date: inv.dueDate ? inv.dueDate.getTime() : null,
  }));
}

export async function loadSubscriptionsLocal(_ctx: LoadCtx): Promise<RawRow[]> {
  // Universe = active + canceled + past_due (the 3 statuses the live loader fetches).
  const rows = await db()
    .select({
      id: localStripeSubscriptions.id,
      customerName: localStripeSubscriptions.customerName,
      status: localStripeSubscriptions.status,
      unit: localStripeSubscriptions.item0UnitAmount,
      interval: localStripeSubscriptions.item0Interval,
      intervalCount: localStripeSubscriptions.item0IntervalCount,
      created: localStripeSubscriptions.created,
      canceledAt: localStripeSubscriptions.canceledAt,
    })
    .from(localStripeSubscriptions)
    .where(inArray(localStripeSubscriptions.status, ["active", "canceled", "past_due"]));

  // is_prepaid joins proposals.autoRenew=false (paid-in-full = self-cancelling sub) — same as live.
  const prepaidIds = new Set<string>();
  try {
    const p = await db()
      .select({ stripeSubscriptionId: proposals.stripeSubscriptionId })
      .from(proposals)
      .where(and(eq(proposals.autoRenew, false), isNotNull(proposals.stripeSubscriptionId)));
    for (const r of p) if (r.stripeSubscriptionId) prepaidIds.add(r.stripeSubscriptionId);
  } catch (e) {
    console.error("[kpi/datasets/stripe-local.subscriptions] prepaid join failed:", e);
  }

  return rows.map((sub) => ({
    customer: sub.customerName ?? "Unknown",
    status: sub.status,
    monthly_amount: toMonthlyDollars(sub.unit ?? 0, sub.interval, sub.intervalCount ?? 1),
    is_prepaid: prepaidIds.has(sub.id),
    created: sub.created ? sub.created.getTime() : 0,
    canceled_at: sub.canceledAt ? sub.canceledAt.getTime() : null,
  }));
}

// ════════════════════════════════════════════════════════════════════════════
//  Legacy /api/kpis/metrics pass — mirror rows reshaped into the minimal Stripe
//  object shapes its reductions consume, so that pass reads local too (no live
//  Stripe calls remain when stripeSource=local). The route's reduction logic is
//  byte-untouched; only the data source changes. Money stays in CENTS, dates in
//  UNIX SECONDS (what the legacy pass expects).
// ════════════════════════════════════════════════════════════════════════════

type LegacyCharge = Stripe.Charge & { balance_transaction: Stripe.BalanceTransaction | null };

export async function legacyChargesLocal(start: Date, end: Date): Promise<LegacyCharge[]> {
  const rows = await db()
    .select({ status: localStripeCharges.status, amount: localStripeCharges.amount, fee: localStripeCharges.fee, created: localStripeCharges.created })
    .from(localStripeCharges)
    .where(and(gte(localStripeCharges.created, start), lt(localStripeCharges.created, end)));
  return rows.map((r) => ({
    status: r.status,
    amount: r.amount ?? 0,
    created: r.created ? Math.floor(r.created.getTime() / 1000) : 0,
    balance_transaction: { fee: r.fee ?? 0 },
  })) as unknown as LegacyCharge[];
}

export async function legacyPaidInvoicesLocal(start: Date, end: Date): Promise<Stripe.Invoice[]> {
  const rows = await db()
    .select({ parentType: localStripeInvoices.parentType, customerId: localStripeInvoices.customerId, amountPaid: localStripeInvoices.amountPaid })
    .from(localStripeInvoices)
    .where(and(eq(localStripeInvoices.status, "paid"), gte(localStripeInvoices.created, start), lt(localStripeInvoices.created, end)));
  return rows.map((r) => ({
    parent: r.parentType ? { type: r.parentType } : null,
    customer: r.customerId,
    amount_paid: r.amountPaid ?? 0,
  })) as unknown as Stripe.Invoice[];
}

export async function legacySubsLocal(status: "active" | "canceled"): Promise<Stripe.Subscription[]> {
  const rows = await db()
    .select({
      customerId: localStripeSubscriptions.customerId,
      unit: localStripeSubscriptions.item0UnitAmount,
      interval: localStripeSubscriptions.item0Interval,
      intervalCount: localStripeSubscriptions.item0IntervalCount,
      created: localStripeSubscriptions.created,
      canceledAt: localStripeSubscriptions.canceledAt,
    })
    .from(localStripeSubscriptions)
    .where(eq(localStripeSubscriptions.status, status));
  return rows.map((r) => ({
    customer: r.customerId,
    created: r.created ? Math.floor(r.created.getTime() / 1000) : 0,
    canceled_at: r.canceledAt ? Math.floor(r.canceledAt.getTime() / 1000) : null,
    items: { data: [{ price: { unit_amount: r.unit ?? 0, recurring: { interval: r.interval ?? "month", interval_count: r.intervalCount ?? 1 } } }] },
  })) as unknown as Stripe.Subscription[];
}

export async function legacyRefundsLocal(start: Date, end: Date): Promise<Stripe.Refund[]> {
  const rows = await db()
    .select({ amount: localStripeRefunds.amount })
    .from(localStripeRefunds)
    .where(and(gte(localStripeRefunds.created, start), lt(localStripeRefunds.created, end)));
  return rows.map((r) => ({ amount: r.amount ?? 0 })) as unknown as Stripe.Refund[];
}

export async function legacyOpenInvoicesLocal(): Promise<Stripe.Invoice[]> {
  const rows = await db()
    .select({ amountRemaining: localStripeInvoices.amountRemaining })
    .from(localStripeInvoices)
    .where(eq(localStripeInvoices.status, "open"));
  return rows.map((r) => ({ amount_remaining: r.amountRemaining ?? 0 })) as unknown as Stripe.Invoice[];
}
