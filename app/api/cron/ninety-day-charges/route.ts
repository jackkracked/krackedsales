import { NextRequest, NextResponse } from "next/server";
import { hasStripe, stripe } from "@/lib/stripe/client";
import { chargeDueNinetyDaySplits } from "@/lib/proposals/ninety-day-fulfillment";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily cron: auto-charge every due 90-day "spread" ledger row (months 2 & 3, and any flexible
 * first-month splits) off-session on the saved card. Each row is reconciled against Stripe before
 * charging and idempotency-keyed, so it can never double-charge. Declines/SCA flag the proposal's
 * billingIssue and alert Slack. Protected by CRON_SECRET (this /api/cron path is public so the
 * runner can reach it; the route validates the secret). GET handler (Vercel Cron triggers via GET).
 */
async function run(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasStripe()) return NextResponse.json({ ok: true, skipped: "no stripe configured" });

  try {
    const summary = await chargeDueNinetyDaySplits(stripe());
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    console.error("[cron/ninety-day-charges] failed:", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return run(req);
}
