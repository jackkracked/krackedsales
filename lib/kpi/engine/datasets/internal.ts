/**
 * Internal DB datasets that don't fit the integration buckets:
 *   - softwareCosts   (snapshot — no date; a current monthly run-rate)
 *   - manualExpenses  (period-keyed by `month` "YYYY-MM")
 *   - demoBoards      (lifecycle dates)
 *
 * All money is already in dollars in the DB. Date fields are epoch ms (Number).
 */
import { db } from "@/lib/db";
import { softwareCosts, manualExpenses, demoBoards } from "@/lib/db/schema";
import { gte, lt, and, or, type SQLWrapper } from "drizzle-orm";
import type { DatasetDef, LoadCtx, RawRow } from "../types";

const toMs = (d: Date | string | null | undefined): number | null =>
  d ? new Date(d).getTime() : null;

// ════════════════════════════════════════════════════════════════════════════
//  software_costs — snapshot (no date field). Current monthly run-rate.
// ════════════════════════════════════════════════════════════════════════════

export const softwareCostsDataset: DatasetDef = {
  key: "software_costs",
  integration: "internal",
  label: "Money paid out — software",
  description: "What you pay every month for the tools and software your business runs on.",
  fields: [
    { key: "monthlyCost", label: "Monthly cost", type: "money", operators: ["gt", "lt", "between"] },
    { key: "active", label: "Still paying for it?", type: "boolean", operators: ["eq"] },
    { key: "category", label: "Category", type: "string", operators: ["contains", "eq", "is_set", "is_not_set"] },
  ],
  dateFields: [], // snapshot — a level, not a flow
  aggregations: ["count", "sum"],
  rowLabel: (row: RawRow) => ({
    label: (row.name as string) || "Software cost",
    sublabel: (row.category as string) || undefined,
  }),
  rowAmount: (row: RawRow) => Number(row.monthlyCost ?? 0),
  load: async (_ctx: LoadCtx): Promise<RawRow[]> => {
    try {
      const rows = await db()
        .select({
          name: softwareCosts.name,
          monthlyCost: softwareCosts.monthlyCost,
          active: softwareCosts.active,
        })
        .from(softwareCosts);
      return rows.map((r) => ({
        name: r.name,
        monthlyCost: r.monthlyCost, // dollars
        active: r.active,
        // `category` is not a column today; expose empty so the field is valid.
        category: "",
      }));
    } catch (e) {
      console.error("[kpi/datasets/software_costs] fetch failed:", e);
      return [];
    }
  },
};

// ════════════════════════════════════════════════════════════════════════════
//  manual_expenses — period-keyed by `month` ("YYYY-MM").
// ════════════════════════════════════════════════════════════════════════════

/** Convert a "YYYY-MM" month key to the epoch ms of that month's first day (UTC). */
function monthKeyToMs(month: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, 1);
}

export const manualExpensesDataset: DatasetDef = {
  key: "manual_expenses",
  integration: "internal",
  label: "Money paid out — other expenses",
  description: "Other costs you've entered by hand, grouped by month.",
  fields: [
    { key: "category", label: "Category", type: "string", operators: ["contains", "eq", "is_set", "is_not_set"] },
    { key: "amount", label: "Amount spent", type: "money", operators: ["gt", "lt", "between"] },
  ],
  // `month` is period-keyed ("YYYY-MM"); we expose it as a date (first of month).
  dateFields: [{ key: "month", label: "Month" }],
  aggregations: ["sum", "count"],
  rowLabel: (row: RawRow) => ({
    label: (row.name as string) || "Expense",
    sublabel: (row.category as string) || undefined,
  }),
  rowAmount: (row: RawRow) => Number(row.amount ?? 0),
  load: async ({ fetchStart, fetchEnd }: LoadCtx): Promise<RawRow[]> => {
    try {
      // `month` is text ("YYYY-MM"), not a timestamp, so we fetch all rows and
      // filter the month→epoch in memory against the window. The table is tiny.
      const rows = await db()
        .select({
          name: manualExpenses.name,
          amount: manualExpenses.amount,
          category: manualExpenses.category,
          month: manualExpenses.month,
        })
        .from(manualExpenses);
      const lo = fetchStart.getTime();
      const hi = fetchEnd.getTime();
      return rows
        .map((r) => ({
          name: r.name,
          amount: r.amount, // dollars
          category: r.category ?? "",
          month: monthKeyToMs(r.month), // epoch ms (first of month) | null
        }))
        .filter((r) => r.month != null && r.month >= lo && r.month < hi);
    } catch (e) {
      console.error("[kpi/datasets/manual_expenses] fetch failed:", e);
      return [];
    }
  },
};

// ════════════════════════════════════════════════════════════════════════════
//  demo_boards — branded demo board per prospect, lifecycle dates.
// ════════════════════════════════════════════════════════════════════════════

export const demoBoardsDataset: DatasetDef = {
  key: "demo_boards",
  integration: "internal",
  label: "Demo boards",
  description: "The custom demo boards you send prospects — from first draft to booked call.",
  fields: [
    {
      key: "status",
      label: "Stage",
      type: "enum",
      operators: ["eq", "neq", "in"],
      enumValues: [
        { value: "created", label: "Created" },
        { value: "awaiting_design", label: "Waiting on design" },
        { value: "in_review", label: "In review" },
        { value: "sent", label: "Sent to prospect" },
        { value: "opened", label: "Opened by prospect" },
        { value: "engaged", label: "Prospect engaged" },
        { value: "booked", label: "Call booked" },
        { value: "closed", label: "Closed" },
      ],
    },
    {
      key: "repId",
      label: "Rep",
      type: "enum",
      operators: ["eq", "neq", "in"],
      // Populated from the users table by the configurator. Value = user id.
      enumValues: [],
    },
  ],
  dateFields: [
    { key: "sentAt", label: "Date sent" },
    { key: "bookedAt", label: "Date call booked" },
    { key: "firstOpenedAt", label: "Date first opened" },
    { key: "createdAt", label: "Date created" },
  ],
  aggregations: ["count"],
  rowLabel: (row: RawRow) => ({
    label: (row.contactName as string) || "Demo board",
    sublabel: (row.status as string) || undefined,
  }),
  load: async ({ fetchStart, fetchEnd, ctx }: LoadCtx): Promise<RawRow[]> => {
    try {
      const inWindow = (col: SQLWrapper) =>
        and(gte(col, fetchStart), lt(col, fetchEnd));
      const where = or(
        inWindow(demoBoards.createdAt),
        inWindow(demoBoards.sentAt),
        inWindow(demoBoards.bookedAt),
        inWindow(demoBoards.firstOpenedAt),
      );

      const rows = await db()
        .select({
          contactName: demoBoards.contactName,
          status: demoBoards.status,
          repId: demoBoards.repId,
          sentAt: demoBoards.sentAt,
          bookedAt: demoBoards.bookedAt,
          firstOpenedAt: demoBoards.firstOpenedAt,
          createdAt: demoBoards.createdAt,
        })
        .from(demoBoards)
        .where(where);

      const repId = ctx.isAdmin === false ? ctx.userId ?? null : null;

      return rows
        .filter((r) => (repId ? r.repId === repId : true))
        .map((r) => ({
          contactName: r.contactName,
          status: r.status,
          repId: r.repId ?? "",
          sentAt: toMs(r.sentAt),
          bookedAt: toMs(r.bookedAt),
          firstOpenedAt: toMs(r.firstOpenedAt),
          createdAt: toMs(r.createdAt),
        }));
    } catch (e) {
      console.error("[kpi/datasets/demo_boards] fetch failed:", e);
      return [];
    }
  },
};
