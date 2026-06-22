/**
 * Meta (Facebook/Instagram) ad-spend dataset.
 *
 * Reuses the existing daily-spend fetch shape from lib/kpi/meta-series.ts
 * (`/{adAccountId}/insights` with time_increment=1). Each row is one campaign's
 * spend for one day, so the engine can filter by campaign name and date-bucket.
 *
 * Money is dollars; the `date` field is epoch ms (Number).
 */
import type { DatasetDef, LoadCtx, RawRow } from "../types";
import { leadsFromActions, type MetaAction } from "@/lib/kpi/meta-series";

interface MetaInsightRow {
  spend?: string;
  date_start?: string;
  campaign_name?: string;
}

export const metaSpend: DatasetDef = {
  key: "meta.spend",
  integration: "meta",
  label: "Money paid out — Meta ads",
  description: "What you spent advertising on Facebook & Instagram.",
  fields: [
    { key: "spend", label: "Amount spent", type: "money", operators: ["gt", "lt", "between"] },
    { key: "campaign", label: "Ad campaign", type: "string", operators: ["contains", "eq", "is_set", "is_not_set"] },
  ],
  dateFields: [{ key: "date", label: "Date spent" }],
  aggregations: ["sum"],
  rowLabel: (row: RawRow) => ({
    label: (row.campaign as string) || "Meta spend",
  }),
  rowAmount: (row: RawRow) => Number(row.spend ?? 0),
  load: async ({ fetchStart, fetchEnd }: LoadCtx): Promise<RawRow[]> => {
    const adAccountId = process.env.META_AD_ACCOUNT_ID;
    if (!adAccountId) return [];
    try {
      const since = fetchStart.toISOString().slice(0, 10);
      // Meta's `until` is inclusive; our range end is exclusive, so step back a day.
      const until = new Date(fetchEnd.getTime() - 86_400_000).toISOString().slice(0, 10);
      const { meta } = await import("@/lib/meta/client");
      const res = await meta.get<{ data: MetaInsightRow[] }>(
        `/${adAccountId}/insights`,
        {
          fields: "spend,campaign_name",
          // Break down per campaign so the `campaign` filter is meaningful;
          // without this level the API returns one account-wide row per day.
          level: "campaign",
          time_range: JSON.stringify({ since, until }),
          time_increment: "1",
          // Wide window can exceed the default 25/page — ask for them all so the
          // most recent days aren't silently dropped onto an unfetched next page.
          limit: "500",
        },
      );
      return (res.data ?? [])
        .filter((d) => d.date_start)
        .map((d) => ({
          campaign: d.campaign_name ?? "",
          spend: parseFloat(d.spend ?? "0"), // dollars
          date: new Date(d.date_start + "T00:00:00.000Z").getTime(), // epoch ms
        }));
    } catch (e) {
      console.error("[kpi/datasets/meta.spend] fetch failed:", e);
      return [];
    }
  },
};

/**
 * Meta (Facebook/Instagram) lead-form dataset.
 *
 * Each row is one campaign's lead-form submissions for one day, carrying a
 * `leads` count field. The total for a period is `aggregation: { op: "sum",
 * field: "leads" }` (use `count` only if you expand to one row per lead — we
 * keep one row per campaign-day, so SUM is the right aggregation).
 *
 * Lead counts come from the same /insights call as spend, parsed from the
 * `actions` array with no double-counting (see leadsFromActions in meta-series).
 */
interface MetaLeadsRow extends MetaInsightRow {
  actions?: MetaAction[];
}

export const metaLeads: DatasetDef = {
  key: "meta.leads",
  integration: "meta",
  label: "Meta lead forms",
  description:
    "How many lead-form submissions you got from Facebook/Instagram ads in the period (read straight from Meta).",
  fields: [
    { key: "leads", label: "Lead-form submissions", type: "count", operators: ["gt", "lt", "between"] },
    { key: "campaign", label: "Ad campaign", type: "string", operators: ["contains", "eq", "is_set", "is_not_set"] },
  ],
  dateFields: [{ key: "date", label: "Date" }],
  aggregations: ["sum", "count"],
  rowLabel: (row: RawRow) => ({
    label: (row.campaign as string) || "Meta leads",
    sublabel: `${Number(row.leads ?? 0)} lead${Number(row.leads ?? 0) === 1 ? "" : "s"}`,
  }),
  load: async ({ fetchStart, fetchEnd }: LoadCtx): Promise<RawRow[]> => {
    const adAccountId = process.env.META_AD_ACCOUNT_ID;
    if (!adAccountId) return [];
    try {
      const since = fetchStart.toISOString().slice(0, 10);
      // Meta's `until` is inclusive; our range end is exclusive, so step back a day.
      const until = new Date(fetchEnd.getTime() - 86_400_000).toISOString().slice(0, 10);
      const { meta } = await import("@/lib/meta/client");
      const res = await meta.get<{ data: MetaLeadsRow[] }>(
        `/${adAccountId}/insights`,
        {
          // `actions` carries the lead counts; `campaign_name` powers the filter.
          fields: "actions,campaign_name",
          // Per-campaign so the `campaign` filter is meaningful; without this level
          // the API returns one account-wide row per day.
          level: "campaign",
          time_range: JSON.stringify({ since, until }),
          time_increment: "1",
          // Wide window can exceed the default 25/page — ask for them all so the
          // most recent days aren't silently dropped onto an unfetched next page.
          limit: "500",
        },
      );
      return (res.data ?? [])
        .filter((d) => d.date_start)
        .map((d) => ({
          campaign: d.campaign_name ?? "",
          leads: leadsFromActions(d.actions), // one campaign-day's lead-form submissions
          date: new Date(d.date_start + "T00:00:00.000Z").getTime(), // epoch ms
        }))
        // Drop campaign-days with zero leads so drill-down rows are meaningful.
        .filter((row) => (row.leads as number) > 0);
    } catch (e) {
      console.error("[kpi/datasets/meta.leads] fetch failed:", e);
      return [];
    }
  },
};
