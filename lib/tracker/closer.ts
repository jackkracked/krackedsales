import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { proposals, users } from "@/lib/db/schema";
import {
  getPayoutTiming,
  getRepCommissionEvents,
  commissionInRange,
  type CommissionEvent,
} from "@/lib/kpi/rep-proposal-commission";

/**
 * A closer's month, in the shape of Kelsey's commission workbook.
 *
 * WHY IT REUSES THE KPI COMMISSION HELPER RATHER THAN RECOMPUTING
 * `lib/kpi/rep-proposal-commission.ts` is already the single source of truth for what a rep has
 * earned, and the homepage KPI cards read from it. If this tracker did its own arithmetic, the
 * two would eventually disagree, and the month that happens is the month somebody is told their
 * pay is wrong. One engine, two views.
 *
 * WHAT "CLOSED" MEANS HERE
 * Jack, 2026-09-22, asked directly: "Closed means paid." So a proposal counts as closed on
 * `paidAt`, never on `signedAt`. The payout-timing setting (full_paid / first_instalment /
 * split) then decides WHEN within that the commission is recognised, which is the toggle Jack
 * asked for when he said 5% may not always be paid the same way.
 */

export interface CloserRow {
  proposalId: string;
  client: string;
  title: string;
  /** "Sent" | "Signed" | "Closed" | "Lost" — the state as at the end of the month shown. */
  state: string;
  amount: number;
  sentAt: string | null;
  signedAt: string | null;
  paidAt: string | null;
  lostAt: string | null;
  /** Commission recognised for THIS proposal inside the month shown. */
  commission: number;
}

export interface CloserMonth {
  userId: string;
  name: string;
  month: string; // YYYY-MM
  currency: string;
  /** How commission is recognised, so the screen can say it out loud. */
  payoutTiming: string;
  commissionPct: number;
  basePay: number;
  proposalsSent: number;
  dealsClosed: number;
  closedValue: number;
  commission: number;
  totalEstimatedPay: number;
  rows: CloserRow[];
}

/** First instant of a YYYY-MM, and of the month after it. */
export function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split("-").map(Number);
  // UTC, because every timestamp in this table is stored in UTC and a local-midnight boundary
  // would move a deal between months depending on who opened the page.
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

/** The proposal's state as at the end of the month being shown, not as at today. */
function stateAt(p: { paidAt: Date | null; lostAt: Date | null; signedAt: Date | null; sentAt: Date | null }, end: Date): string {
  if (p.paidAt && p.paidAt < end) return "Closed";
  if (p.lostAt && p.lostAt < end) return "Lost";
  if (p.signedAt && p.signedAt < end) return "Signed";
  if (p.sentAt && p.sentAt < end) return "Sent";
  return "Draft";
}

export async function getCloserMonth(userId: string, month: string): Promise<CloserMonth | null> {
  const [user] = await db()
    .select({
      id: users.id,
      name: users.name,
      commissionPct: users.commissionPct,
      basePayCents: users.basePayCents,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return null;

  const { start, end } = monthRange(month);
  const payoutTiming = await getPayoutTiming();

  // Credited to whoever CLOSED it, matching the commission engine exactly.
  const closedBySelf = sql`coalesce(${proposals.closedBy}, ${proposals.createdBy}) = ${userId}`;

  // Every proposal that TOUCHED this month: sent in it, or resolved in it. A proposal sent in
  // March and paid in April belongs on April's sheet as income and on March's as outreach, so
  // neither month can be built from a single date column.
  const touched = await db()
    .select({
      id: proposals.id,
      client: proposals.contactName,
      title: proposals.title,
      amount: proposals.totalAmount,
      currency: proposals.currency,
      sentAt: proposals.sentAt,
      signedAt: proposals.signedAt,
      paidAt: proposals.paidAt,
      lostAt: proposals.lostAt,
    })
    .from(proposals)
    .where(and(
      closedBySelf,
      sql`(
        (${proposals.sentAt}   >= ${start} AND ${proposals.sentAt}   < ${end}) OR
        (${proposals.paidAt}   >= ${start} AND ${proposals.paidAt}   < ${end}) OR
        (${proposals.signedAt} >= ${start} AND ${proposals.signedAt} < ${end}) OR
        (${proposals.lostAt}   >= ${start} AND ${proposals.lostAt}   < ${end})
      )`,
    ))
    .orderBy(asc(proposals.sentAt));

  // Commission comes from the KPI engine, so this screen and the homepage can never disagree.
  const events: CommissionEvent[] = await getRepCommissionEvents({
    userId,
    commissionPct: user.commissionPct,
    payoutTiming,
  });
  const commission = commissionInRange(events, start, end);

  const inMonth = (d: Date | null) => !!d && d >= start && d < end;
  const commissionByProposal = new Map<string, number>();
  for (const e of events) {
    if (e.date >= start && e.date < end) {
      commissionByProposal.set(e.proposalId, (commissionByProposal.get(e.proposalId) ?? 0) + e.commission);
    }
  }

  const rows: CloserRow[] = touched.map((p) => ({
    proposalId: p.id,
    client: p.client,
    title: p.title,
    state: stateAt(p, end),
    amount: p.amount,
    sentAt: p.sentAt?.toISOString() ?? null,
    signedAt: p.signedAt?.toISOString() ?? null,
    paidAt: p.paidAt?.toISOString() ?? null,
    lostAt: p.lostAt?.toISOString() ?? null,
    commission: commissionByProposal.get(p.id) ?? 0,
  }));

  const closedThisMonth = touched.filter((p) => inMonth(p.paidAt));
  const basePay = user.basePayCents / 100;

  return {
    userId: user.id,
    name: user.name,
    month,
    currency: (touched[0]?.currency ?? "usd").toUpperCase(),
    payoutTiming,
    commissionPct: user.commissionPct,
    basePay,
    proposalsSent: touched.filter((p) => inMonth(p.sentAt)).length,
    dealsClosed: closedThisMonth.length,
    closedValue: closedThisMonth.reduce((t, p) => t + p.amount, 0),
    commission,
    totalEstimatedPay: basePay + commission,
    rows,
  };
}

/** Months that actually have something in them, newest first, for the month switcher. */
export async function getCloserMonths(userId: string): Promise<string[]> {
  const rows = await db()
    .select({
      month: sql<string>`to_char(date_trunc('month', coalesce(${proposals.paidAt}, ${proposals.sentAt})), 'YYYY-MM')`,
    })
    .from(proposals)
    .where(and(
      sql`coalesce(${proposals.closedBy}, ${proposals.createdBy}) = ${userId}`,
      isNotNull(sql`coalesce(${proposals.paidAt}, ${proposals.sentAt})`),
    ))
    .groupBy(sql`1`)
    .orderBy(sql`1 desc`);
  return rows.map((r) => r.month).filter(Boolean);
}
