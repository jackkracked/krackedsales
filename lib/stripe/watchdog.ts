/**
 * lib/stripe/watchdog.ts
 *
 * Continuous proof that the local Stripe mirror equals live Stripe. Recomputes the KPI-critical
 * money aggregates (cash collected, MRR, active clients, open invoices, refunds) from BOTH the
 * mirror (SQL) and Stripe's API, and reports any divergence to the cent. Runs on a schedule; on
 * ANY drift the cron alerts Slack. This is what turns "the mirror should match" into "the mirror
 * is provably matching, and you'll know the instant it doesn't."
 */
import Stripe from "stripe";
import { stripe, hasStripe } from "@/lib/stripe/client";
import { db } from "@/lib/db";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { localStripeCharges, localStripeInvoices, localStripeSubscriptions, localStripeRefunds } from "@/lib/db/schema";
import { monthlyAmount } from "@/lib/stripe/cycle";

async function paginateAll<T extends { id: string }>(
  fetcher: (after?: string) => Promise<{ data: T[]; has_more: boolean }>,
): Promise<T[]> {
  const all: T[] = [];
  let after: string | undefined;
  while (true) {
    const p = await fetcher(after);
    all.push(...p.data);
    if (!p.has_more) break;
    after = p.data[p.data.length - 1].id;
  }
  return all;
}

function toMonthlyDollars(unit: number, interval: string | null | undefined, count: number): number {
  // Shared helper: a 30-day cycle is the monthly retainer, not 1.0139 months. See lib/stripe/cycle.ts.
  return monthlyAmount(unit, interval, count) / 100;
}

export interface WatchdogCheck { name: string; mirror: number; live: number; diff: number; match: boolean; }
export interface WatchdogReport { ok: boolean; driftCount: number; checks: WatchdogCheck[]; ranAt: string; }

export async function runStripeWatchdog(): Promise<WatchdogReport> {
  const ranAt = new Date().toISOString();
  if (!hasStripe()) return { ok: true, driftCount: 0, checks: [], ranAt };
  const s = stripe();
  const now = new Date();
  const mStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const mEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const pStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const uStart = Math.floor(mStart.getTime() / 1000), uEnd = Math.floor(mEnd.getTime() / 1000);
  const upStart = Math.floor(pStart.getTime() / 1000);

  const checks: WatchdogCheck[] = [];
  const add = (name: string, mirror: number, live: number) => {
    const diff = Math.round((mirror - live) * 100) / 100;
    checks.push({ name, mirror: Math.round(mirror * 100) / 100, live: Math.round(live * 100) / 100, diff, match: Math.abs(diff) < 0.01 });
  };
  const database = db();

  // ── Cash collected — succeeded charges (this month + last month) ──
  for (const [label, start, end, uS, uE] of [
    ["cashCollected (this month)", mStart, mEnd, uStart, uEnd] as const,
    ["cashCollected (last month)", pStart, mStart, upStart, uStart] as const,
  ]) {
    const [m] = await database.select({ v: sql<number>`coalesce(sum(${localStripeCharges.amount}),0)` })
      .from(localStripeCharges)
      .where(and(eq(localStripeCharges.status, "succeeded"), gte(localStripeCharges.created, start), lt(localStripeCharges.created, end)));
    const live = (await paginateAll<Stripe.Charge>((a) => s.charges.list({ created: { gte: uS, lt: uE }, limit: 100, ...(a ? { starting_after: a } : {}) })))
      .filter((c) => c.status === "succeeded").reduce((x, c) => x + c.amount, 0);
    add(label, Number(m.v) / 100, live / 100);
  }

  // ── Active subscriptions — MRR + count ──
  {
    const mrows = await database.select({ unit: localStripeSubscriptions.item0UnitAmount, iv: localStripeSubscriptions.item0Interval, ic: localStripeSubscriptions.item0IntervalCount })
      .from(localStripeSubscriptions).where(eq(localStripeSubscriptions.status, "active"));
    const mMrr = mrows.reduce((x, r) => x + toMonthlyDollars(r.unit ?? 0, r.iv, r.ic ?? 1), 0);
    const live = await paginateAll<Stripe.Subscription>((a) => s.subscriptions.list({ status: "active", limit: 100, ...(a ? { starting_after: a } : {}) }));
    const lMrr = live.reduce((x, sub) => x + toMonthlyDollars(sub.items.data[0]?.price.unit_amount ?? 0, sub.items.data[0]?.price.recurring?.interval, sub.items.data[0]?.price.recurring?.interval_count ?? 1), 0);
    add("active-sub MRR", mMrr, lMrr);
    add("active-sub count", mrows.length, live.length);
  }

  // ── Open invoices — count + amount owed (live snapshot) ──
  {
    const [m] = await database.select({ c: sql<number>`count(*)`, v: sql<number>`coalesce(sum(${localStripeInvoices.amountRemaining}),0)` })
      .from(localStripeInvoices).where(eq(localStripeInvoices.status, "open"));
    const live = await paginateAll<Stripe.Invoice>((a) => s.invoices.list({ status: "open", limit: 100, ...(a ? { starting_after: a } : {}) }));
    add("open-invoice amount", Number(m.v) / 100, live.reduce((x, inv) => x + (inv.amount_remaining ?? 0), 0) / 100);
    add("open-invoice count", Number(m.c), live.length);
  }

  // ── Refunds this month ──
  {
    const [m] = await database.select({ v: sql<number>`coalesce(sum(${localStripeRefunds.amount}),0)` })
      .from(localStripeRefunds).where(and(gte(localStripeRefunds.created, mStart), lt(localStripeRefunds.created, mEnd)));
    const live = (await paginateAll<Stripe.Refund>((a) => s.refunds.list({ created: { gte: uStart, lt: uEnd }, limit: 100, ...(a ? { starting_after: a } : {}) })))
      .reduce((x, r) => x + r.amount, 0);
    add("refunds (this month)", Number(m.v) / 100, live / 100);
  }

  const driftCount = checks.filter((c) => !c.match).length;
  return { ok: driftCount === 0, driftCount, checks, ranAt };
}
