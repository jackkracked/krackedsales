/**
 * Live figures for the Money page: realized CAC (rolling 30/60/90) + the current-month
 * company-P&L pieces (ad spend, revenue, new clients). Admin-only.
 *
 * The per-package MODEL, planner and bridges are computed CLIENT-SIDE from the saved
 * assumptions (instant, no live data) — this endpoint only supplies the numbers that must
 * come from real integrations, each with an `available` flag so a down integration renders
 * "not connected" instead of a confident wrong number (Principal-Engineer H4).
 *
 * Commission & processing are returned as flagged ESTIMATES (% of cash) — recurring revenue
 * doesn't re-pay commission monthly (CFO C1), so these must be edited to real actuals in the
 * UI; they are never presented as measured truth.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { loadMetaAdSpend } from "@/lib/kpi/meta-series";
import { loadStripeKpiSeries } from "@/lib/kpi/stripe-series";
import { countNewClients } from "@/lib/unit-economics/clients";
import { loadAssumptions } from "@/lib/unit-economics/persist";
import { realizedCac } from "@/lib/unit-economics/model";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (user?.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const w = Number(req.nextUrl.searchParams.get("window"));
  const windowDays = [30, 60, 90].includes(w) ? w : 30;

  const now = new Date();
  const rollStart = new Date(now.getTime() - windowDays * 86_400_000);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const fetchStart = rollStart < monthStart ? rollStart : monthStart;
  const fetchEnd = now > monthEnd ? now : monthEnd;

  const a = await loadAssumptions();

  const [metaR, stripeR, rollClientsR, monthClientsR] = await Promise.allSettled([
    loadMetaAdSpend(fetchStart, fetchEnd),
    loadStripeKpiSeries(fetchStart, fetchEnd),
    countNewClients(rollStart, now),
    countNewClients(monthStart, monthEnd),
  ]);

  const meta = metaR.status === "fulfilled" ? metaR.value : null;
  const stripe = stripeR.status === "fulfilled" ? stripeR.value : null;
  const rollClients = rollClientsR.status === "fulfilled" ? rollClientsR.value : 0;
  const monthClients = monthClientsR.status === "fulfilled" ? monthClientsR.value : 0;

  const rollAdSpend = meta?.spendInRange(rollStart, now) ?? 0;
  const monthAdSpend = meta?.spendInRange(monthStart, monthEnd) ?? 0;
  const monthRevenue = stripe?.cashInRange(monthStart, monthEnd) ?? 0;

  return NextResponse.json({
    window: windowDays,
    generatedAt: now.toISOString(),
    realized: {
      cac: realizedCac(rollAdSpend, rollClients),
      adSpend: rollAdSpend,
      newClients: rollClients,
      adSpendAvailable: !!meta?.hasData,
      clientsAvailable: rollClientsR.status === "fulfilled",
    },
    month: {
      revenue: monthRevenue,
      revenueAvailable: !!stripe?.hasData,
      adSpend: monthAdSpend,
      adSpendAvailable: !!meta?.hasData,
      newClients: monthClients,
      // Flagged estimates — edit to real actuals in the UI (see file header).
      commissionEstimate: monthRevenue * a.commissionPct,
      processingEstimate: monthRevenue * a.processingPct,
    },
  });
}
