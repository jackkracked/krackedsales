import { and, asc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { callDispositions, ghlAppointments, localContacts, proposals, trackerCallOutcomes, trackerOverrides, users } from "@/lib/db/schema";
import { getPayoutTiming, getRepCommissionEvents, type CommissionEvent } from "@/lib/kpi/rep-proposal-commission";
import { loadCloses, loadSettled } from "@/lib/tracker/ledger-store";
import { loadSettingsRows, resolveSettings } from "@/lib/tracker/settings";
import { settle, type LiveLine, type MonthLine } from "@/lib/tracker/settlement";
import { resolveOutcome } from "@/lib/tracker/setter-rules";
import { currentNyMonth, monthsBetween, nyMonth, nyMonthRange, TRACKER_GO_LIVE_MONTH } from "@/lib/tracker/months";

/**
 * A closer's month, in the shape of Kelsey's commission workbook.
 *
 * WHY IT REUSES THE KPI COMMISSION HELPER RATHER THAN RECOMPUTING
 * `lib/kpi/rep-proposal-commission.ts` is already the single source of truth for what a rep has
 * earned, and the homepage KPI cards read from it. If this tracker did its own arithmetic, the
 * two would eventually disagree, and the month that happens is the month somebody is told their
 * pay is wrong. One engine, two views. The engine is asked for events at 100% and the rate in
 * force for each MONTH is applied here, because a closer can now change their rate for one month.
 *
 * WHAT "CLOSED" MEANS HERE
 * Jack, 2026-09-22, asked directly: "Closed means paid." So a proposal counts as closed on
 * `paidAt`, never on `signedAt`. The payout-timing setting (full_paid / first_instalment /
 * split) then decides WHEN within that the commission is recognised.
 *
 * MONTHS ARE NEW YORK MONTHS (plan S7). Measured 2026-09-25 before switching from UTC: 0 of 29
 * commission events changed month; 2 "proposals sent" counts moved to the month they were
 * actually sent in, Eastern time.
 */

export interface CloserRow {
  proposalId: string;
  rowKey: string;
  client: string;
  title: string;
  /** "Sent" | "Signed" | "Closed" | "Lost" — the state as at the end of the month shown. */
  state: string;
  amount: number;
  sentAt: string | null;
  signedAt: string | null;
  paidAt: string | null;
  lostAt: string | null;
  /** Commission this proposal puts into THIS month's pay (after any close adjustment). */
  commission: number;
  isAdjustment: boolean;
  notes: string | null;
  overridden: Record<string, { byName: string; at: string }>;
}

export interface AwaitingCall {
  appointmentId: string;
  contactId: string | null;
  contactName: string | null;
  startTime: string;
}

export interface CloserMonth {
  kind: "closer";
  userId: string;
  name: string;
  month: string;
  currency: string;
  payoutTiming: string;
  isCurrentMonth: boolean;
  closed: boolean;
  historical: boolean;
  settings: {
    basePayCents: number | null;
    commissionPct: number;
    edited: Record<string, { byName: string; at: string }>;
  };
  commissionPct: number;
  basePay: number;
  basePaySet: boolean;
  proposalsSent: number;
  dealsClosed: number;
  closedValue: number;
  commission: number;
  adjustments: number;
  totalEstimatedPay: number;
  rows: CloserRow[];
  months: string[];
  /** Calls this closer ran that nobody has said happened or not. Their Needs-you list. */
  awaitingOutcome: AwaitingCall[];
}

/** The proposal's state as at the end of the month being shown, not as at today. */
function stateAt(p: { paidAt: Date | null; lostAt: Date | null; signedAt: Date | null; sentAt: Date | null }, end: Date): string {
  if (p.paidAt && p.paidAt < end) return "Closed";
  if (p.lostAt && p.lostAt < end) return "Lost";
  if (p.signedAt && p.signedAt < end) return "Signed";
  if (p.sentAt && p.sentAt < end) return "Sent";
  return "Draft";
}

/**
 * One commission line per payment event, at the rate of the month it lands in. An override
 * replaces a deal's commission for a MONTH once: the first event that month carries the typed
 * figure and the rest carry zero, so split instalments paid in one month are not each given it.
 */
function commissionLines(
  events: CommissionEvent[],
  pctFor: (month: string) => number,
  overrides: Map<string, { value: unknown }>,
): LiveLine[] {
  const seen = new Set<string>();
  return [...events]
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.proposalId.localeCompare(b.proposalId))
    .map((e): LiveLine => {
      const m = nyMonth(e.date);
      const rowKey = `p:${e.proposalId}`;
      const o = overrides.get(`${rowKey}|commission@${m}`);
      let cents = Math.round(e.commission * pctFor(m));
      if (o && typeof o.value === "number") {
        cents = seen.has(`${rowKey}|${m}`) ? 0 : Math.round(o.value);
        seen.add(`${rowKey}|${m}`);
      }
      return { key: `commission:${e.proposalId}:${e.date.toISOString()}`, rowKey, month: m, kind: "commission", cents, status: "paid", label: e.sublabel ?? "Commission" };
    });
}

/** Latest override per (row, field), with cleared ones removed. */
async function loadOverrides(userId: string) {
  const rows = await db().select().from(trackerOverrides).where(eq(trackerOverrides.subjectUserId, userId));
  const map = new Map<string, (typeof rows)[number]>();
  for (const o of rows) {
    const k = `${o.rowKey}|${o.field}`;
    const prev = map.get(k);
    if (!prev || o.editedAt > prev.editedAt) map.set(k, o);
  }
  for (const [k, o] of map) if (o.value === null) map.delete(k);
  return map;
}

export async function getCloserMonth(
  userId: string,
  month: string,
  now: Date = new Date(),
  /** Month close passes a holder to receive the settlement views it must write. */
  opts?: { viewsOnly?: { views?: Map<string, import("@/lib/tracker/settlement").MonthView> } },
): Promise<CloserMonth | null> {
  const [user] = await db()
    .select({ id: users.id, name: users.name, ghlUserId: users.ghlUserId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return null;

  const { start, end } = nyMonthRange(month);
  const current = currentNyMonth(now);
  const trackedMonths = monthsBetween(TRACKER_GO_LIVE_MONTH, current);

  const [payoutTiming, settingsRows, closes, settled, overrides, people] = await Promise.all([
    getPayoutTiming(),
    loadSettingsRows([userId]),
    loadCloses(),
    loadSettled(userId),
    loadOverrides(userId),
    db().select({ id: users.id, name: users.name }).from(users),
  ]);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const settings = resolveSettings(settingsRows, month);

  // Credited to whoever CLOSED it, matching the commission engine exactly.
  const closedBySelf = sql`coalesce(${proposals.closedBy}, ${proposals.createdBy}) = ${userId}`;

  // Every proposal that TOUCHED this month: sent in it, or resolved in it. A proposal sent in
  // March and paid in April belongs on April's sheet as income and on March's as outreach, so
  // neither month can be built from a single date column.
  const touched = await db()
    .select({
      id: proposals.id, client: proposals.contactName, title: proposals.title, amount: proposals.totalAmount,
      currency: proposals.currency, sentAt: proposals.sentAt, signedAt: proposals.signedAt,
      paidAt: proposals.paidAt, lostAt: proposals.lostAt,
    })
    .from(proposals)
    .where(closedBySelf);

  // At 100%: `commission` is the base amount. The rate is the one in force in the month the
  // commission lands, so a rate typed for October never reaches back into September.
  const events: CommissionEvent[] = await getRepCommissionEvents({ userId, commissionPct: 100, payoutTiming });

  const live: LiveLine[] = [
    ...trackedMonths.map((m): LiveLine => ({
      key: `base:${m}`, rowKey: `base:${m}`, month: m, kind: "base",
      cents: resolveSettings(settingsRows, m).basePayCents ?? 0, status: "paid", label: "Base pay",
    })),
    ...commissionLines(events, (m) => resolveSettings(settingsRows, m).commissionPct, overrides),
  ];
  const views = settle({ live, settled, closedMonths: new Set(closes.keys()), months: trackedMonths });
  if (opts?.viewsOnly) opts.viewsOnly.views = views;
  const view = views.get(month);

  // Before go-live there is no settlement: show the month as it was computed, for reference.
  let lines: MonthLine[];
  if (view) {
    lines = view.lines;
  } else {
    lines = live.filter((l) => l.month === month && l.kind !== "base").map((l) => ({
      ...l, payableCents: l.cents, pendingCents: 0, isAdjustment: false, previouslySettledCents: 0,
    }));
  }
  const commissionByRow = new Map<string, number>();
  const adjustmentRows = new Set<string>();
  for (const l of lines) {
    if (l.kind !== "commission") continue;
    commissionByRow.set(l.rowKey, (commissionByRow.get(l.rowKey) ?? 0) + l.payableCents);
    if (l.isAdjustment) adjustmentRows.add(l.rowKey);
  }

  const inMonth = (d: Date | null) => !!d && d >= start && d < end;
  // A deal reassigned AWAY after its month closed is no longer "mine", but its clawback line
  // lands on this sheet. Show that deal too, or the total drops with no row explaining why
  // (proposal-roles review S1).
  const touchedIds = new Set(touched.map((p) => p.id));
  const orphanIds = [...commissionByRow.keys()].map((k) => k.slice(2)).filter((id) => !touchedIds.has(id));
  if (orphanIds.length) {
    const extra = await db().select({
      id: proposals.id, client: proposals.contactName, title: proposals.title, amount: proposals.totalAmount,
      currency: proposals.currency, sentAt: proposals.sentAt, signedAt: proposals.signedAt,
      paidAt: proposals.paidAt, lostAt: proposals.lostAt,
    }).from(proposals).where(inArray(proposals.id, orphanIds));
    touched.push(...extra);
  }
  const shown = touched.filter((p) =>
    inMonth(p.sentAt) || inMonth(p.paidAt) || inMonth(p.signedAt) || inMonth(p.lostAt) || commissionByRow.has(`p:${p.id}`));
  shown.sort((a, b) => (a.sentAt?.getTime() ?? 0) - (b.sentAt?.getTime() ?? 0));

  const rows: CloserRow[] = shown.map((p) => {
    const rowKey = `p:${p.id}`;
    const overridden: CloserRow["overridden"] = {};
    for (const [k, o] of overrides) {
      if (!k.startsWith(`${rowKey}|`)) continue;
      overridden[o.field] = { byName: nameOf.get(o.editedBy) ?? "someone", at: o.editedAt.toISOString() };
    }
    const noteOv = overrides.get(`${rowKey}|notes`);
    return {
      proposalId: p.id, rowKey, client: p.client, title: p.title, state: stateAt(p, end), amount: p.amount,
      sentAt: p.sentAt?.toISOString() ?? null, signedAt: p.signedAt?.toISOString() ?? null,
      paidAt: p.paidAt?.toISOString() ?? null, lostAt: p.lostAt?.toISOString() ?? null,
      commission: (commissionByRow.get(rowKey) ?? 0) / 100,
      isAdjustment: adjustmentRows.has(rowKey),
      notes: typeof noteOv?.value === "string" ? noteOv.value : null,
      overridden,
    };
  });

  const closedThisMonth = touched.filter((p) => inMonth(p.paidAt));
  const basePayLine = lines.find((l) => l.kind === "base");
  const commission = lines.filter((l) => l.kind === "commission").reduce((t, l) => t + l.payableCents, 0) / 100;
  const adjustments = lines.filter((l) => l.isAdjustment).reduce((t, l) => t + l.payableCents, 0) / 100;
  const basePay = (basePayLine?.payableCents ?? 0) / 100;

  // Calls this closer ran, since go-live, with no outcome yet. Same judgement as setter pay.
  let awaitingOutcome: AwaitingCall[] = [];
  if (user.ghlUserId) {
    const golive = nyMonthRange(TRACKER_GO_LIVE_MONTH).start;
    const appts = await db().select().from(ghlAppointments).where(and(
      eq(ghlAppointments.assignedUserId, user.ghlUserId),
      gte(ghlAppointments.startTime, golive),
      lt(ghlAppointments.startTime, now),
      isNull(ghlAppointments.deletedAt),
    )).orderBy(asc(ghlAppointments.startTime));
    if (appts.length) {
      const ids = appts.map((a) => a.id);
      const [outs, disps, rowOvs, admins] = await Promise.all([
        db().select().from(trackerCallOutcomes),
        db().select({ eventId: callDispositions.calendarEventId, outcome: callDispositions.outcome, at: callDispositions.dispositionedAt, createdByUserId: callDispositions.createdByUserId })
          .from(callDispositions).where(isNull(callDispositions.callId)),
        // Anyone's correction of whether a call happened counts here too, or a call already
        // settled by an override would keep nagging its closer.
        db().select().from(trackerOverrides).where(eq(trackerOverrides.field, "outcome")),
        db().select({ id: users.id }).from(users).where(eq(users.role, "admin")),
      ]);
      const adminIds = new Set(admins.map((a) => a.id));
      const latestOutcomeOv = new Map<string, (typeof rowOvs)[number]>();
      for (const o of rowOvs) {
        const prev = latestOutcomeOv.get(o.rowKey);
        if (!prev || o.editedAt > prev.editedAt) latestOutcomeOv.set(o.rowKey, o);
      }
      const idSet = new Set(ids);
      const trackerOutcomes = outs.filter((o) => idSet.has(o.rowRef)).map((o) => ({ rowRef: o.rowRef, outcome: o.outcome as "held" | "no_show", forStartTime: o.forStartTime, recordedBy: o.recordedBy, recordedAt: o.recordedAt }));
      const dispositions = disps.filter((d) => d.eventId && idSet.has(d.eventId)).map((d) => ({ eventId: d.eventId!, outcome: d.outcome, at: d.at, createdByUserId: d.createdByUserId }));
      for (const a of appts) {
        const ov = latestOutcomeOv.get(`b:${a.id}`);
        const { outcome } = resolveOutcome({
          rowRef: a.id, start: a.startTime, trackerOutcomes, dispositions, now,
          // Whether this call is AWAITING does not depend on who wrote an outcome, only whether
          // one exists. Authority matters for the setter's proof, which is decided on her sheet.
          authoritative: (id) => id === null || adminIds.has(id),
          override: ov && ov.value !== null ? { rowKey: ov.rowKey, field: ov.field, value: ov.value, editedBy: ov.editedBy, editedAt: ov.editedAt } : undefined,
          appt: { id: a.id, contactId: a.contactId, calendarName: a.calendarName, assignedUserId: a.assignedUserId, createdByUserId: a.createdByUserId, dateAdded: a.dateAdded, startTime: a.startTime, status: a.status, deletedAt: a.deletedAt, movedToCalendarId: a.movedToCalendarId },
        });
        if (outcome === "awaiting") {
          awaitingOutcome.push({ appointmentId: a.id, contactId: a.contactId, contactName: null, startTime: a.startTime.toISOString() });
        }
      }
      awaitingOutcome = await nameCalls(awaitingOutcome);
    }
  }

  const months = await getCloserMonths(userId);
  const edited: CloserMonth["settings"]["edited"] = {};
  for (const f of settings.editedFields) edited[f] = { byName: nameOf.get(settings.editedBy ?? "") ?? "someone", at: settings.editedAt?.toISOString() ?? "" };

  return {
    kind: "closer",
    userId: user.id,
    name: user.name,
    month,
    currency: (touched[0]?.currency ?? "usd").toUpperCase(),
    payoutTiming,
    isCurrentMonth: month === current,
    closed: view?.closed ?? false,
    historical: month < TRACKER_GO_LIVE_MONTH,
    settings: { basePayCents: settings.basePayCents, commissionPct: settings.commissionPct, edited },
    commissionPct: settings.commissionPct,
    basePay: month < TRACKER_GO_LIVE_MONTH ? (settings.basePayCents ?? 0) / 100 : basePay,
    basePaySet: settings.basePayCents !== null,
    proposalsSent: touched.filter((p) => inMonth(p.sentAt)).length,
    dealsClosed: closedThisMonth.length,
    closedValue: closedThisMonth.reduce((t, p) => t + p.amount, 0),
    commission,
    adjustments,
    // Before go-live there is no base line in the ledger, so base pay is added back here, exactly
    // as the tracker showed it before month close existed.
    totalEstimatedPay: month < TRACKER_GO_LIVE_MONTH
      ? (settings.basePayCents ?? 0) / 100 + commission
      : (view?.paidCents ?? 0) / 100,
    rows,
    months,
    awaitingOutcome,
  };
}

/** Fill in contact names for the awaiting list from the local contact mirror. */
async function nameCalls(list: AwaitingCall[]): Promise<AwaitingCall[]> {
  const ids = [...new Set(list.map((c) => c.contactId).filter((c): c is string => !!c))];
  if (!ids.length) return list;
  const rows = await db().select({ id: localContacts.id, fullName: localContacts.fullName, company: localContacts.companyName })
    .from(localContacts).where(inArray(localContacts.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r.company || r.fullName]));
  return list.map((c) => ({ ...c, contactName: c.contactId ? byId.get(c.contactId) ?? null : null }));
}

/** Months that have something in them, newest first, plus every month since go-live. */
export async function getCloserMonths(userId: string, now: Date = new Date()): Promise<string[]> {
  const rows = await db()
    .select({ sentAt: proposals.sentAt, paidAt: proposals.paidAt })
    .from(proposals)
    .where(sql`coalesce(${proposals.closedBy}, ${proposals.createdBy}) = ${userId}`);
  const set = new Set(monthsBetween(TRACKER_GO_LIVE_MONTH, currentNyMonth(now)));
  for (const r of rows) {
    const d = r.paidAt ?? r.sentAt;
    if (d) set.add(nyMonth(d));
  }
  return [...set].sort().reverse();
}
