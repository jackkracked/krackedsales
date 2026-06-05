/**
 * Daily snapshots for point-in-time KPIs.
 *
 * Some metrics (open pipeline value) are levels with no history in their source
 * system — GHL only ever reports "open right now". To draw a trend we record the
 * value once a day and read it back as a step/as-of series.
 *
 * The table self-creates on first use (CREATE TABLE IF NOT EXISTS), so no manual
 * migration is required for deploy. Reads fail soft (return null) so a missing
 * table or empty history never breaks the dashboard.
 */
import { neon } from "@neondatabase/serverless";
import type { Bucket } from "./buckets";

function sqlClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

let ensured = false;
async function ensureTable() {
  if (ensured) return;
  const sql = sqlClient();
  await sql`CREATE TABLE IF NOT EXISTS metric_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_key text NOT NULL,
    captured_date date NOT NULL,
    value double precision NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (metric_key, captured_date)
  )`;
  ensured = true;
}

/** Record (or overwrite) today's value for a metric. Idempotent per day. */
export async function recordSnapshot(metricKey: string, value: number, date: Date = new Date()): Promise<void> {
  await ensureTable();
  const sql = sqlClient();
  const day = date.toISOString().slice(0, 10);
  await sql`INSERT INTO metric_snapshots (metric_key, captured_date, value)
    VALUES (${metricKey}, ${day}, ${value})
    ON CONFLICT (metric_key, captured_date)
    DO UPDATE SET value = EXCLUDED.value, created_at = now()`;
}

/**
 * Build a trend series for a snapshot metric: for each bucket, the most recent
 * recorded value at or before the bucket's end (carry-forward / as-of). Returns
 * null when there is no history yet, so the caller can fall back gracefully.
 */
export async function readSnapshotSeries(metricKey: string, buckets: Bucket[]): Promise<number[] | null> {
  if (!buckets.length) return null;
  try {
    await ensureTable();
    const sql = sqlClient();
    const rows = (await sql`
      SELECT captured_date::text AS captured_date, value
      FROM metric_snapshots
      WHERE metric_key = ${metricKey}
      ORDER BY captured_date ASC
    `) as { captured_date: string; value: number }[];
    if (!rows.length) return null;

    const points = rows.map((r) => ({ t: new Date(r.captured_date + "T23:59:59.999Z").getTime(), value: r.value }));
    let idx = 0;
    let last = 0;
    let sawAny = false;
    const series: number[] = [];
    for (const b of buckets) {
      const cap = Math.min(b.end.getTime(), Date.now());
      while (idx < points.length && points[idx].t <= cap) {
        last = points[idx].value;
        sawAny = true;
        idx++;
      }
      series.push(last);
    }
    return sawAny ? series : null;
  } catch (e) {
    console.error("[kpi/snapshots] read failed:", e);
    return null;
  }
}
