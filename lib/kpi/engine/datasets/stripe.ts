/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Stripe datasets — charges, invoices, subscriptions. (LIVE — Gate 5 / §F.)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Each `load()` fetches the universe ONCE for [fetchStart, fetchEnd] (mirroring
 * the existing /api/kpis/metrics + /api/kpis/detail patterns) and returns
 * normalized RawRows.
 *
 * GATE 5 — money data:
 *   - NEVER leak raw Stripe objects or PII. Each row carries DISPLAY fields only:
 *     a customer NAME (via customerName() = name|email|id), an amount, a date,
 *     and a status. No `Stripe.Charge`, no card data, no email beyond the
 *     fallback display label.
 *   - Money fields are normalized to DOLLARS (Stripe cents /100), consistent
 *     with the existing routes.
 *   - Date fields are epoch milliseconds (Number) so the engine can compare them
 *     against the selected range directly.
 */
import Stripe from "stripe";
import { stripe, hasStripe } from "@/lib/stripe/client";
import type { DatasetDef, LoadCtx, RawRow } from "../types";

// ─── Shared helpers (mirrors the existing routes) ──────────────────────────────

async function paginateAll<T extends { id: string }>(
  fetcher: (startingAfter?: string) => Promise<{ data: T[]; has_more: boolean }>,
): Promise<T[]> {
  const all: T[] = [];
  let startingAfter: string | undefined;
  while (true) {
    const page = await fetcher(startingAfter);
    all.push(...page.data);
    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return all;
}

/** Display-only customer label — name → email → id. Never a raw object (Gate 5). */
function customerName(
  c: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined,
): string {
  if (!c) return "Unknown";
  if (typeof c === "string") return c;
  if (c.deleted) return (c as Stripe.DeletedCustomer).id;
  return (c as Stripe.Customer).name || (c as Stripe.Customer).email || c.id;
}

/** Normalise a subscription item's price to a monthly dollar amount (matches stripe-series). */
function toMonthlyDollars(item: Stripe.SubscriptionItem | undefined): number {
  if (!item) return 0;
  const unit = item.price.unit_amount ?? 0;
  const interval = item.price.recurring?.interval ?? "month";
  const count = item.price.recurring?.interval_count ?? 1;
  switch (interval) {
    case "year":  return unit / (12 * count) / 100;
    case "week":  return (unit * 52) / (12 * count) / 100;
    case "day":   return (unit * 365) / (12 * count) / 100;
    default:      return unit / count / 100; // month
  }
}

const isSubInvoice = (inv: Stripe.Invoice) =>
  inv.parent?.type === "subscription_details";

// ════════════════════════════════════════════════════════════════════════════
//  stripe.charges
// ════════════════════════════════════════════════════════════════════════════

export const stripeCharges: DatasetDef = {
  key: "stripe.charges",
  integration: "stripe",
  label: "Money paid in (card payments)",
  description:
    "All money customers actually paid you — one-off payments, paid invoices, and subscription payments ALL land here. This is your total cash collected, so you don't add invoices or subscriptions on top.",
  fields: [
    {
      key: "status",
      label: "Payment status",
      type: "enum",
      operators: ["eq", "neq", "in"],
      enumValues: [
        { value: "succeeded", label: "Paid" },
        { value: "failed", label: "Failed" },
        { value: "pending", label: "Pending" },
      ],
    },
    { key: "amount", label: "Amount paid", type: "money", operators: ["gt", "lt", "between"] },
    {
      key: "currency",
      label: "Currency",
      type: "enum",
      operators: ["eq", "neq", "in"],
      enumValues: [
        { value: "usd", label: "USD" },
        { value: "gbp", label: "GBP" },
        { value: "eur", label: "EUR" },
      ],
    },
    { key: "description", label: "Payment note", type: "string", operators: ["contains", "is_set", "is_not_set"] },
    { key: "fee", label: "Stripe processing fee", type: "money", operators: ["gt", "lt", "between"] },
  ],
  dateFields: [{ key: "created", label: "Date paid" }],
  aggregations: ["count", "sum", "avg"],
  rowLabel: (row: RawRow) => ({
    label: String(row.customer ?? "Unknown"),
    sublabel: (row.description as string) || undefined,
  }),
  rowAmount: (row: RawRow) => Number(row.amount ?? 0),
  load: async ({ fetchStart, fetchEnd }: LoadCtx): Promise<RawRow[]> => {
    if (!hasStripe()) return [];
    const s = stripe();
    const startUnix = Math.floor(fetchStart.getTime() / 1000);
    const endUnix = Math.floor(fetchEnd.getTime() / 1000);
    try {
      // expand the customer so customerName() resolves a real name/email,
      // not the raw `cus_…` id (mirrors /api/kpis/detail). No N+1 per row.
      type EC = Stripe.Charge & {
        customer: Stripe.Customer | Stripe.DeletedCustomer | string | null;
        balance_transaction: Stripe.BalanceTransaction | string | null;
      };
      const charges = await paginateAll<EC>((after) =>
        s.charges.list({
          created: { gte: startUnix, lt: endUnix },
          expand: ["data.customer", "data.balance_transaction"],
          limit: 100,
          ...(after ? { starting_after: after } : {}),
        }) as Promise<{ data: EC[]; has_more: boolean }>,
      );
      return charges.map((c) => ({
        // display-only — no raw Stripe object crosses this boundary
        customer: customerName(c.customer),
        status: c.status, // succeeded | failed | pending
        amount: c.amount / 100, // dollars
        // Stripe processing fee (from the expanded balance transaction), in dollars.
        fee: c.balance_transaction && typeof c.balance_transaction !== "string"
          ? (c.balance_transaction.fee ?? 0) / 100
          : 0,
        currency: c.currency,
        description: c.description ?? "",
        created: c.created * 1000, // epoch ms
      }));
    } catch (e) {
      console.error("[kpi/datasets/stripe.charges] fetch failed:", e);
      return [];
    }
  },
};

// ════════════════════════════════════════════════════════════════════════════
//  stripe.invoices
// ════════════════════════════════════════════════════════════════════════════

export const stripeInvoices: DatasetDef = {
  key: "stripe.invoices",
  integration: "stripe",
  label: "Invoices (paid & outstanding)",
  description:
    "What you've billed clients — and what's still owed or overdue. Use this for outstanding / overdue amounts. (Invoices that are already paid also count under “Money paid in”, so don't add both for cash collected.)",
  fields: [
    {
      key: "status",
      label: "Invoice status",
      type: "enum",
      operators: ["eq", "neq", "in"],
      enumValues: [
        { value: "open", label: "Unpaid / open" },
        { value: "paid", label: "Paid" },
        { value: "void", label: "Cancelled" },
        { value: "uncollectible", label: "Written off" },
      ],
    },
    { key: "amount_paid", label: "Amount paid", type: "money", operators: ["gt", "lt", "between"] },
    { key: "amount_remaining", label: "Amount still owed", type: "money", operators: ["gt", "lt", "between"] },
    { key: "is_subscription", label: "From a subscription?", type: "boolean", operators: ["eq"] },
    { key: "due_date_passed", label: "Past due?", type: "boolean", operators: ["eq"] },
  ],
  dateFields: [
    { key: "created", label: "Date created" },
    { key: "due_date", label: "Due date" },
  ],
  aggregations: ["count", "sum", "avg"],
  rowLabel: (row: RawRow) => ({
    label: String(row.customer ?? "Unknown"),
    sublabel: (row.number as string) || undefined,
  }),
  rowAmount: (row: RawRow) => Number(row.amount_paid ?? 0),
  load: async ({ fetchStart, fetchEnd }: LoadCtx): Promise<RawRow[]> => {
    if (!hasStripe()) return [];
    const s = stripe();
    const startUnix = Math.floor(fetchStart.getTime() / 1000);
    const endUnix = Math.floor(fetchEnd.getTime() / 1000);
    const nowUnix = Math.floor(Date.now() / 1000);
    try {
      // expand the customer so customerName() resolves name/email, not `cus_…`.
      type EI = Stripe.Invoice & { customer: Stripe.Customer | Stripe.DeletedCustomer | string | null };
      const invoices = await paginateAll<EI>((after) =>
        s.invoices.list({
          created: { gte: startUnix, lt: endUnix },
          expand: ["data.customer"],
          limit: 100,
          ...(after ? { starting_after: after } : {}),
        }) as Promise<{ data: EI[]; has_more: boolean }>,
      );
      return invoices.map((inv) => ({
        customer: customerName(inv.customer),
        number: inv.number ?? inv.id ?? "",
        status: inv.status ?? "open",
        amount_paid: (inv.amount_paid ?? 0) / 100, // dollars
        amount_remaining: (inv.amount_remaining ?? 0) / 100, // dollars
        is_subscription: isSubInvoice(inv),
        due_date_passed: inv.due_date != null && inv.due_date < nowUnix,
        created: (inv.created ?? 0) * 1000, // epoch ms
        due_date: inv.due_date != null ? inv.due_date * 1000 : null, // epoch ms | null
      }));
    } catch (e) {
      console.error("[kpi/datasets/stripe.invoices] fetch failed:", e);
      return [];
    }
  },
};

// ════════════════════════════════════════════════════════════════════════════
//  stripe.subscriptions
// ════════════════════════════════════════════════════════════════════════════

export const stripeSubscriptions: DatasetDef = {
  key: "stripe.subscriptions",
  integration: "stripe",
  label: "Subscriptions (recurring revenue)",
  description:
    "Customers on a recurring plan — for monthly recurring revenue (MRR). Their actual payments already count under “Money paid in”, so use this for the recurring run-rate, not for cash collected.",
  fields: [
    {
      key: "status",
      label: "Plan status",
      type: "enum",
      operators: ["eq", "neq", "in"],
      enumValues: [
        { value: "active", label: "Active" },
        { value: "canceled", label: "Cancelled" },
        { value: "past_due", label: "Past due" },
      ],
    },
    { key: "monthly_amount", label: "Monthly amount", type: "money", operators: ["gt", "lt", "between"] },
    { key: "is_prepaid", label: "Paid upfront?", type: "boolean", operators: ["eq"] },
  ],
  dateFields: [
    { key: "created", label: "Date started" },
    { key: "canceled_at", label: "Date cancelled" },
  ],
  aggregations: ["count", "sum"],
  rowLabel: (row: RawRow) => ({
    label: String(row.customer ?? "Unknown"),
    sublabel: (row.status as string) || undefined,
  }),
  rowAmount: (row: RawRow) => Number(row.monthly_amount ?? 0),
  load: async ({ fetchStart, fetchEnd }: LoadCtx): Promise<RawRow[]> => {
    if (!hasStripe()) return [];
    const s = stripe();
    try {
      // Fetch the full active + canceled universe once (matches stripe-series /
      // metrics route). The engine date-filters in memory against `created` /
      // `canceled_at`; the window arg keeps the fetch bounded where Stripe allows.
      void fetchStart;
      void fetchEnd;
      // expand the customer on each list call so customerName() resolves a real
      // name/email instead of the raw `cus_…` id (the visible drill-down bug).
      // expand is bounded per page (no N+1) and mirrors /api/kpis/detail.
      type ES = Stripe.Subscription & { customer: Stripe.Customer | Stripe.DeletedCustomer | string };
      const [activeSubs, canceledSubs, pastDueSubs] = await Promise.all([
        paginateAll<ES>((after) =>
          s.subscriptions.list({ status: "active", expand: ["data.customer"], limit: 100, ...(after ? { starting_after: after } : {}) }) as Promise<{ data: ES[]; has_more: boolean }>,
        ),
        paginateAll<ES>((after) =>
          s.subscriptions.list({ status: "canceled", expand: ["data.customer"], limit: 100, ...(after ? { starting_after: after } : {}) }) as Promise<{ data: ES[]; has_more: boolean }>,
        ),
        paginateAll<ES>((after) =>
          s.subscriptions.list({ status: "past_due", expand: ["data.customer"], limit: 100, ...(after ? { starting_after: after } : {}) }) as Promise<{ data: ES[]; has_more: boolean }>,
        ),
      ]);

      // is_prepaid joins proposals.autoRenew=false (paid-in-full = self-cancelling
      // subscription). Build the set of prepaid Stripe subscription ids once.
      const prepaidIds = new Set<string>();
      try {
        const { db } = await import("@/lib/db");
        const { proposals } = await import("@/lib/db/schema");
        const { and, eq, isNotNull } = await import("drizzle-orm");
        const rows = await db()
          .select({ stripeSubscriptionId: proposals.stripeSubscriptionId })
          .from(proposals)
          .where(and(eq(proposals.autoRenew, false), isNotNull(proposals.stripeSubscriptionId)));
        for (const r of rows) if (r.stripeSubscriptionId) prepaidIds.add(r.stripeSubscriptionId);
      } catch (e) {
        console.error("[kpi/datasets/stripe.subscriptions] prepaid join failed:", e);
      }

      return [...activeSubs, ...canceledSubs, ...pastDueSubs].map((sub) => ({
        customer: customerName(sub.customer),
        status: sub.status, // active | canceled | past_due | ...
        monthly_amount: toMonthlyDollars(sub.items.data[0]), // dollars, normalized
        is_prepaid: prepaidIds.has(sub.id),
        created: sub.created * 1000, // epoch ms
        canceled_at: sub.canceled_at != null ? sub.canceled_at * 1000 : null, // epoch ms | null
      }));
    } catch (e) {
      console.error("[kpi/datasets/stripe.subscriptions] fetch failed:", e);
      return [];
    }
  },
};
