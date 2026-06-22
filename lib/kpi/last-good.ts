/**
 * "Last good value" cache for KPI metrics.
 *
 * When a data source (Stripe / Meta / …) fails on a refresh, the metric would
 * otherwise compute to $0 and the card would flash to zero. Instead we serve the
 * last successfully-computed value for that exact (scope, range, metric) and flag
 * it as stale. Genuine zeros (source succeeded, value really is 0) are cached and
 * served as 0 — we only fall back when the source actually failed.
 *
 * All reads/writes fail soft so the dashboard never breaks on a cache miss.
 */
import { neon } from "@neondatabase/serverless";

function sqlClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

export interface LastGood {
  value: number;
  prev: number;
  series: number[] | null;
}

export async function readLastGood(
  scopeKey: string,
  rangeKey: string,
  keys: string[],
): Promise<Map<string, LastGood>> {
  const out = new Map<string, LastGood>();
  if (!keys.length) return out;
  try {
    const sql = sqlClient();
    const rows = (await sql`
      SELECT metric_key, value, prev, series
      FROM kpi_last_values
      WHERE scope_key = ${scopeKey} AND range_key = ${rangeKey} AND metric_key = ANY(${keys})
    `) as Array<{ metric_key: string; value: number | null; prev: number | null; series: number[] | null }>;
    for (const r of rows) {
      out.set(r.metric_key, { value: r.value ?? 0, prev: r.prev ?? 0, series: r.series });
    }
  } catch (e) {
    console.error("[kpi/last-good] read failed:", e);
  }
  return out;
}

export async function writeLastGood(
  scopeKey: string,
  rangeKey: string,
  entries: Array<{ key: string; value: number; prev: number; series?: number[] | null }>,
): Promise<void> {
  if (!entries.length) return;
  try {
    const sql = sqlClient();
    await Promise.all(
      entries.map((e) => sql`
        INSERT INTO kpi_last_values (scope_key, range_key, metric_key, value, prev, series, captured_at)
        VALUES (${scopeKey}, ${rangeKey}, ${e.key}, ${e.value}, ${e.prev}, ${JSON.stringify(e.series ?? null)}::jsonb, now())
        ON CONFLICT (scope_key, range_key, metric_key) DO UPDATE
          SET value = EXCLUDED.value, prev = EXCLUDED.prev, series = EXCLUDED.series, captured_at = EXCLUDED.captured_at
      `),
    );
  } catch (e) {
    console.error("[kpi/last-good] write failed:", e);
  }
}
