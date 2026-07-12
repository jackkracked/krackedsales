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

  // The whole-company P&L ("did we keep money?") uses the LAST COMPLETE calendar month,
  // never the month-in-progress: a partial month of revenue against a full month of overhead
  // reads as a false catastrophic loss (e.g. 12 days of income vs a whole month of salaries).
  // Full-month revenue vs full-month overhead is the only apples-to-apples "can we afford to run".
  const pnlStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const pnlEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); // exclusive
  const pnlLabel = MONTH_NAMES[pnlStart.getUTCMonth()];

  const fetchStart = rollStart < pnlStart ? rollStart : pnlStart;

  const a = await loadAssumptions();

  const [metaR, stripeR, rollClientsR, pnlClientsR] = await Promise.allSettled([
    loadMetaAdSpend(fetchStart, now),
    loadStripeKpiSeries(fetchStart, now),
    countNewClients(rollStart, now),
    countNewClients(pnlStart, pnlEnd),
  ]);

  const meta = metaR.status === "fulfilled" ? metaR.value : null;
  const stripe = stripeR.status === "fulfilled" ? stripeR.value : null;
  const rollClients = rollClientsR.status === "fulfilled" ? rollClientsR.value : 0;
  const pnlClients = pnlClientsR.status === "fulfilled" ? pnlClientsR.value : 0;

  const rollAdSpend = meta?.spendInRange(rollStart, now) ?? 0;
  const pnlAdSpend = meta?.spendInRange(pnlStart, pnlEnd) ?? 0;
  const pnlRevenue = stripe?.cashInRange(pnlStart, pnlEnd) ?? 0;

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
      label: pnlLabel, // the last COMPLETE calendar month this P&L covers
      revenue: pnlRevenue,
      revenueAvailable: !!stripe?.hasData,
      adSpend: pnlAdSpend,
      adSpendAvailable: !!meta?.hasData,
      newClients: pnlClients,
      // Flagged estimates — edit to real actuals in the UI (see file header).
      commissionEstimate: pnlRevenue * a.commissionPct,
      processingEstimate: pnlRevenue * a.processingPct,
    },
  });
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
