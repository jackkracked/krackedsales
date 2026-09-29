import { buildSetterLedger, type SetterRow, type BonusState } from "@/lib/tracker/setter-rules";
import { loadSetterFacts } from "@/lib/tracker/facts";
import { loadCloses, loadSettled } from "@/lib/tracker/ledger-store";
import { resolveSettings } from "@/lib/tracker/settings";
import { settle, type LiveLine, type MonthLine } from "@/lib/tracker/settlement";
import { currentNyMonth, monthsBetween, nyMonth, TRACKER_GO_LIVE_MONTH } from "@/lib/tracker/months";

/**
 * One setter's month, shaped for the screen. Every figure on it is a sum of lines the screen also
 * shows, so the arithmetic is always visible (tasks/setter-tracker-shape.md, "a ledger that shows
 * its working").
 */

export interface SetterMonthRow extends Omit<SetterRow, "bookedAt" | "callAt" | "evidence" | "restoredIn" | "rebookOf" | "proposal" | "overridden"> {
  bookedAt: string | null;
  callAt: string;
  evidence: { source: string; byName: string | null; at: string; selfReported: boolean } | null;
  restoredIn: { month: string; callAt: string } | null;
  rebookOf: { callAt: string } | null;
  proposal: { id: string; title: string; amount: number; sentAt: string | null; paidAt: string | null; state: string } | null;
  overridden: Record<string, { byName: string; at: string }>;
  /** Money this row puts into THIS month's pay, and money pending on it. */
  bonusPayableCents: number;
  bonusPendingCents: number;
  commissionPayableCents: number;
  commissionPendingCents: number;
  /** This row is on the month only because of a later change to a closed month. */
  isAdjustment: boolean;
  /** This row's $25 came back this month via a rebook that showed (the row's call may be in an
   *  earlier month, or earlier in this one). */
  isRestoration: boolean;
}

export interface SetterMonth {
  kind: "setter";
  userId: string;
  month: string;
  isCurrentMonth: boolean;
  closed: boolean;
  historical: boolean;
  settings: {
    basePayCents: number | null;
    bookingBonusCents: number;
    commissionPct: number;
    edited: Record<string, { byName: string; at: string }>;
  };
  totals: {
    paidCents: number;
    pendingCents: number;
    basePayCents: number | null;
    bonusCents: number;
    commissionCents: number;
    closedValue: number;
    adjustmentsCents: number;
    /** Bonus money from THIS month's calls and restorations only: the working's right-hand side. */
    countedBonusCents: number;
  };
  /** The working, in counts: "15 booked: 11 held · 2 no-show · 1 cancelled · 1 waiting". */
  reconciliation: {
    booked: number;
    held: number;
    rebooks: number;
    noShow: number;
    cancelled: number;
    waiting: number;
    restored: number;
    counted: number;
    bonusIsUniform: boolean;
  };
  /** What needs a person ON THIS MONTH's rows, so the counts always match "Show only these". */
  needsYou: { confirm: number; clash: number; awaitingOutcome: number };
  /** Other months with something waiting, so a nudge never lands on an empty filter. */
  needsElsewhere: Array<{ month: string; count: number }>;
  laterBookings: { count: number; pendingCents: number };
  rows: SetterMonthRow[];
  months: string[];
}

const WAITING: BonusState[] = ["pending"];
const NO_SHOW: BonusState[] = ["no_show_waiting", "never_rebooked", "restored", "superseded"];

/** Everything computed for one setter: shared by the page and by month close. */
export async function computeSetter(setterId: string, now: Date = new Date()) {
  const [{ facts, settingsRows }, closes, settled] = await Promise.all([
    loadSetterFacts(setterId, now),
    loadCloses(),
    loadSettled(setterId),
  ]);
  const ledger = buildSetterLedger(facts);
  const current = currentNyMonth(now);
  const trackedMonths = monthsBetween(TRACKER_GO_LIVE_MONTH, current);

  // Base pay is a line too, so a month close settles it and a later correction adjusts it.
  const baseLines: LiveLine[] = trackedMonths.map((m) => {
    const s = resolveSettings(settingsRows, m);
    return { key: `base:${m}`, rowKey: `base:${m}`, month: m, kind: "base", cents: s.basePayCents ?? 0, status: "paid", label: "Base pay" };
  });
  const live: LiveLine[] = [...baseLines, ...ledger.entries.map((e) => ({ ...e }))];
  const views = settle({ live, settled, closedMonths: new Set(closes.keys()), months: trackedMonths });
  return { facts, settingsRows, ledger, views, closes, current, trackedMonths };
}

export async function getSetterMonth(setterId: string, month: string, now: Date = new Date()): Promise<SetterMonth> {
  const { facts, settingsRows, ledger, views, closes, current, trackedMonths } = await computeSetter(setterId, now);
  const people = new Map(facts.people.map((p) => [p.id, p.name]));
  const nameOf = (id: string | null) => (id ? people.get(id) ?? "someone" : null);
  const view = views.get(month) ?? { month, closed: closes.has(month), historical: month < TRACKER_GO_LIVE_MONTH, lines: [], paidCents: 0, pendingCents: 0 };

  const linesByRow = new Map<string, MonthLine[]>();
  for (const l of view.lines) (linesByRow.get(l.rowKey) ?? linesByRow.set(l.rowKey, []).get(l.rowKey)!).push(l);

  // Rows on this month: calls in it, plus rows with money landing in it (restorations,
  // commission on an older booking, adjustments to a closed month).
  const shown = ledger.rows.filter((r) => r.month === month || linesByRow.has(r.rowKey));
  const settings = resolveSettings(settingsRows, month);

  const rows: SetterMonthRow[] = shown.map((r) => {
    const lines = linesByRow.get(r.rowKey) ?? [];
    const sum = (kind: string, field: "payableCents" | "pendingCents") =>
      lines.filter((l) => l.kind === kind).reduce((t, l) => t + l[field], 0);
    return {
      ...r,
      bookedAt: r.bookedAt?.toISOString() ?? null,
      callAt: r.callAt.toISOString(),
      evidence: r.evidence ? { source: r.evidence.source, byName: nameOf(r.evidence.by), at: r.evidence.at.toISOString(), selfReported: r.evidence.selfReported } : null,
      restoredIn: r.restoredIn ? { month: r.restoredIn.month, callAt: r.restoredIn.callAt.toISOString() } : null,
      rebookOf: r.rebookOf ? { callAt: r.rebookOf.callAt.toISOString() } : null,
      proposal: r.proposal ? {
        ...r.proposal, sentAt: r.proposal.sentAt?.toISOString() ?? null, paidAt: r.proposal.paidAt?.toISOString() ?? null,
      } : null,
      overridden: Object.fromEntries(Object.entries(r.overridden).map(([k, v]) => [k, { byName: nameOf(v.by) ?? "someone", at: v.at.toISOString() }])),
      bonusPayableCents: sum("bonus", "payableCents"),
      bonusPendingCents: sum("bonus", "pendingCents"),
      commissionPayableCents: sum("commission", "payableCents"),
      commissionPendingCents: sum("commission", "pendingCents"),
      isAdjustment: lines.some((l) => l.isAdjustment),
      isRestoration: lines.some((l) => l.key.startsWith("restore:") && !l.isAdjustment),
    };
  });
  // A deal reassigned AWAY after its month closed has no row on this sheet any more, but its
  // clawback line lands here. Show the deal, or the total drops with no row explaining why
  // (correctness review S2, the setter-side twin of the closer sheet fix).
  const shownKeys = new Set(rows.map((r) => r.rowKey));
  for (const [rowKey, lines] of linesByRow) {
    if (shownKeys.has(rowKey) || !rowKey.startsWith("p:")) continue;
    const p = facts.proposals.find((x) => x.id === rowKey.slice(2));
    if (!p) continue;
    const sum = (kind: string, field: "payableCents" | "pendingCents") => lines.filter((l) => l.kind === kind).reduce((t, l) => t + l[field], 0);
    rows.push({
      rowKey, appointmentId: null, manualRowId: null, contactId: p.contactId,
      company: p.title, contactName: null, calendarName: null,
      bookedAt: null, callAt: (p.paidAt ?? p.sentAt ?? new Date()).toISOString(), month: nyMonth(p.paidAt ?? p.sentAt ?? new Date()),
      credit: { state: "credited", source: "assigned", clashWith: [], clashWithIds: [], bookedByName: null },
      outcome: "not_applicable", evidence: null, bonusState: "deal_only", bonusAtStake: 0,
      restoredIn: null, rebookOf: null, closerName: null,
      proposal: { id: p.id, title: p.title, amount: p.totalAmount, sentAt: p.sentAt?.toISOString() ?? null, paidAt: p.paidAt?.toISOString() ?? null, state: "Reassigned" },
      overridden: {}, notes: "Credit moved to another setter after this month closed",
      bonusPayableCents: 0, bonusPendingCents: 0,
      commissionPayableCents: sum("commission", "payableCents"), commissionPendingCents: sum("commission", "pendingCents"),
      isAdjustment: true, isRestoration: false,
    });
  }
  rows.sort((a, b) => a.callAt.localeCompare(b.callAt));

  // The working. Every count is over rows whose CALL is in this month; restorations are the
  // only thing added from elsewhere, and they are counted separately so the sum still adds up.
  const own = rows.filter((r) => r.month === month);
  // Only restorations that PAY this month. A pending one is money in waiting, shown beside the
  // total; counting it here made the working read "2 counted × $25 = $0".
  const restoredHere = rows.filter((r) => r.isRestoration && r.bonusPayableCents > 0).length;
  const held = own.filter((r) => r.bonusState === "paid").length;
  const bonusLines = view.lines.filter((l) => l.kind === "bonus" && !l.isAdjustment);
  const reconciliation = {
    booked: own.length,
    held,
    rebooks: own.filter((r) => r.bonusState === "rebook_of").length,
    noShow: own.filter((r) => NO_SHOW.includes(r.bonusState)).length,
    cancelled: own.filter((r) => r.bonusState === "cancelled" || r.bonusState === "moved").length,
    waiting: own.filter((r) => WAITING.includes(r.bonusState)).length,
    restored: restoredHere,
    counted: held + restoredHere,
    bonusIsUniform: bonusLines.every((l) => l.payableCents === 0 || l.payableCents === settings.bookingBonusCents),
  };

  const sumKind = (kind: string) => view.lines.filter((l) => l.kind === kind).reduce((t, l) => t + l.payableCents, 0);
  const closedValue = rows
    .filter((r) => r.proposal?.paidAt && r.commissionPayableCents > 0)
    .reduce((t, r) => t + (r.proposal?.amount ?? 0), 0);

  // What needs a person. Only rows that matter to pay: this tracker's months, or older bookings
  // that money is still landing on. Kelsey owns hundreds of opportunities; asking her to confirm
  // June's bookings nobody will ever pay on would bury the ones that do.
  // What needs a person. Only rows that matter to pay: this tracker's months, or older bookings
  // that money is still landing on. Kelsey owns hundreds of opportunities; asking her to confirm
  // June's bookings nobody will ever pay on would bury the ones that do.
  const matters = ledger.rows.filter((r) => r.month >= TRACKER_GO_LIVE_MONTH || ledger.entries.some((e) => e.rowKey === r.rowKey && e.month >= TRACKER_GO_LIVE_MONTH));
  const needs = (r: SetterRow) => r.credit.state === "suggested" || r.credit.state === "clash" || r.outcome === "awaiting";
  // The month a row asks for attention on: its own month, or the month money lands if older.
  const needMonth = (r: SetterRow) => (r.month >= TRACKER_GO_LIVE_MONTH ? r.month
    : ledger.entries.filter((e) => e.rowKey === r.rowKey && e.month >= TRACKER_GO_LIVE_MONTH).map((e) => e.month).sort()[0] ?? r.month);
  const here = matters.filter((r) => needs(r) && (needMonth(r) === month || shown.some((x) => x.rowKey === r.rowKey)));
  const needsYou = {
    confirm: here.filter((r) => r.credit.state === "suggested").length,
    clash: here.filter((r) => r.credit.state === "clash").length,
    awaitingOutcome: here.filter((r) => r.outcome === "awaiting").length,
  };
  const elsewhere = new Map<string, number>();
  for (const r of matters) {
    if (!needs(r) || here.includes(r)) continue;
    const m = needMonth(r);
    elsewhere.set(m, (elsewhere.get(m) ?? 0) + 1);
  }
  const needsElsewhere = [...elsewhere.entries()].map(([m, count]) => ({ month: m, count })).sort((a, b) => a.month.localeCompare(b.month));

  const later = ledger.rows.filter((r) => r.month > month && r.outcome === "upcoming");
  const laterPending = ledger.entries.filter((e) => e.month > month && e.status === "pending" && e.kind === "bonus")
    .reduce((t, e) => t + e.cents, 0);

  const historicalMonths = [...new Set(ledger.rows.map((r) => r.month).filter((m) => m < TRACKER_GO_LIVE_MONTH))];
  const months = [...new Set([...trackedMonths, ...historicalMonths])].sort().reverse();

  const edited: SetterMonth["settings"]["edited"] = {};
  for (const f of settings.editedFields) {
    edited[f] = { byName: nameOf(settings.editedBy) ?? "someone", at: settings.editedAt?.toISOString() ?? "" };
  }

  return {
    kind: "setter",
    userId: setterId,
    month,
    isCurrentMonth: month === current,
    closed: view.closed,
    historical: view.historical,
    settings: {
      basePayCents: settings.basePayCents,
      bookingBonusCents: settings.bookingBonusCents,
      commissionPct: settings.commissionPct,
      edited,
    },
    totals: {
      paidCents: view.paidCents,
      pendingCents: view.pendingCents,
      basePayCents: settings.basePayCents,
      bonusCents: sumKind("bonus"),
      commissionCents: sumKind("commission"),
      closedValue,
      adjustmentsCents: view.lines.filter((l) => l.isAdjustment).reduce((t, l) => t + l.payableCents, 0),
      countedBonusCents: view.lines.filter((l) => l.kind === "bonus" && !l.isAdjustment).reduce((t, l) => t + l.payableCents, 0),
    },
    reconciliation,
    needsYou,
    needsElsewhere,
    laterBookings: { count: later.length, pendingCents: laterPending },
    rows,
    months,
  };
}
