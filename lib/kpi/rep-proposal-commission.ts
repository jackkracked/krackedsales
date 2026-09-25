/**
 * lib/kpi/rep-proposal-commission.ts
 *
 * SINGLE SOURCE OF TRUTH for a rep's proposal-based commission + closed-deal
 * figures. Every surface (the homepage KPI cards, their click-through breakdown
 * drawer, and the dashboard KPI strip) computes from this helper so the numbers
 * and the drawer rows can never disagree.
 *
 * A "deal" counts for the rep who CLOSED it: COALESCE(closedBy, createdBy), which is what
 * lib/db/schema.ts documents and what the Tofu Go case needs (Alice's deal, sent by Gage while
 * she was tied up, and the leaderboard credited Gage). `closedBy` is null on every row today,
 * so this is a no-op on current data and a correctness fix the moment anyone sets it. Commission is recognised per the org's payoutTiming setting,
 * mirroring /api/kpi/rep-metrics exactly:
 *   - "split":            commission as each instalment is paid (per-payment)
 *   - "first_instalment": full proposal commission when the 1st instalment is paid
 *   - "full_paid":        commission when the whole proposal is paid (default)
 */
import { db } from "@/lib/db";
import { proposals, proposalInstalments, commissionSettings } from "@/lib/db/schema";
import { and, eq, isNotNull, sql, type SQL } from "drizzle-orm";

export type PayoutTiming = "split" | "first_instalment" | "full_paid";

/** One commission-earning event for a rep, on the date it was recognised. */
export interface CommissionEvent {
  proposalId: string;
  label: string; // client / proposal name
  sublabel?: string; // "Paid in full" | "Deposit" | "Instalment 2" | "First payment"
  date: Date; // paidAt that triggered this commission
  saleAmount: number; // the dollar amount this event represents
  commission: number; // saleAmount * commissionPct / 100
}

/** Detail-drawer row shape (matches KpiDetailSheet's expected fields). */
export interface DetailRow {
  label: string;
  sublabel?: string;
  amount: number;
  date: string; // ISO
  inPeriod: boolean;
}

export async function getPayoutTiming(): Promise<PayoutTiming> {
  try {
    const [row] = await db()
      .select({ payoutTiming: commissionSettings.payoutTiming })
      .from(commissionSettings)
      .limit(1);
    return (row?.payoutTiming as PayoutTiming) ?? "full_paid";
  } catch {
    return "full_paid";
  }
}

/**
 * All commission-earning events for a rep, newest first. Volume per rep is small,
 * so we load all paid items and let callers slice by period.
 */
export async function getRepCommissionEvents(opts: {
  userId: string;
  commissionPct: number;
  payoutTiming: PayoutTiming;
}): Promise<CommissionEvent[]> {
  const { userId, commissionPct, payoutTiming } = opts;
  if (!userId || commissionPct <= 0) return [];
  return getCommissionEventsWhere({
    where: sql`coalesce(${proposals.closedBy}, ${proposals.createdBy}) = ${userId}`,
    commissionPct,
    payoutTiming,
  });
}

/**
 * Commission events for ANY set of proposals, chosen by `where`.
 *
 * WHY THIS EXISTS: the pay tracker credits a SETTER on proposals she did not close, chosen by
 * which booking led to them, not by `closedBy`. Recognition (split / first instalment / full)
 * must be identical for both, so the timing logic lives here once and each caller only decides
 * WHICH proposals. `getRepCommissionEvents` is this with the closer predicate.
 *
 * Pass `commissionPct: 100` to get events whose `commission` equals the base amount, for callers
 * that apply a different rate per month.
 */
export async function getCommissionEventsWhere(opts: {
  where: SQL;
  commissionPct: number;
  payoutTiming: PayoutTiming;
}): Promise<CommissionEvent[]> {
  const { where, commissionPct, payoutTiming } = opts;
  if (commissionPct <= 0) return [];
  const rate = commissionPct / 100;
  const events: CommissionEvent[] = [];

  if (payoutTiming === "split") {
    // One event per paid instalment...
    const insts = await db()
      .select({
        proposalId: proposals.id,
        name: proposals.contactName,
        title: proposals.title,
        amount: proposalInstalments.amount,
        paidAt: proposalInstalments.paidAt,
        instalmentNumber: proposalInstalments.instalmentNumber,
        isDeposit: proposalInstalments.isDeposit,
      })
      .from(proposalInstalments)
      .innerJoin(proposals, eq(proposalInstalments.proposalId, proposals.id))
      .where(and(where, isNotNull(proposalInstalments.paidAt)));
    for (const i of insts) {
      events.push({
        proposalId: i.proposalId,
        label: i.name || i.title,
        sublabel: i.isDeposit ? "Deposit" : `Instalment ${i.instalmentNumber}`,
        date: i.paidAt!,
        saleAmount: i.amount,
        commission: i.amount * rate,
      });
    }
    // ...plus single-payment proposals (no instalments)
    const singles = await db()
      .select({ proposalId: proposals.id, name: proposals.contactName, title: proposals.title, totalAmount: proposals.totalAmount, paidAt: proposals.paidAt })
      .from(proposals)
      .where(and(where, eq(proposals.paymentStructure, "single"), isNotNull(proposals.paidAt)));
    for (const p of singles) {
      events.push({ proposalId: p.proposalId, label: p.name || p.title, sublabel: "Paid in full", date: p.paidAt!, saleAmount: p.totalAmount, commission: p.totalAmount * rate });
    }
  } else if (payoutTiming === "first_instalment") {
    // Full proposal commission on the first instalment's payment date...
    const firsts = await db()
      .select({ proposalId: proposals.id, name: proposals.contactName, title: proposals.title, totalAmount: proposals.totalAmount, paidAt: proposalInstalments.paidAt })
      .from(proposalInstalments)
      .innerJoin(proposals, eq(proposalInstalments.proposalId, proposals.id))
      .where(and(where, eq(proposalInstalments.instalmentNumber, 1), isNotNull(proposalInstalments.paidAt)));
    for (const p of firsts) {
      events.push({ proposalId: p.proposalId, label: p.name || p.title, sublabel: "First payment", date: p.paidAt!, saleAmount: p.totalAmount, commission: p.totalAmount * rate });
    }
    const singles = await db()
      .select({ proposalId: proposals.id, name: proposals.contactName, title: proposals.title, totalAmount: proposals.totalAmount, paidAt: proposals.paidAt })
      .from(proposals)
      .where(and(where, eq(proposals.paymentStructure, "single"), isNotNull(proposals.paidAt)));
    for (const p of singles) {
      events.push({ proposalId: p.proposalId, label: p.name || p.title, sublabel: "Paid in full", date: p.paidAt!, saleAmount: p.totalAmount, commission: p.totalAmount * rate });
    }
  } else {
    // "full_paid" — commission when the entire proposal is paid
    const paid = await db()
      .select({ proposalId: proposals.id, name: proposals.contactName, title: proposals.title, totalAmount: proposals.totalAmount, paidAt: proposals.paidAt })
      .from(proposals)
      .where(and(where, isNotNull(proposals.paidAt)));
    for (const p of paid) {
      events.push({ proposalId: p.proposalId, label: p.name || p.title, sublabel: "Paid in full", date: p.paidAt!, saleAmount: p.totalAmount, commission: p.totalAmount * rate });
    }
  }

  events.sort((a, b) => b.date.getTime() - a.date.getTime());
  return events;
}

const inRange = (d: Date, start: Date, end: Date) => d >= start && d < end;

/** Commission $ earned within [start, end). */
export function commissionInRange(events: CommissionEvent[], start: Date, end: Date): number {
  return events.filter((e) => inRange(e.date, start, end)).reduce((t, e) => t + e.commission, 0);
}

/** Distinct proposals that closed (paid) within [start, end). */
export function dealsClosedInRange(events: CommissionEvent[], start: Date, end: Date): number {
  const ids = new Set<string>();
  for (const e of events) if (inRange(e.date, start, end)) ids.add(e.proposalId);
  return ids.size;
}

/** Build drawer rows (commission breakdown): every event, in-period highlighted. */
export function commissionDetailRows(events: CommissionEvent[], start: Date, end: Date): { rows: DetailRow[]; periodSum: number; periodCount: number } {
  let periodSum = 0;
  const rows = events.map((e) => {
    const ip = inRange(e.date, start, end);
    if (ip) periodSum += e.commission;
    return { label: e.label, sublabel: e.sublabel, amount: e.commission, date: e.date.toISOString(), inPeriod: ip };
  });
  return { rows, periodSum, periodCount: rows.filter((r) => r.inPeriod).length };
}
