import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { softwareCosts, costSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/kpi/computed-costs?since=ISO&until=ISO&auditsCount=N
 *
 * Returns auto-calculated costs for the KPI page:
 * - softwareCost    = sum of active monthly software subscriptions
 * - teamFulfillment = (costPerEmail × completedEmailDemos) + (costPerAudit × auditsCount)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const since = searchParams.get("since") ?? "";
  const until = searchParams.get("until") ?? "";
  const auditsCount = parseInt(searchParams.get("auditsCount") ?? "0", 10) || 0;

  // Sum of active software subscriptions
  const items = await db()
    .select({ monthlyCost: softwareCosts.monthlyCost })
    .from(softwareCosts)
    .where(eq(softwareCosts.active, true));

  const softwareCostTotal = items.reduce((sum, r) => sum + r.monthlyCost, 0);

  // Cost settings
  const settingsRows = await db().select().from(costSettings).limit(1);
  const costPerEmail = settingsRows[0]?.costPerEmail ?? 0;
  const costPerAudit = settingsRows[0]?.costPerAudit ?? 0;

  // Completed email demos for the period
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
      // Non-fatal — email fulfillment stays 0
    }
  }

  const emailFulfillment = costPerEmail * completedDemos;
  const auditFulfillment = costPerAudit * auditsCount;
  const teamFulfillment = parseFloat((emailFulfillment + auditFulfillment).toFixed(2));

  return NextResponse.json({ softwareCost: softwareCostTotal, teamFulfillment });
}
