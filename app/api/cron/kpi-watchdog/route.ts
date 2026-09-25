import { NextRequest, NextResponse } from "next/server";
import { runStripeWatchdog } from "@/lib/stripe/watchdog";
import { postToSalesChannel } from "@/lib/proposals/slack-notify";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * KPI watchdog: proves the local Stripe mirror still equals live Stripe, to the cent. Runs on a
 * schedule; silent when green, and on ANY drift it alerts Slack so a stale/broken mirror can
 * never quietly feed wrong money numbers. GET + CRON_SECRET (Vercel Cron fires GET).
 */
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const report = await runStripeWatchdog();
    if (!report.ok) {
      const lines = report.checks
        .filter((c) => !c.match)
        .map((c) => `• ${c.name}: mirror ${c.mirror} vs live ${c.live} (off by ${c.diff})`)
        .join("\n");
      await postToSalesChannel(
        `⚠️ *KPI WATCHDOG — Stripe mirror drift detected*\nThe local Stripe copy no longer matches Stripe. KPIs may be wrong until reconciled.\n${lines}\n\nRun the Stripe reconcile (\`/api/cron/sync-stripe\`) or set \`?stripeSource=live\` to fall back.`,
      ).catch(() => {});
    }
    return NextResponse.json(report);
  } catch (e) {
    console.error("[cron/kpi-watchdog] failed:", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
