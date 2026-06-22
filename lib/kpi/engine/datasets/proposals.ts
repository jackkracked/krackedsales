/**
 * Proposals dataset — internal DB (Drizzle over lib/db/schema.ts `proposals`).
 *
 * Highest-confidence dataset: our own data with exact timestamps. Mirrors the
 * field shapes used across /api/kpis/metrics and /api/dashboard/kpis.
 *
 * - `totalAmount` is the BILLED/discounted amount (already in dollars in the DB).
 * - Date fields (sentAt, paidAt, lostAt, signedAt, createdAt) are normalized to
 *   epoch ms (Number) or null.
 * - `createdBy` is the rep (user) id; the configurator populates its enum from
 *   the users table — see enumValues note. We expose the raw user id as the value
 *   so a session-injected rep filter (EngineCtx.userId) matches cleanly.
 *
 * The `users` enum is left empty here and filled at describe-time by the registry
 * (it needs an async DB read, which DatasetDef can't do synchronously). For v1 the
 * configurator can hydrate user options from the existing /api/team endpoint.
 */
import { db } from "@/lib/db";
import { proposals } from "@/lib/db/schema";
import { and, gte, lt, or, type SQLWrapper } from "drizzle-orm";
import type { DatasetDef, LoadCtx, RawRow } from "../types";

const toMs = (d: Date | string | null | undefined): number | null =>
  d ? new Date(d).getTime() : null;

export const proposalsDataset: DatasetDef = {
  key: "proposals",
  integration: "proposals",
  label: "Proposals",
  description: "Quotes you've sent clients — sent, won, paid, or lost.",
  fields: [
    {
      key: "type",
      label: "Deal type",
      type: "enum",
      operators: ["eq", "neq", "in"],
      enumValues: [
        { value: "management", label: "Retainer" },
        { value: "project", label: "One-off project" },
      ],
    },
    {
      key: "status",
      label: "Proposal status",
      type: "enum",
      operators: ["eq", "neq", "in"],
      enumValues: [
        { value: "draft", label: "Draft" },
        { value: "sent", label: "Sent" },
        { value: "signed", label: "Signed" },
        { value: "partial", label: "Part-paid" },
        { value: "paid", label: "Paid" },
        { value: "failed", label: "Payment failed" },
        { value: "void", label: "Cancelled" },
        { value: "overdue", label: "Overdue" },
      ],
    },
    { key: "totalAmount", label: "Deal value", type: "money", operators: ["gt", "lt", "between"] },
    {
      key: "createdBy",
      label: "Created by (rep)",
      type: "enum",
      operators: ["eq", "neq", "in"],
      // Populated from the users table by the configurator (async). Value = user id.
      enumValues: [],
    },
    { key: "autoRenew", label: "Auto-renews?", type: "boolean", operators: ["eq"] },
  ],
  dateFields: [
    { key: "sentAt", label: "Date sent" },
    { key: "paidAt", label: "Date paid" },
    { key: "lostAt", label: "Date lost" },
    { key: "signedAt", label: "Date signed" },
    { key: "createdAt", label: "Date created" },
  ],
  aggregations: ["count", "sum", "avg"],
  rowLabel: (row: RawRow) => ({
    label: (row.contactName as string) || (row.title as string) || "Proposal",
    sublabel: (row.title as string) || undefined,
  }),
  rowAmount: (row: RawRow) => Number(row.totalAmount ?? 0),
  load: async ({ fetchStart, fetchEnd, ctx }: LoadCtx): Promise<RawRow[]> => {
    try {
      // Pull every proposal that could fall in the window by ANY of its date
      // fields (a config picks one dateField; the engine filters precisely after).
      // We over-fetch on createdAt OR sentAt OR paidAt OR lostAt OR signedAt.
      const inWindow = (col: SQLWrapper) =>
        and(gte(col, fetchStart), lt(col, fetchEnd));
      const where = or(
        inWindow(proposals.createdAt),
        inWindow(proposals.sentAt),
        inWindow(proposals.paidAt),
        inWindow(proposals.lostAt),
        inWindow(proposals.signedAt),
      );

      const rows = await db()
        .select({
          id: proposals.id,
          title: proposals.title,
          contactName: proposals.contactName,
          type: proposals.type,
          status: proposals.status,
          totalAmount: proposals.totalAmount,
          createdBy: proposals.createdBy,
          autoRenew: proposals.autoRenew,
          sentAt: proposals.sentAt,
          paidAt: proposals.paidAt,
          lostAt: proposals.lostAt,
          signedAt: proposals.signedAt,
          createdAt: proposals.createdAt,
        })
        .from(proposals)
        .where(where);

      // Rep scoping: when a non-admin rep context is supplied, restrict to the
      // proposals they own (the "rep who sent it" rule used elsewhere). Done in
      // memory so the over-fetch-by-any-date-field window stays a single query.
      const repId = ctx.isAdmin === false ? ctx.userId ?? null : null;

      return rows
        // Apply rep scoping in memory (the createdBy column is the owner id).
        .filter((r) => (repId ? r.createdBy === repId : true))
        .map((r) => ({
          id: r.id,
          title: r.title,
          contactName: r.contactName,
          type: r.type,
          status: r.status,
          totalAmount: r.totalAmount, // already dollars
          createdBy: r.createdBy ?? "",
          autoRenew: r.autoRenew,
          sentAt: toMs(r.sentAt),
          paidAt: toMs(r.paidAt),
          lostAt: toMs(r.lostAt),
          signedAt: toMs(r.signedAt),
          createdAt: toMs(r.createdAt),
        }));
    } catch (e) {
      console.error("[kpi/datasets/proposals] fetch failed:", e);
      return [];
    }
  },
};
