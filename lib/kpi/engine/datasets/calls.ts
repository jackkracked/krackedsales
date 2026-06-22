/**
 * Calls dataset — internal DB (`calls` table: unified Meet + GHL dialer log).
 *
 * - `callType`: "meet" | "dialer"
 * - `direction`: "inbound" | "outbound" | null (Meet has no direction)
 * - `repEmail`: Google email (Meet) or GHL user email (Dialer) — the rep enum
 * - `durationSeconds`: nullable integer, summable
 * - date field `startedAt` normalized to epoch ms (Number).
 *
 * Rep scoping: a non-admin rep context filters to their own `repEmail`.
 */
import { db } from "@/lib/db";
import { calls } from "@/lib/db/schema";
import { and, gte, lt } from "drizzle-orm";
import type { DatasetDef, LoadCtx, RawRow } from "../types";

export const callsDataset: DatasetDef = {
  key: "calls",
  integration: "calls",
  label: "Sales calls",
  description: "Every call your team made or took — video meetings and phone calls.",
  fields: [
    {
      key: "callType",
      label: "Call type",
      type: "enum",
      operators: ["eq", "neq", "in"],
      enumValues: [
        { value: "meet", label: "Video meeting" },
        { value: "dialer", label: "Phone call" },
      ],
    },
    {
      key: "direction",
      label: "Incoming or outgoing",
      type: "enum",
      operators: ["eq", "neq", "in", "is_set", "is_not_set"],
      enumValues: [
        { value: "inbound", label: "Incoming" },
        { value: "outbound", label: "Outgoing" },
      ],
    },
    {
      key: "repEmail",
      label: "Rep",
      type: "enum",
      operators: ["eq", "neq", "in"],
      // Populated from the users table by the configurator. Value = rep email.
      enumValues: [],
    },
    { key: "durationSeconds", label: "Call length (seconds)", type: "count", operators: ["gt", "lt", "between"] },
  ],
  dateFields: [{ key: "startedAt", label: "Date of call" }],
  aggregations: ["count", "sum"],
  rowLabel: (row: RawRow) => ({
    label: (row.contactName as string) || (row.repName as string) || "Call",
    sublabel: (row.callType as string) || undefined,
  }),
  load: async ({ fetchStart, fetchEnd, ctx }: LoadCtx): Promise<RawRow[]> => {
    try {
      const rows = await db()
        .select({
          contactName: calls.contactName,
          repName: calls.repName,
          callType: calls.callType,
          direction: calls.direction,
          repEmail: calls.repEmail,
          durationSeconds: calls.durationSeconds,
          startedAt: calls.startedAt,
        })
        .from(calls)
        .where(and(gte(calls.startedAt, fetchStart), lt(calls.startedAt, fetchEnd)));

      // Rep scoping (non-admin): only this rep's own calls, by email.
      const repEmail = ctx.isAdmin === false ? ctx.repEmail ?? null : null;

      return rows
        .filter((r) => (repEmail ? r.repEmail === repEmail : true))
        .map((r) => ({
          contactName: r.contactName,
          repName: r.repName,
          callType: r.callType,
          direction: r.direction ?? null,
          repEmail: r.repEmail ?? "",
          durationSeconds: r.durationSeconds ?? 0,
          startedAt: r.startedAt ? new Date(r.startedAt).getTime() : null, // epoch ms
        }));
    } catch (e) {
      console.error("[kpi/datasets/calls] fetch failed:", e);
      return [];
    }
  },
};
