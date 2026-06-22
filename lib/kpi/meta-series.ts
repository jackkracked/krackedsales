/**
 * Meta (Facebook/Instagram) ad-spend + lead-form series.
 *
 * The shared /api/kpis/metrics endpoint asks Meta for a single spend total over a
 * range. For a trend line we ask for a daily breakdown (`time_increment=1`) and
 * fold the daily spend into whatever buckets the caller wants.
 *
 * The same Insights call also returns `actions`, from which we read the number of
 * lead-form submissions per day. See LEAD_ACTION_PRIORITY below for how we avoid
 * double-counting Meta's overlapping lead action types.
 */
import type { Bucket } from "./buckets";
import { bucketSum } from "./buckets";

interface DailyRow { date: Date; spend: number; leads: number; campaign: string }

/**
 * Meta reports several lead action types that OVERLAP for the same submissions:
 *   - `lead`                              → canonical aggregate lead count
 *   - `onsite_conversion.lead_grouped`    → on-platform (Instant Form) leads, grouped
 *   - `leadgen.other`                     → other on-platform lead events
 *   - `offsite_conversion.fb_pixel_lead`  → website-pixel "Lead" events
 *
 * Summing all of them double-counts (the grouped/other types aggregate the SAME
 * on-platform submissions `lead` already reports). To get one clean count of
 * lead-form submissions we take the FIRST action type present per day in this
 * priority order, rather than summing overlapping types.
 */
const LEAD_ACTION_PRIORITY = [
  "lead",
  "onsite_conversion.lead_grouped",
  "leadgen.other",
  "offsite_conversion.fb_pixel_lead",
] as const;

export interface MetaAction { action_type?: string; value?: string }

/** Pick a single, non-double-counted lead value from a day's `actions` array. */
export function leadsFromActions(actions: MetaAction[] | undefined): number {
  if (!actions || actions.length === 0) return 0;
  for (const type of LEAD_ACTION_PRIORITY) {
    const match = actions.find((a) => a.action_type === type);
    if (match) {
      const value = parseFloat(match.value ?? "0");
      return Number.isFinite(value) ? value : 0;
    }
  }
  return 0;
}

export interface MetaAdSpend {
  hasData: boolean;
  /** Total spend (dollars) over [start, end). */
  spendInRange: (start: Date, end: Date) => number;
  /** Spend per bucket, in dollars. */
  spendByBuckets: (buckets: Bucket[]) => number[];
  /** Total Meta lead-form submissions over [start, end). */
  leadsInRange: (start: Date, end: Date) => number;
  /** Lead-form submissions per bucket. */
  leadsByBuckets: (buckets: Bucket[]) => number[];
}

const EMPTY: MetaAdSpend = {
  hasData: false,
  spendInRange: () => 0,
  spendByBuckets: (b) => b.map(() => 0),
  leadsInRange: () => 0,
  leadsByBuckets: (b) => b.map(() => 0),
};

/**
 * Load daily Meta spend + lead-form counts once across the widest window the
 * caller needs (selected range + comparison period).
 *
 * @param campaign Optional case-insensitive substring. When set, only campaigns
 *   whose name contains it are counted (lets one offer's campaign be isolated).
 *   Passing it switches the fetch to campaign-level so names are available.
 */
export async function loadMetaAdSpend(
  fetchStart: Date,
  fetchEnd: Date,
  campaign?: string,
): Promise<MetaAdSpend> {
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  if (!adAccountId) return EMPTY;

  const campaignFilter = campaign?.trim().toUpperCase() || null;

  let daily: DailyRow[] = [];
  try {
    const since = fetchStart.toISOString().slice(0, 10);
    // Meta's `until` is inclusive; our range end is exclusive, so step back one day.
    const until = new Date(fetchEnd.getTime() - 86_400_000).toISOString().slice(0, 10);
    const { meta } = await import("@/lib/meta/client");
    const res = await meta.get<{
      data: Array<{
        spend?: string;
        date_start?: string;
        campaign_name?: string;
        actions?: MetaAction[];
      }>;
    }>(
      `/${adAccountId}/insights`,
      {
        // `actions` carries the lead counts; `campaign_name` lets us filter by offer.
        fields: "spend,actions,campaign_name",
        // Campaign-level so the optional campaign filter is meaningful. Without a
        // filter this still aggregates fine (we fold all campaigns per day).
        level: "campaign",
        time_range: JSON.stringify({ since, until }),
        time_increment: "1",
        // Meta paginates daily rows at 25/page by default — a wider window (e.g.
        // MTD's fetch range) would drop the most recent days onto an unfetched
        // next page, silently zeroing current spend. Ask for them all at once.
        limit: "500",
      },
    );
    daily = (res.data ?? [])
      .filter((d) => d.date_start)
      .filter((d) =>
        campaignFilter ? (d.campaign_name ?? "").toUpperCase().includes(campaignFilter) : true,
      )
      .map((d) => ({
        date: new Date(d.date_start + "T00:00:00.000Z"),
        spend: parseFloat(d.spend ?? "0"),
        leads: leadsFromActions(d.actions),
        campaign: d.campaign_name ?? "",
      }));
  } catch (e) {
    console.error("[kpi/meta-series] Meta insights failed:", e);
    return EMPTY;
  }

  const spendInRange = (start: Date, end: Date): number =>
    daily.filter((d) => d.date >= start && d.date < end).reduce((sum, d) => sum + d.spend, 0);

  const spendByBuckets = (buckets: Bucket[]): number[] =>
    bucketSum(daily, (d) => d.date, (d) => d.spend, buckets);

  const leadsInRange = (start: Date, end: Date): number =>
    daily.filter((d) => d.date >= start && d.date < end).reduce((sum, d) => sum + d.leads, 0);

  const leadsByBuckets = (buckets: Bucket[]): number[] =>
    bucketSum(daily, (d) => d.date, (d) => d.leads, buckets);

  return { hasData: true, spendInRange, spendByBuckets, leadsInRange, leadsByBuckets };
}
