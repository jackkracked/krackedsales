/**
 * ONE place that decides what a proposal's status is, and how far through its term it is.
 *
 * WHY THIS EXISTS
 * Two systems used to write `proposals.status` independently and disagreed. In production, two
 * spread proposals in the identical situation (first month collected) carried different statuses:
 * Dan Bruxer `paid`, Tofu Go `partial`. The `invoice.paid` webhook's customer+amount fallback
 * matched a $1,500 spread invoice against the $1,500 MONTHLY totalAmount and marked the whole
 * $4,500 deal paid after one payment; the fulfilment path meanwhile held it at `partial`.
 *
 * THE MODEL
 * Status follows the SUBSCRIPTION. The term is progress INSIDE it. Progress is never encoded in
 * the status ("paid 2 of 3"): that explodes the enum, breaks every query that groups by status,
 * and still cannot answer the one question that matters, because "3 of 3" does not distinguish a
 * finished client from one Gage just upsold.
 *
 * SCOPE — deliberately narrow
 * Only a 90-day management "spread" proposal is re-classified. Everything else (projects,
 * instalments, upfront management, legacy retainers) is returned EXACTLY as stored. The reader
 * audit found ~15 call sites that branch on this field; keeping non-spread untouched means none
 * of them change behaviour for those proposals.
 *
 * PURE. No DB, no Stripe, no clock. Callers pass in what they already have, so this is fully
 * unit-testable and both the API and the UI can share it without drifting.
 */

/** Statuses this function may RETURN for a spread proposal. */
export type SpreadStatus = "signed" | "partial" | "active" | "completed" | "past_due";

/**
 * Statuses meaning THE DEAL CONVERTED TO CASH — i.e. `paidAt` is stamped.
 *
 * `paidAt` is set once, when the first full month is collected, and preserved through the term
 * (Jack, 2026-08-13), so `active` and `completed` are every bit as "won" as `paid`. Anywhere that
 * tested `status === "paid"` to mean "this client gave us money" must use this instead, or a
 * spread client reads as $0 revenue. Use for LTV, won-client universes, and revenue filters.
 *
 * NOT the same as "finished": a `completed` term is won AND over; an `active` one is won and still
 * running. If you need "finished", test for `completed` explicitly.
 */
export const WON_STATUSES: string[] = ["paid", "active", "completed"];

/**
 * Statuses an incoming payment event must NEVER overwrite, because they already represent
 * recognised money. Same membership as WON_STATUSES today, kept separate because they answer
 * different questions and may diverge.
 */
export const PAID_TERMINAL_STATUSES: string[] = ["paid", "active", "completed"];

/** How the mirrored Stripe subscription looks. `null` = we have no subscription record. */
export type MirroredSubStatus = "active" | "trialing" | "past_due" | "canceled" | "unpaid" | "incomplete" | null;

export interface StatusInputs {
  /** Whatever is currently stored on the row. */
  status: string;
  type: string | null | undefined;                    // "management" | "project"
  managementOption: string | null | undefined;        // "spread" | "upfront" | null
  /** True once the FIRST month is fully collected (all split portions, if any). */
  firstMonthComplete: boolean | null | undefined;
  /** Stamped once, at first payment. Preserved through completion. Never cleared. */
  paidAt: Date | string | null | undefined;
  /** Live subscription state from the local Stripe mirror, NOT from autoRebillMode. */
  subscriptionStatus: MirroredSubStatus;
  /** Payments actually collected so far. */
  collected: number;
  /** Payments the signed schedule expects in total. */
  expected: number;
  /** Money collected / contracted, for the progress label. */
  amountCollected?: number;
  amountExpected?: number;
}

export interface DerivedStatus {
  status: string;
  /** null when the proposal has no multi-payment term to show progress for. */
  progress: {
    collected: number;
    expected: number;
    amountCollected: number | null;
    amountExpected: number | null;
    /** e.g. "2 of 3 · $3,000 of $4,500" */
    label: string;
  } | null;
  /** True when this function re-classified the row; false when it passed through untouched. */
  derived: boolean;
}

/** A proposal whose status this function is allowed to re-classify. */
export function isSpreadTerm(p: Pick<StatusInputs, "type" | "managementOption">): boolean {
  return p.type === "management" && p.managementOption === "spread";
}

/** Statuses that mean the deal is dead or not yet in play. Never re-classified. */
const TERMINAL_OR_PRE_SALE = new Set(["draft", "sent", "lost", "void", "cancelled", "canceled", "expired"]);

function money(n: number | null | undefined): string | null {
  if (n == null) return null;
  return "$" + Math.round(n).toLocaleString("en-US");
}

export function deriveProposalStatus(p: StatusInputs): DerivedStatus {
  // Anything that is not a 90-day spread term passes straight through. Projects keep
  // partial -> paid; upfront management keeps its single-payment lifecycle.
  if (!isSpreadTerm(p)) return { status: p.status, progress: null, derived: false };

  // Not yet in play, or dead. `sent` and `draft` are pre-payment; `lost`/`void` are decisions a
  // human made and must never be overwritten by a derivation.
  if (TERMINAL_OR_PRE_SALE.has(p.status)) return { status: p.status, progress: null, derived: false };

  const collected = Math.max(0, p.collected);
  const expected = Math.max(collected, p.expected); // never show "4 of 3"
  const parts = [`${collected} of ${expected}`];
  const a = money(p.amountCollected), b = money(p.amountExpected);
  if (a && b) parts.push(`${a} of ${b}`);
  const progress = {
    collected,
    expected,
    amountCollected: p.amountCollected ?? null,
    amountExpected: p.amountExpected ?? null,
    label: parts.join(" · "),
  };

  // A failing card outranks everything else: it needs attention now.
  if (p.subscriptionStatus === "past_due" || p.subscriptionStatus === "unpaid") {
    return { status: "past_due", progress, derived: true };
  }

  // No money in yet.
  if (!p.paidAt && collected === 0) return { status: "signed", progress, derived: true };

  // Money has started but the FIRST month is not fully collected. This is the ONLY meaning of
  // `partial` now: a split first payment with a portion still outstanding.
  if (!p.firstMonthComplete) return { status: "partial", progress, derived: true };

  // First full month collected. The client has paid; the term is running.
  //
  // `completed` requires BOTH the full term collected AND nothing following it. The "nothing
  // following" test is the live subscription, NOT autoRebillMode: renewals happen by extending
  // the subscription directly in Stripe, so a flag stored at signing goes stale and would show
  // `completed` for a client still being billed.
  const termCollected = collected >= expected && expected > 0;
  const subFinished = p.subscriptionStatus === "canceled";

  if (termCollected && subFinished) return { status: "completed", progress, derived: true };

  // Missing subscription record: fail to `active`, never to `completed`. A mirror gap must not
  // silently declare a live retainer finished.
  return { status: "active", progress, derived: true };
}
