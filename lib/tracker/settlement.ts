/**
 * Month close, as a PURE function. Shared by the setter and closer trackers.
 *
 * THE GUARANTEE (Jack, 2026-09-25: past months must never move after payday)
 * A closed month's pay is whatever was settled when it closed, forever. Anything that changes
 * afterwards (a late outcome, a cancellation, an admin correction, a credit confirmed late) is
 * not written back into that month. It appears in the next OPEN month as a dated adjustment:
 * "Papier Doll, August: +$25". When that month closes, the adjustment is settled too.
 *
 * One rule does all of it: for every money line, payable = live paid amount − everything already
 * settled for that line. Where the line shows is its own month if still open, else the first
 * open month after it.
 */
import { TRACKER_GO_LIVE_MONTH } from "@/lib/tracker/months";

export interface LiveLine {
  key: string;
  rowKey: string;
  month: string;
  kind: "bonus" | "commission" | "base";
  cents: number;
  status: "paid" | "pending";
  label: string;
}

/** `rowKey` is the booking or deal the line belongs to, so a line that later disappears can
 *  still be shown against its row ("Changed after September closed"). */
export interface SettledLine { key: string; rowKey: string; settledInMonth: string; cents: number }

export interface MonthLine extends LiveLine {
  /** What counts toward THIS month's pay for the line (paid part only). */
  payableCents: number;
  /** Money that is possible but not proven. Never inside the total. */
  pendingCents: number;
  /** The line belongs to an earlier, already closed month. */
  isAdjustment: boolean;
  /** Already settled in earlier months, for "was $25, now $0" explanations. */
  previouslySettledCents: number;
}

export interface MonthView {
  month: string;
  closed: boolean;
  /** Before go-live: paid from the spreadsheet, shown for reference only. */
  historical: boolean;
  lines: MonthLine[];
  paidCents: number;
  pendingCents: number;
}

/** First open month strictly after `month`, among months that can be closed. */
function nextOpenAfter(month: string, openMonths: string[]): string | null {
  return openMonths.find((m) => m > month) ?? null;
}

export function settle(opts: {
  live: LiveLine[];
  settled: SettledLine[];
  closedMonths: Set<string>;
  /** Every month from go-live to the current month, oldest first. */
  months: string[];
}): Map<string, MonthView> {
  const { live, settled, closedMonths, months } = opts;
  const openMonths = months.filter((m) => !closedMonths.has(m));

  const settledByKey = new Map<string, number>();
  const settledRow = new Map<string, string>();
  for (const s of settled) {
    settledByKey.set(s.key, (settledByKey.get(s.key) ?? 0) + s.cents);
    settledRow.set(s.key, s.rowKey);
  }

  const views = new Map<string, MonthView>();
  const view = (m: string): MonthView => {
    let v = views.get(m);
    if (!v) {
      v = { month: m, closed: closedMonths.has(m), historical: m < TRACKER_GO_LIVE_MONTH, lines: [], paidCents: 0, pendingCents: 0 };
      views.set(m, v);
    }
    return v;
  };

  // Group live lines by key. A key normally has one line; summing makes it safe if not.
  const liveByKey = new Map<string, LiveLine[]>();
  for (const l of live) (liveByKey.get(l.key) ?? liveByKey.set(l.key, []).get(l.key)!).push(l);

  const allKeys = new Set([...liveByKey.keys(), ...settledByKey.keys()]);
  for (const key of allKeys) {
    const lines = liveByKey.get(key) ?? [];
    const first = lines[0];
    const home = first?.month ?? settled.filter((s) => s.key === key).map((s) => s.settledInMonth).sort()[0];
    const livePaid = lines.filter((l) => l.status === "paid").reduce((t, l) => t + l.cents, 0);
    const livePending = lines.filter((l) => l.status === "pending").reduce((t, l) => t + l.cents, 0);
    const already = settledByKey.get(key) ?? 0;

    // Before go-live: reference only. Nothing is settled or adjusted there.
    if (home < TRACKER_GO_LIVE_MONTH) {
      if (!first) continue;
      const v = view(home);
      v.lines.push({ ...first, payableCents: livePaid, pendingCents: livePending, isAdjustment: false, previouslySettledCents: 0 });
      v.paidCents += livePaid;
      v.pendingCents += livePending;
      continue;
    }

    const target = closedMonths.has(home) ? nextOpenAfter(home, openMonths) : home;
    const payable = livePaid - already;
    if (!target) continue; // every later month is closed too; the next open month will pick it up
    if (payable === 0 && livePending === 0) continue;

    const base: LiveLine = first ?? {
      key, rowKey: settledRow.get(key) ?? key, month: home,
      kind: key.startsWith("commission:") ? "commission" : key.startsWith("base:") ? "base" : "bonus",
      cents: 0, status: "paid", label: "Removed after the month closed",
    };
    const v = view(target);
    v.lines.push({
      ...base,
      payableCents: payable,
      pendingCents: livePending,
      isAdjustment: target !== home,
      previouslySettledCents: already,
    });
    v.paidCents += payable;
    v.pendingCents += livePending;
  }

  // A closed month shows exactly what was settled in it, frozen, never the live figures.
  for (const m of closedMonths) {
    const v = view(m);
    v.closed = true;
    v.lines = [];
    v.pendingCents = 0;
    v.paidCents = 0;
    for (const s of settled.filter((x) => x.settledInMonth === m)) {
      const l = liveByKey.get(s.key)?.[0];
      v.lines.push({
        key: s.key, rowKey: l?.rowKey ?? s.rowKey, month: l?.month ?? m,
        kind: l?.kind ?? (s.key.startsWith("commission:") ? "commission" : s.key.startsWith("base:") ? "base" : "bonus"),
        cents: s.cents, status: "paid", label: l?.label ?? "Settled",
        payableCents: s.cents, pendingCents: 0, isAdjustment: (l?.month ?? m) !== m, previouslySettledCents: 0,
      });
      v.paidCents += s.cents;
    }
  }
  return views;
}

/** The lines a close of `month` would write: everything payable in it, exactly as shown. */
export function linesToSettle(view: MonthView): SettledLine[] {
  return view.lines
    .filter((l) => l.payableCents !== 0)
    .map((l) => ({ key: l.key, rowKey: l.rowKey, settledInMonth: view.month, cents: l.payableCents }));
}
