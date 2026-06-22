import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import type { GHLOpportunity } from "@/lib/ghl/types";
import { loadStripeKpiSeries } from "@/lib/kpi/stripe-series";
import { recordSnapshot } from "@/lib/kpi/snapshots";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Vercel Cron triggers via GET (CRON_SECRET auto-attached). Delegate so the daily job runs.
export async function GET(req: NextRequest) {
  return POST(req);
}

/**
 * POST /api/cron/snapshots
 *
 * Records once-a-day values for point-in-time KPIs that have no history in their
 * source system, so their trend lines can accumulate over time:
 *   - pipeline_value_admin : total $ of all open GHL opportunities
 *   - mrr                  : current MRR from Stripe
 *
 * Called by Vercel Cron daily. Protected by CRON_SECRET (this path is public in
 * proxy.ts precisely so the cron runner can reach it).
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const recorded: Record<string, number> = {};

  // ── Open pipeline value (GHL) ──────────────────────────────────────────────
  try {
    const opps: GHLOpportunity[] = [];
    const base = `/opportunities/search?location_id=${locationId()}`;
    const first = await ghl.get<{ opportunities: GHLOpportunity[]; meta?: { total?: number } }>(`${base}&limit=100&page=1`);
    opps.push(...(first.opportunities ?? []));
    const total = first.meta?.total ?? first.opportunities?.length ?? 0;
    const pages = Math.ceil(total / 100);
    if (pages > 1) {
      const rest = await Promise.all(
        Array.from({ length: pages - 1 }, (_, i) =>
          ghl.get<{ opportunities: GHLOpportunity[] }>(`${base}&limit=100&page=${i + 2}`),
        ),
      );
      for (const p of rest) opps.push(...(p.opportunities ?? []));
    }
    const pipelineValue = opps
      .filter((o) => o.status === "open")
      .reduce((sum, o) => sum + (o.monetaryValue ?? 0), 0);
    await recordSnapshot("pipeline_value_admin", pipelineValue);
    recorded.pipeline_value_admin = pipelineValue;
  } catch (e) {
    console.error("[cron/snapshots] pipeline snapshot failed:", e);
  }

  // ── Current MRR (Stripe) ───────────────────────────────────────────────────
  try {
    const now = new Date();
    const stripeSeries = await loadStripeKpiSeries(now, now);
    if (stripeSeries.hasData) {
      await recordSnapshot("mrr", stripeSeries.currentMrr);
      recorded.mrr = stripeSeries.currentMrr;
    }
  } catch (e) {
    console.error("[cron/snapshots] mrr snapshot failed:", e);
  }

  return NextResponse.json({ ok: true, recorded });
}
