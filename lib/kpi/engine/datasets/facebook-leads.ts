/**
 * Facebook lead forms, INDIVIDUAL leads (facebook_leads table).
 *
 * Unlike `meta.leads` (which reads Meta Insights and only knows per-campaign
 * COUNTS), this dataset has one row per real lead, with the person's name and the
 * campaign it came from. That is what lets "New Leads" show names in the drawer
 * while the headline count stays the true number of Facebook lead submissions.
 *
 * Date field `createdTime` is normalized to epoch ms (Number), like the other
 * DB-backed datasets.
 */
import { db } from "@/lib/db";
import { facebookLeads } from "@/lib/db/schema";
import { and, gte, lt } from "drizzle-orm";
import type { DatasetDef, LoadCtx, RawRow } from "../types";

export const facebookLeadsDataset: DatasetDef = {
  key: "meta.leadForms",
  integration: "meta",
  label: "Facebook leads (individual)",
  description:
    "Every individual Facebook/Instagram lead-form submission, pulled straight from Meta with the lead's name and the campaign it came from.",
  fields: [
    { key: "campaignName", label: "Ad campaign", type: "string", operators: ["contains", "eq", "is_set", "is_not_set"] },
    {
      key: "platform",
      label: "Platform",
      type: "enum",
      operators: ["eq", "neq", "in"],
      enumValues: [
        { value: "facebook", label: "Facebook" },
        { value: "instagram", label: "Instagram" },
      ],
    },
    { key: "isOrganic", label: "Organic (non-paid)", type: "boolean", operators: ["eq"] },
  ],
  dateFields: [{ key: "createdTime", label: "Date submitted" }],
  aggregations: ["count"],
  rowLabel: (row: RawRow) => ({
    label: (row.fullName as string) || (row.email as string) || (row.phone as string) || "New lead",
    sublabel: (row.campaignName as string) || (row.adName as string) || undefined,
  }),
  load: async ({ fetchStart, fetchEnd }: LoadCtx): Promise<RawRow[]> => {
    try {
      const rows = await db()
        .select({
          fullName: facebookLeads.fullName,
          email: facebookLeads.email,
          phone: facebookLeads.phone,
          campaignName: facebookLeads.campaignName,
          adName: facebookLeads.adName,
          platform: facebookLeads.platform,
          isOrganic: facebookLeads.isOrganic,
          createdTime: facebookLeads.createdTime,
        })
        .from(facebookLeads)
        .where(and(gte(facebookLeads.createdTime, fetchStart), lt(facebookLeads.createdTime, fetchEnd)));

      return rows.map((r) => ({
        fullName: r.fullName,
        email: r.email,
        phone: r.phone,
        campaignName: r.campaignName,
        adName: r.adName,
        platform: r.platform,
        isOrganic: r.isOrganic,
        createdTime: r.createdTime ? new Date(r.createdTime).getTime() : null, // epoch ms
      }));
    } catch (e) {
      console.error("[kpi/datasets/meta.leadForms] fetch failed:", e);
      return [];
    }
  },
};
