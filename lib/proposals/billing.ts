/**
 * Single source of truth for proposal billing wording + math.
 *
 * Used by the client-facing proposal (proposal-signing-page), the signed PDF
 * (agreement-pdf), the admin detail view (proposal-detail-slide-over), and the
 * builder's live preview (proposal-create-modal). Pure TypeScript — no JSX — so
 * it runs in the browser, on the server, and inside react-pdf identically.
 *
 * Billing model, in one place so all surfaces agree:
 *   - `totalAmount` is ALWAYS the amount Stripe charges (the discounted/billed total).
 *   - `listAmount` is the pre-discount full price, shown struck-through. Display only.
 *   - Auto-renew ON  => paymentStructure "subscription" => recurring every N months.
 *   - Auto-renew OFF => paymentStructure "single"       => one charge covering N months, never recurs.
 */

export interface BillingTerms {
  type: string; // "management" | "project"
  paymentStructure: string; // "subscription" | "single" | "instalment"
  totalAmount: number; // BILLED amount (what Stripe charges)
  currency: string;
  billingInterval?: string | null; // "day" | "week" | "month" | "year"
  billingIntervalCount?: number | null;
  autoRenew?: boolean | null;
  listAmount?: number | null; // pre-discount full price
  discountType?: string | null; // "percent" | "fixed"
  discountValue?: number | null;
  discountScope?: string | null; // "recurring" (default) | "first_payment" | "total"
  startDate?: string | Date | null;
  // 90-Day Management model. `totalAmount` for these is the MONTHLY figure; the engine
  // charges monthly × 3 for the term (createUpfrontCheckout / the spread cron). These fields
  // let the DISPLAY show the true 90-day figures without ever changing what Stripe charges.
  managementOption?: string | null; // "upfront" | "spread" (absent = legacy monthly retainer)
  autoRebillMode?: string | null; // "none" | "monthly" | "full90"
  // Stored as jsonb (untyped at the DB layer) — narrowed at runtime in managementSchedule.
  // Shape when present: Array<{ amount: number; offsetDays?: number }>.
  firstPaymentSplit?: unknown;
  contractStartAt?: string | Date | null;
  // Frozen copy of the rows the client was already shown. When present it is rendered verbatim
  // and no date is recomputed. See managementSchedule().
  scheduleSnapshot?: Array<{ label: string; when: string; amount: number }> | null;
}

export type BillingModel =
  | "monthly_recurring" // management subscription billed monthly
  | "recurring" // management subscription billed every N months / yearly
  | "one_time_term" // management paid in full, covers N months, no renewal
  | "single" // project one-off
  | "instalment"; // project split into instalments

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "11 Jun 2026" in UTC — matches the existing proposal date formatting. */
export function fmtDay(d: string | Date | null | undefined): string | null {
  if (!d) return null;
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function fmtMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency || "usd").toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** "month" | "year" | "6 months" | "3 months" — the period as a noun phrase. */
export function periodPhrase(interval: string | null | undefined, count: number | null | undefined): string {
  const n = count && count > 0 ? count : 1;
  const unit = interval || "month";
  if (n > 1) return `${n} ${unit}s`;
  return unit; // "month" | "year" | "week" | "day"
}

/** Add N periods to a date (used to compute a fixed-term end date). */
export function addPeriod(date: Date, interval: string | null | undefined, count: number | null | undefined): Date {
  const out = new Date(date);
  // Only a MISSING count defaults to 1. The old `count && count > 0` guard also swallowed an
  // explicit 0, so `addPeriod(start, "day", 0)` advanced a day: the first row of a payment
  // schedule printed one day later than the start date shown in the sentence above it.
  const n = count ?? 1;
  const unit = interval || "month";
  if (unit === "day") out.setUTCDate(out.getUTCDate() + n);
  else if (unit === "week") out.setUTCDate(out.getUTCDate() + n * 7);
  else if (unit === "month") out.setUTCMonth(out.getUTCMonth() + n);
  else if (unit === "year") out.setUTCFullYear(out.getUTCFullYear() + n);
  return out;
}

export function billingModel(p: BillingTerms): BillingModel {
  const isManagement = p.type === "management";
  if (isManagement) {
    // Paid-in-full term = auto-renew OFF. It's now modelled in Stripe as a
    // self-cancelling subscription (so it still counts toward management clients/MRR),
    // so the model is driven by autoRenew, not by paymentStructure. Any legacy
    // non-subscription management row is also treated as a one-time term.
    if (p.autoRenew === false || p.paymentStructure !== "subscription") return "one_time_term";
    const phrase = periodPhrase(p.billingInterval, p.billingIntervalCount);
    return phrase === "month" ? "monthly_recurring" : "recurring";
  }
  return p.paymentStructure === "instalment" ? "instalment" : "single";
}

/** A 90-Day Management term is exactly 3 monthly cycles. Baked into the billing engine
 *  (createUpfrontCheckout charges monthly × 3; the cron schedules months 2 & 3). */
export const MANAGEMENT_TERM_MONTHS = 3;

/** True for the 90-Day Management product (as opposed to a legacy monthly retainer).
 *
 *  The `paymentStructure` check is load-bearing. For a genuine 90-day proposal `totalAmount`
 *  is the MONTHLY figure, so callers multiply it by 3. But a deal sold as a project with
 *  instalments stores the FULL contract value in `totalAmount`, split across its instalment
 *  rows. A 2026-07 migration tagged four such deals `managementOption: "spread"` purely so
 *  Management MRR would count them, which silently flipped them into 90-day display mode and
 *  tripled what everyone saw: Cheeky's $3,600 contract was shown to Jack as $10,800, with
 *  invented +30/+60 day dates instead of its real schedule. An instalment plan is never a
 *  90-day monthly figure, so exclude it. */
export function isNinetyDay(p: BillingTerms): boolean {
  if (p.paymentStructure === "instalment") return false;
  return p.type === "management" && (p.managementOption === "upfront" || p.managementOption === "spread");
}

/** Multiply a monthly figure by this to display the full 90-day figure. 1 for everything
 *  else, so non-90-day proposals are untouched. */
export function termMultiplier(p: BillingTerms): number {
  return isNinetyDay(p) ? MANAGEMENT_TERM_MONTHS : 1;
}

/** The full amount the client pays across the whole engagement — the number to LEAD with.
 *  For a 90-Day Management proposal `totalAmount` is the monthly figure, so the term total is
 *  monthly × 3 ($4,500 from $1,500). Every other proposal already stores its true total. */
export function fullTermTotal(p: BillingTerms): number {
  // A "first_payment" discount comes off ONCE, so it is subtracted from the term total rather
  // than multiplied through it. With a recurring discount there is nothing to subtract — it is
  // already inside totalAmount and therefore already in every month.
  // Kamil Broz, $1,000/mo with $250 off: recurring = $2,250, first_payment = $2,750.
  const gross = p.totalAmount * termMultiplier(p);
  return Math.round((gross - firstPaymentDiscount(p)) * 100) / 100;
}

/** The suffix appended to the headline price, e.g. "/mo", " / 6 months", or "". */
export function priceSuffix(p: BillingTerms): string {
  // 90-Day proposals display the full 90-day total, so the period lives in the sentence, not a "/mo".
  if (isNinetyDay(p)) return "";
  switch (billingModel(p)) {
    case "monthly_recurring":
      return "/mo";
    case "recurring":
      return ` / ${periodPhrase(p.billingInterval, p.billingIntervalCount)}`;
    default:
      // one_time_term / single / instalment: the period is conveyed in the sentence, not the price.
      return "";
  }
}

export interface ManagementScheduleRow {
  label: string; // "Payment 1 of 3", "First payment", "Month 2", ...
  when: string; // formatted date, or a relative fallback ("At signup", "Day 30")
  amount: number;
}

/** The "spread" plan charges every 30 days, not on calendar months. One constant so the
 *  schedule, the term window and the sentence can never drift apart again. */
export const SPREAD_CADENCE_DAYS = 30;

/**
 * The ONE date every client-facing figure hangs off: the schedule, the sentence and the
 * invoice date.
 *
 * Previously the schedule read `contractStartAt ?? startDate` while the sentence and the
 * invoice date read `startDate` alone. `contract_start_at` is set when the first month is
 * fully collected (db/schema.ts), so the moment payment 1 cleared, the table silently
 * re-anchored to a different day than the sentence directly above it and the document
 * contradicted itself. Both now come through here, so they cannot disagree.
 *
 * `contractStartAt` still wins when present: once money has actually moved, the real charge
 * dates are anchored to it, and showing the originally-quoted date would be a lie.
 */
export function billingAnchor(p: BillingTerms): Date | null {
  const raw = p.contractStartAt ?? p.startDate ?? null;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The client-facing payment schedule for a 90-Day Management proposal paid every 30 days
 * (the "spread" option). Mirrors how a project instalment schedule reads: N dated rows that
 * sum to the 90-day total. Returns null for upfront / non-90-day proposals (no schedule).
 * Dates are the true charge offsets (+30 / +60 days from the term start); amounts use the
 * stored monthly figure. Handles a split first payment when one is configured.
 */
export function managementSchedule(p: BillingTerms): ManagementScheduleRow[] | null {
  if (!isNinetyDay(p) || p.managementOption !== "spread") return null;

  // A snapshot is what the client has ALREADY BEEN SHOWN, so it wins — but ONLY before money
  // moves. Once `contractStartAt` is set the true charge dates are known, and a snapshot frozen
  // beforehand was only ever an estimate off `startDate`.
  //
  // This check used to sit above the spread guard and had no `contractStartAt` condition, which
  // broke two things:
  //   1. The re-freeze in ninety-day-fulfillment.ts called managementSchedule() to build the
  //      corrected rows, got the OLD snapshot back verbatim, and wrote it straight back. The
  //      freeze-at-payment was a no-op, so a proposal frozen pre-payment kept its estimated
  //      dates forever. Mind Balanced, frozen to 7 Aug, would have shown a first payment
  //      thirteen days BEFORE its own signature if signed on the 20th.
  //   2. A non-spread proposal that ever acquired a snapshot would render a schedule where it
  //      previously rendered null. Running the spread guard first makes that unreachable.
  const anchored = !!p.contractStartAt;
  if (!anchored && Array.isArray(p.scheduleSnapshot) && p.scheduleSnapshot.length > 0) {
    return p.scheduleSnapshot;
  }
  const monthly = p.totalAmount;
  const anchor = billingAnchor(p);
  const when = (offsetDays: number, fallback: string) =>
    anchor ? (fmtDay(addPeriod(anchor, "day", offsetDays)) ?? fallback) : fallback;

  const split =
    Array.isArray(p.firstPaymentSplit) && p.firstPaymentSplit.length > 1
      ? (p.firstPaymentSplit as Array<{ amount: number; offsetDays?: number }>)
      : null;

  const rows: ManagementScheduleRow[] = [];
  // Each payment falls SPREAD_CADENCE_DAYS after the one BEFORE it, so `cursor` tracks the
  // offset of the last row pushed rather than counting from signup. The old code used fixed
  // +30/+60 offsets from the anchor, which silently ignored the split portions: a first
  // payment split at day 14 still put "Month 2" at day 30, only 16 days later.
  let cursor = 0;

  if (split) {
    split.forEach((portion, i) => {
      // Never let a mis-entered offset move a portion backwards past the one before it.
      cursor = i === 0 ? 0 : Math.max(portion.offsetDays ?? 0, cursor);
      rows.push({
        label: i === 0 ? "First payment" : `Portion ${i + 1}`,
        when: when(cursor, i === 0 ? "At signup" : `Day ${cursor}`),
        amount: portion.amount,
      });
    });
    // Month 2 is 30 days after the LAST split portion, not 30 days after signup.
    for (let n = 2; n <= MANAGEMENT_TERM_MONTHS; n++) {
      cursor += SPREAD_CADENCE_DAYS;
      rows.push({ label: `Month ${n}`, when: when(cursor, `Day ${cursor}`), amount: monthly });
    }
  } else {
    for (let n = 1; n <= MANAGEMENT_TERM_MONTHS; n++) {
      if (n > 1) cursor += SPREAD_CADENCE_DAYS;
      rows.push({
        label: `Payment ${n} of ${MANAGEMENT_TERM_MONTHS}`,
        when: when(cursor, n === 1 ? "At signup" : `Day ${cursor}`),
        amount: monthly,
      });
    }
  }

  // A one-off discount lands on the FIRST payment only — the first PORTION when the first month
  // is split (Jack, 2026-08-15), which is also exactly what a Stripe `once` coupon does, so the
  // schedule and the invoice agree by construction.
  const oneOff = firstPaymentDiscount(p);
  if (oneOff > 0 && rows.length > 0) {
    rows[0] = { ...rows[0], amount: Math.max(0, Math.round((rows[0].amount - oneOff) * 100) / 100) };
  }
  return rows;
}

/** The last payment offset in days, so the term window can end where the schedule actually
 *  ends instead of on a calendar-month boundary that disagrees with it. */
export function spreadTermDays(p: BillingTerms): number {
  const split =
    Array.isArray(p.firstPaymentSplit) && p.firstPaymentSplit.length > 1
      ? (p.firstPaymentSplit as Array<{ amount: number; offsetDays?: number }>)
      : null;
  let cursor = 0;
  if (split) split.forEach((portion, i) => { cursor = i === 0 ? 0 : Math.max(portion.offsetDays ?? 0, cursor); });
  return cursor + SPREAD_CADENCE_DAYS * (MANAGEMENT_TERM_MONTHS - 1);
}

/**
 * The one line that explains the discount to the CLIENT, in money, on both the web proposal and
 * the PDF. A once-off discount reduces payment 1 on the schedule while the price stays whole, so
 * without this sentence the client sees two different numbers and no reason for the gap.
 * `fmt` formats an amount in the proposal currency. Returns null when there is no discount.
 */
export function discountSentence(p: BillingTerms, fmt: (n: number) => string): string | null {
  const d = discountInfo(p);
  if (!d) return null;
  if (firstPaymentDiscount(p) > 0) {
    const target = Array.isArray(p.firstPaymentSplit) && p.firstPaymentSplit.length > 1
      ? "the first payment of your first month"
      : "your first payment";
    return `A discount of ${fmt(d.saved)} has been applied to ${target}. All later payments are charged in full.`;
  }
  return `A ${d.pct}% discount has been applied to the list price of ${fmt(d.listAmount)} (a saving of ${fmt(d.saved)}).`;
}

export interface DiscountInfo {
  listAmount: number;
  billed: number;
  saved: number;
  pct: number; // whole-number percent saved off the list price
}

/**
 * A one-off discount, in currency units, or 0 when the discount repeats.
 *
 * With scope "first_payment" the stored `totalAmount` is the FULL price and this amount comes off
 * the FIRST payment only — the first PORTION when a first month is split (Jack, 2026-08-15).
 * With "recurring" (or a legacy null) the discount is already inside `totalAmount`, so there is
 * nothing further to take off and this returns 0.
 *
 * The schedule, the proposal document and the Stripe coupon all read this, so a discount cannot
 * mean one thing on screen and another on the invoice.
 */
export function firstPaymentDiscount(p: BillingTerms): number {
  if (p.discountScope !== "first_payment") return 0;
  const value = p.discountValue ?? 0;
  if (value <= 0) return 0;
  const base = p.totalAmount;
  const amount = p.discountType === "percent" ? base * (value / 100) : value;
  // Never below zero, and never more than the payment it comes off.
  return Math.max(0, Math.min(Math.round(amount * 100) / 100, base));
}

/**
 * Returns discount details when a genuine discount exists, else null.
 *
 * FIGURES ARE FOR THE WHOLE ENGAGEMENT, not per month — a 90-day retainer's `totalAmount` is a
 * monthly price, and a client reading "£250 off" next to a monthly figure cannot tell whether they
 * save £250 or £750. Callers must NOT multiply by termMultiplier again.
 *
 * Both scopes land here so the document has one source of truth:
 *   recurring      — the discount is already inside totalAmount and repeats, so the saving is
 *                    multiplied through the term: £250/mo off a 90-day term shows as £750.
 *   first_payment  — the price is whole and the discount comes off once, so the saving is £250
 *                    however long the term runs. Without this branch listAmount == totalAmount,
 *                    the old `list > totalAmount` test returned null, and the client saw payment 1
 *                    reduced on the schedule with nothing on the page explaining why.
 *
 * The saving is always derived from list-vs-billed, so it is right whether the rep entered a
 * percentage or a fixed amount.
 */
export function discountInfo(p: BillingTerms): DiscountInfo | null {
  const mult = termMultiplier(p);
  const oneOff = firstPaymentDiscount(p);
  if (oneOff > 0) {
    const list = Math.round(p.totalAmount * mult * 100) / 100;
    if (!(list > 0)) return null;
    return { listAmount: list, billed: Math.round((list - oneOff) * 100) / 100, saved: oneOff, pct: Math.round((oneOff / list) * 100) };
  }
  const list = p.listAmount;
  if (list == null || !(list > p.totalAmount)) return null;
  const saved = Math.round((list - p.totalAmount) * mult * 100) / 100;
  return {
    listAmount: Math.round(list * mult * 100) / 100,
    billed: Math.round(p.totalAmount * mult * 100) / 100,
    saved,
    pct: Math.round(((list - p.totalAmount) / list) * 100),
  };
}

/** The fixed-term window for a paid-in-full (auto-renew OFF) management proposal. */
export function termWindow(p: BillingTerms): { start: Date; end: Date } | null {
  const start = billingAnchor(p);
  if (!start) return null;
  // "spread" charges every 30 days, so its term ends 30 days after the FINAL payment. Calendar
  // months here put the window end on a different day from the last row of the schedule
  // printed directly above it (e.g. window to 10 Nov, last payment 9 Oct).
  if (isNinetyDay(p) && p.managementOption === "spread") {
    return { start, end: addPeriod(start, "day", spreadTermDays(p) + SPREAD_CADENCE_DAYS) };
  }
  // "upfront" is a single charge on a genuine 3-calendar-month price, so it stays calendar-based.
  if (isNinetyDay(p)) return { start, end: addPeriod(start, "month", MANAGEMENT_TERM_MONTHS) };
  if (billingModel(p) !== "one_time_term") return null;
  return { start, end: addPeriod(start, p.billingInterval, p.billingIntervalCount) };
}

/**
 * The single, plain-language sentence the client reads about what they pay and
 * whether it ever happens again. Stupid-simple by design.
 */
export function clientSentence(p: BillingTerms): string {
  // Same anchor as the schedule table and the invoice date, so the sentence can never quote a
  // different start day from the rows printed underneath it.
  const start = fmtDay(billingAnchor(p));

  // 90-Day Management: lead with the full 90-day total, and say plainly whether it's one
  // payment (upfront) or three monthly payments (spread), plus what happens after the term.
  if (isNinetyDay(p)) {
    const win = termWindow(p);
    const window = win ? ` (${fmtDay(win.start)} – ${fmtDay(win.end)})` : "";
    const rebill = p.autoRebillMode ?? "none";
    const afterUpfront =
      rebill === "monthly"
        ? ` After the term, billed ${fmtMoney(p.totalAmount, p.currency)}/month until you cancel.`
        : rebill === "full90"
        ? " Renews for another 90-day term unless you cancel."
        : " No further charges.";
    const afterSpread =
      rebill === "monthly"
        ? " After the term, billing continues monthly until you cancel."
        : rebill === "full90"
        ? " Renews for another 90-day term unless you cancel."
        : " No further charges after the term.";
    if (p.managementOption === "upfront") {
      return `One payment of ${fmtMoney(fullTermTotal(p), p.currency)} covering the full 90-day term${window}.${afterUpfront}`;
    }
    const hasSplit = Array.isArray(p.firstPaymentSplit) && p.firstPaymentSplit.length > 1;
    const base = hasSplit
      ? `${fmtMoney(fullTermTotal(p), p.currency)} total across the 90-day term${start ? `, starting ${start}` : ""}. See the payment schedule below.`
      : `${fmtMoney(fullTermTotal(p), p.currency)} total, paid in 3 monthly payments of ${fmtMoney(p.totalAmount, p.currency)}${start ? `, starting ${start}` : ""}. See the payment schedule below.`;
    return `${base}${afterSpread}`;
  }

  const model = billingModel(p);
  switch (model) {
    case "monthly_recurring":
      return `Billed monthly${start ? `, starting ${start}` : ""}. Renews automatically until you cancel.`;
    case "recurring":
      return `Billed every ${periodPhrase(p.billingInterval, p.billingIntervalCount)}${
        start ? `, starting ${start}` : ""
      }. Renews automatically until you cancel.`;
    case "one_time_term": {
      const win = termWindow(p);
      const window = win ? ` (${fmtDay(win.start)} – ${fmtDay(win.end)})` : "";
      return `One payment covering ${periodPhrase(p.billingInterval, p.billingIntervalCount)}${window}. No further charges.`;
    }
    case "instalment":
      return "Paid in instalments per the schedule below.";
    default:
      return "One-time payment.";
  }
}

/** Short label for the headline amount block, e.g. "Monthly Retainer". */
export function amountBlockLabel(p: BillingTerms): string {
  if (isNinetyDay(p)) return "90-Day Retainer";
  const model = billingModel(p);
  if (model === "monthly_recurring") return "Monthly Retainer";
  if (model === "recurring") return "Retainer";
  if (model === "one_time_term") return `Retainer · ${periodPhrase(p.billingInterval, p.billingIntervalCount)} term`;
  return "Project Investment";
}
