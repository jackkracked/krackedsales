import { db } from "@/lib/db";
import { kpiHealthLog } from "@/lib/db/schema";
import { KPI_DEFINITIONS } from "@/lib/kpi-health/definitions";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckResult {
  key: string;
  value: number;
  status: "healthy" | "degraded" | "error";
  error: string | null;
  responseTimeMs: number;
  sourceSystem: string;
}

export interface HealthEntry {
  value: number | null;
  status: string;
  error: string | null;
  fetchedAt: Date;
  responseTimeMs: number | null;
}

// ---------------------------------------------------------------------------
// checkMetric — fresh fetch for one KPI and log the result
// ---------------------------------------------------------------------------

export async function checkMetric(
  key: string,
  period: { start: Date; end: Date },
  cookie: string,
  origin: string,
): Promise<CheckResult> {
  const def = KPI_DEFINITIONS[key];
  const sourceSystem = def?.sourceSystem ?? "unknown";

  const startTime = performance.now();
  let value = 0;
  let status: "healthy" | "degraded" | "error" = "healthy";
  let error: string | null = null;

  try {
    const url = new URL("/api/dashboard/kpis", origin);
    url.searchParams.set("period", "month");
    url.searchParams.append("keys[]", key);
    url.searchParams.set("role", "admin");

    const res = await fetch(url.toString(), {
      headers: { cookie },
      cache: "no-store",
    });

    const elapsed = performance.now() - startTime;

    if (!res.ok) {
      status = "error";
      error = `HTTP ${res.status}: ${res.statusText}`;
    } else {
      const json = await res.json();
      // The KPI route returns { kpis: { [key]: { current, ... } } }
      const metric = json?.kpis?.[key];
      if (metric !== undefined && metric !== null) {
        value = typeof metric.current === "number" ? metric.current : Number(metric.current ?? 0);
      }

      // Degraded if the upstream responded slowly (>5 s)
      if (elapsed > 5000) {
        status = "degraded";
      }
    }

    const responseTimeMs = Math.round(performance.now() - startTime);

    // Log to kpiHealthLog
    await db().insert(kpiHealthLog).values({
      metricKey: key,
      value,
      sourceStatus: status,
      errorMessage: error,
      responseTimeMs,
      sourceSystem,
    });

    return { key, value, status, error, responseTimeMs, sourceSystem };
  } catch (err) {
    const responseTimeMs = Math.round(performance.now() - startTime);
    error = err instanceof Error ? err.message : String(err);
    status = "error";

    // Still log the failure
    await db().insert(kpiHealthLog).values({
      metricKey: key,
      value: null,
      sourceStatus: status,
      errorMessage: error,
      responseTimeMs,
      sourceSystem,
    });

    return { key, value: 0, status, error, responseTimeMs, sourceSystem };
  }
}

// ---------------------------------------------------------------------------
// getHealthSummary — most recent entry per metric key
// ---------------------------------------------------------------------------

export async function getHealthSummary(): Promise<Map<string, HealthEntry>> {
  const client = db();

  // Neon HTTP driver doesn't support DISTINCT ON, so we fetch recent rows
  // ordered by fetched_at DESC and deduplicate in JS via a Map (first-write wins).
  const rows = await client
    .select({
      metricKey: kpiHealthLog.metricKey,
      value: kpiHealthLog.value,
      sourceStatus: kpiHealthLog.sourceStatus,
      errorMessage: kpiHealthLog.errorMessage,
      fetchedAt: kpiHealthLog.fetchedAt,
      responseTimeMs: kpiHealthLog.responseTimeMs,
    })
    .from(kpiHealthLog)
    .orderBy(sql`${kpiHealthLog.fetchedAt} desc`)
    .limit(500);

  const map = new Map<string, HealthEntry>();

  for (const row of rows) {
    if (map.has(row.metricKey)) continue; // already have latest for this key
    map.set(row.metricKey, {
      value: row.value,
      status: row.sourceStatus,
      error: row.errorMessage,
      fetchedAt: row.fetchedAt,
      responseTimeMs: row.responseTimeMs,
    });
  }

  return map;
}
