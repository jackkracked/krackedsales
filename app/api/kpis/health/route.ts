import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { kpiOverrides } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { format, startOfMonth, endOfMonth, addDays } from "date-fns";
import { KPI_DEFINITIONS } from "@/lib/kpi-health/definitions";
import { getHealthSummary } from "@/lib/kpi-health/check";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const currentPeriod = format(new Date(), "yyyy-MM");
  const cookie = req.headers.get("cookie") ?? "";
  const origin = new URL(req.url).origin;

  // Fetch health log, overrides, and live KPI values in parallel
  const now = new Date();
  const bizStart = format(startOfMonth(now), "yyyy-MM-dd");
  const bizEnd = format(addDays(endOfMonth(now), 1), "yyyy-MM-dd");

  const [healthMap, overrideRows, liveAdminKpis, liveBizData] = await Promise.all([
    getHealthSummary(),
    db()
      .select({
        metricKey: kpiOverrides.metricKey,
        value: kpiOverrides.value,
        note: kpiOverrides.note,
      })
      .from(kpiOverrides)
      .where(eq(kpiOverrides.period, currentPeriod)),
    // Fetch live admin KPI values (month period)
    fetch(`${origin}/api/dashboard/kpis?period=month&role=admin&keys[]=cash&keys[]=leads&keys[]=calls_admin&keys[]=proposals_sent&keys[]=roas&keys[]=ad_spend&keys[]=pipeline_value_admin&keys[]=software_spend`, {
      cache: "no-store",
      headers: { Cookie: cookie },
    }).then((r) => r.ok ? r.json() : { metrics: {} }).catch(() => ({ metrics: {} })),
    // Fetch live Stripe data
    fetch(`${origin}/api/kpis/business?start=${bizStart}&end=${bizEnd}`, {
      cache: "no-store",
      headers: { Cookie: cookie },
    }).then((r) => r.ok ? r.json() as Promise<Record<string, unknown>> : ({} as Record<string, unknown>)).catch(() => ({} as Record<string, unknown>)),
  ]);

  // Build live values map from both sources
  const liveValues = new Map<string, number>();
  const adminMetrics = liveAdminKpis?.metrics ?? {};
  for (const [key, result] of Object.entries(adminMetrics)) {
    liveValues.set(key, (result as { value: number }).value ?? 0);
  }
  // Add Stripe-specific values
  if (liveBizData.mrr !== undefined) liveValues.set("mrr", Number(liveBizData.mrr) || 0);
  if (liveBizData.cashCollected !== undefined && !liveValues.has("cash")) {
    liveValues.set("cash", Number(liveBizData.cashCollected) || 0);
  }
  if (liveBizData.adSpend !== undefined) liveValues.set("ad_spend", Number(liveBizData.adSpend) || 0);

  const overrideMap = new Map<string, { value: number; note: string | null }>();
  for (const row of overrideRows) {
    overrideMap.set(row.metricKey, { value: row.value, note: row.note });
  }

  const metrics = Object.values(KPI_DEFINITIONS).map((def) => {
    const health = healthMap.get(def.key);
    const override = overrideMap.get(def.key) ?? null;
    const liveValue = liveValues.get(def.key);

    // Use live value if available, fall back to health log, then null
    const value = liveValue !== undefined ? liveValue : (health?.value ?? null);

    // Determine status
    let status = health?.status ?? "unknown";
    if (override) status = "override";
    else if (health?.status === "error") status = "error";
    else if (liveValue !== undefined) status = "healthy";

    return {
      key: def.key,
      name: def.name,
      whatItMeasures: def.whatItMeasures,
      whereItComesFrom: def.whereItComesFrom,
      sourceSystem: def.sourceSystem,
      sourceUrl: def.sourceUrl,
      zeroMeans: def.zeroMeans,
      unit: def.unit,
      value,
      status,
      lastCheckedAt: health?.fetchedAt?.toISOString() ?? new Date().toISOString(),
      error: health?.error ?? null,
      responseTimeMs: health?.responseTimeMs ?? null,
      override,
    };
  });

  return NextResponse.json({ metrics });
}
