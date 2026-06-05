/**
 * Meta (Facebook/Instagram) ad-spend series.
 *
 * The shared /api/kpis/metrics endpoint asks Meta for a single spend total over a
 * range. For a trend line we ask for a daily breakdown (`time_increment=1`) and
 * fold the daily spend into whatever buckets the caller wants.
 */
import type { Bucket } from "./buckets";
import { bucketSum } from "./buckets";

interface DailySpend { date: Date; spend: number }

export interface MetaAdSpend {
  hasData: boolean;
  /** Total spend (dollars) over [start, end). */
  spendInRange: (start: Date, end: Date) => number;
  /** Spend per bucket, in dollars. */
  spendByBuckets: (buckets: Bucket[]) => number[];
}

const EMPTY: MetaAdSpend = {
  hasData: false,
  spendInRange: () => 0,
  spendByBuckets: (b) => b.map(() => 0),
};

/**
 * Load daily Meta spend once across the widest window the caller needs
 * (selected range + comparison period).
 */
export async function loadMetaAdSpend(fetchStart: Date, fetchEnd: Date): Promise<MetaAdSpend> {
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  if (!adAccountId) return EMPTY;

  let daily: DailySpend[] = [];
  try {
    const since = fetchStart.toISOString().slice(0, 10);
    // Meta's `until` is inclusive; our range end is exclusive, so step back one day.
    const until = new Date(fetchEnd.getTime() - 86_400_000).toISOString().slice(0, 10);
    const { meta } = await import("@/lib/meta/client");
    const res = await meta.get<{ data: Array<{ spend?: string; date_start?: string }> }>(
      `/${adAccountId}/insights`,
      {
        fields: "spend",
        time_range: JSON.stringify({ since, until }),
        time_increment: "1",
      },
    );
    daily = (res.data ?? [])
      .filter((d) => d.date_start)
      .map((d) => ({ date: new Date(d.date_start + "T00:00:00.000Z"), spend: parseFloat(d.spend ?? "0") }));
  } catch (e) {
    console.error("[kpi/meta-series] Meta insights failed:", e);
    return EMPTY;
  }

  const spendInRange = (start: Date, end: Date): number =>
    daily.filter((d) => d.date >= start && d.date < end).reduce((sum, d) => sum + d.spend, 0);

  const spendByBuckets = (buckets: Bucket[]): number[] =>
    bucketSum(daily, (d) => d.date, (d) => d.spend, buckets);

  return { hasData: true, spendInRange, spendByBuckets };
}
