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
  startDate?: string | Date | null;
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
  const n = count && count > 0 ? count : 1;
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

/** The suffix appended to the headline price, e.g. "/mo", " / 6 months", or "". */
export function priceSuffix(p: BillingTerms): string {
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

export interface DiscountInfo {
  listAmount: number;
  billed: number;
  saved: number;
  pct: number; // whole-number percent saved off the list price
}

/**
 * Returns discount details when a genuine discount exists, else null.
 * Always derives the saving from list-vs-billed, so it is correct regardless of
 * whether the discount was entered as a percentage or a fixed amount.
 */
export function discountInfo(p: BillingTerms): DiscountInfo | null {
  const list = p.listAmount;
  if (list == null || !(list > p.totalAmount)) return null;
  const saved = list - p.totalAmount;
  const pct = Math.round((saved / list) * 100);
  return { listAmount: list, billed: p.totalAmount, saved, pct };
}

/** The fixed-term window for a paid-in-full (auto-renew OFF) management proposal. */
export function termWindow(p: BillingTerms): { start: Date; end: Date } | null {
  if (billingModel(p) !== "one_time_term" || !p.startDate) return null;
  const start = new Date(p.startDate);
  if (Number.isNaN(start.getTime())) return null;
  return { start, end: addPeriod(start, p.billingInterval, p.billingIntervalCount) };
}

/**
 * The single, plain-language sentence the client reads about what they pay and
 * whether it ever happens again. Stupid-simple by design.
 */
export function clientSentence(p: BillingTerms): string {
  const model = billingModel(p);
  const start = fmtDay(p.startDate ?? null);
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
  const model = billingModel(p);
  if (model === "monthly_recurring") return "Monthly Retainer";
  if (model === "recurring") return "Retainer";
  if (model === "one_time_term") return `Retainer · ${periodPhrase(p.billingInterval, p.billingIntervalCount)} term`;
  return "Project Investment";
}
