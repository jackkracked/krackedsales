import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { softwareCosts, costSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/kpi/computed-costs?since=ISO&until=ISO
 *
 * Returns the auto-calculated software cost and team fulfillment for the KPI page.
 * - softwareCost = sum of all active monthly software costs (period-independent)
 * - teamFulfillment = costPerEmail × completedDemos (fetched from the demos API)
 */
export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since") ?? "";
  const until = req.nextUrl.searchParams.get("until") ?? "";

  // Sum of active software subscriptions
  const items = await db()
    .select({ monthlyCost: softwareCosts.monthlyCost })
    .from(softwareCosts)
    .where(eq(softwareCosts.active, true));

  const softwareCostTotal = items.reduce((sum, r) => sum + r.monthlyCost, 0);

  // Cost per email setting
  const settingsRows = await db().select().from(costSettings).limit(1);
  const costPerEmail = settingsRows[0]?.costPerEmail ?? 0;

  // Completed demos for the period — reuse the existing demos count API
  let completedDemos = 0;
  if (since && until && costPerEmail > 0) {
    try {
      const origin = req.nextUrl.origin;
      const res = await fetch(
        `${origin}/api/ghl/demos/started?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`,
        { headers: { "x-internal-secret": process.env.CRON_SECRET ?? "" } }
      );
      if (res.ok) {
        const data = await res.json();
        completedDemos = data.count ?? 0;
      }
    } catch {
      // Non-fatal — team fulfillment stays 0
    }
  }

  const teamFulfillment = parseFloat((costPerEmail * completedDemos).toFixed(2));

  return NextResponse.json({ softwareCost: softwareCostTotal, teamFulfillment });
}
