/**
 * The rules that decide what lands on a rep's Today list.
 *
 * ONE MODULE, ON PURPOSE. The dashboard briefing this replaces re-implemented "is this proposal
 * still open?" inline and got it wrong, so it told Gage to chase six clients who had already
 * signed and paid. Every caller imports from here; nobody re-derives it.
 *
 * THE CHEEKY CASE, which this exists to prevent:
 *   proposal ca9448f8  status "partial"  signed 24 Jul  paid_at NULL  total $3,600
 *   instalment 1  $1,200  PAID 25 Jul
 *   instalment 2  $1,200  superseded_by_subscription
 *   instalment 3  $1,200  superseded_by_subscription
 * He paid. It was a partial payment that converted to a subscription. `paid_at` never stamps
 * because that only happens when EVERY instalment reads exactly "paid", which can no longer
 * happen. The old code asked "is paid_at null?" and therefore chased a paying customer.
 *
 * So the test below is deliberately NOT about status. It is: has any money arrived?
 */

/** How long a sent proposal is still a live chase. Beyond this it is a decision, not a nudge. */
export const CHASE_WINDOW_DAYS = 21;

export interface ProposalChaseInput {
  status: string | null;
  sentAt: Date | string | null;
  signedAt: Date | string | null;
  paidAt: Date | string | null;
  lostAt: Date | string | null;
  /** Sum of deposits actually collected. */
  depositsPaidTotal: number | null;
  /** True when ANY instalment row is paid (status "paid" or a non-null paid_at). */
  hasPaidInstalment: boolean;
  /** True when a live Stripe subscription exists for this proposal. */
  hasLiveSubscription: boolean;
}

/**
 * Has this client given us money in any form? Independent of proposal status, because status is
 * exactly what goes stale. This single test is what removes Cheeky.
 */
export function hasReceivedMoney(p: ProposalChaseInput): boolean {
  if (p.paidAt) return true;
  if ((p.depositsPaidTotal ?? 0) > 0) return true;
  if (p.hasPaidInstalment) return true;
  if (p.hasLiveSubscription) return true;
  return false;
}

/**
 * Should this proposal appear on someone's list as "chase them for an answer"?
 *
 * Every disqualifier is a reason the ball is NOT in our court.
 */
export function isChaseable(p: ProposalChaseInput, now: Date = new Date()): boolean {
  // R1: only a proposal genuinely awaiting a reply. Never inferred from paidAt.
  if (p.status !== "sent") return false;

  // R2: a decision has already been made, either way.
  if (p.signedAt || p.lostAt) return false;

  // R3: money has arrived. The Cheeky rule. Belt and braces on top of R1, because status is the
  // thing that goes wrong and this does not depend on it.
  if (hasReceivedMoney(p)) return false;

  // R4: it must actually have been sent, and recently enough to be a nudge rather than a
  // post-mortem. Older ones surface once, in the Decide row, and get retired.
  if (!p.sentAt) return false;
  const sent = new Date(p.sentAt).getTime();
  if (!Number.isFinite(sent)) return false;
  const ageDays = (now.getTime() - sent) / 86_400_000;
  return ageDays >= 0 && ageDays <= CHASE_WINDOW_DAYS;
}

/**
 * Old enough that chasing is no longer honest: it needs a decision instead. These are what feed
 * the single daily "Decide" row, never the action list.
 */
export function needsDecision(p: ProposalChaseInput, now: Date = new Date()): boolean {
  if (p.status !== "sent") return false;
  if (p.signedAt || p.lostAt) return false;
  if (hasReceivedMoney(p)) return false;
  if (!p.sentAt) return false;
  const ageDays = (now.getTime() - new Date(p.sentAt).getTime()) / 86_400_000;
  return ageDays > CHASE_WINDOW_DAYS;
}

// ── Ranking ──────────────────────────────────────────────────────────────────────────────────

/**
 * Why an item is on the list, in priority order. The rep sees the reason in words; there is no
 * hidden score. A number nobody can explain is a number nobody trusts.
 */
export type TodayReason =
  | "meeting"   // time-bound today, cannot move
  | "waiting"   // they replied, we have not
  | "money"     // proposal in its decision window
  | "task"      // something the rep set themselves
  | "billing"   // a payment is failing on a won deal
  | "followup"; // pipeline nudge, oldest first

/** Lower sorts first. Billing outranks follow-ups: won revenue leaking beats cold outreach. */
export const REASON_RANK: Record<TodayReason, number> = {
  meeting: 0,
  waiting: 1,
  billing: 2,
  money: 3,
  task: 4,
  followup: 5,
};

/** Never let the cold-outreach backlog crowd out real work. */
export const MAX_FOLLOWUPS_PER_DAY = 2;
/** The whole list. Seven is a morning's work; a list you finish is a list you come back to. */
export const MAX_ITEMS = 7;

export interface TodayItem {
  /** Stable across recomputes, so Done and Snooze survive the list being rebuilt. */
  sourceKey: string;
  reason: TodayReason;
  /** Who this is about. */
  personName: string;
  contactId?: string | null;
  /** The action, in the imperative. "Call at 14:00", not "Call scheduled". */
  action: string;
  /** Why it is here, in plain words. "Replied 2 days ago". */
  because: string;
  /** For tie-breaks within a reason: older first. */
  sortAt: Date;
  /**
   * ISO timestamp for anything the card must show as a CLOCK TIME. Formatted on the client, in
   * the rep's timezone. The server runs UTC on Vercel, so baking "Call at 14:00" server-side
   * stated a confidently wrong time to anyone not on UTC.
   */
  atISO?: string | null;
  href?: string | null;
}

/**
 * Rank, cap the follow-ups, then cap the list. Sorting is fully determined by the reason and
 * age, so two loads a minute apart cannot shuffle the list under the rep.
 */
export function rankAndCap(items: TodayItem[], max: number = MAX_ITEMS): TodayItem[] {
  const sorted = [...items].sort((a, b) => {
    const r = REASON_RANK[a.reason] - REASON_RANK[b.reason];
    if (r !== 0) return r;
    return a.sortAt.getTime() - b.sortAt.getTime(); // oldest first
  });

  let followups = 0;
  const kept: TodayItem[] = [];
  for (const it of sorted) {
    if (it.reason === "followup") {
      if (followups >= MAX_FOLLOWUPS_PER_DAY) continue;
      followups++;
    }
    kept.push(it);
    if (kept.length >= max) break;
  }
  return kept;
}
