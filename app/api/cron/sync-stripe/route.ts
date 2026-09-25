import { NextRequest, NextResponse } from "next/server";
import { syncStripe } from "@/lib/stripe/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Reconcile the local Stripe mirror (local_stripe_charges/invoices/subscriptions/refunds).
 * The Stripe webhook keeps it real-time between runs; this cron self-heals any drift so the
 * KPI engine can read from Postgres instead of Stripe live. Full idempotent sync. GET +
 * CRON_SECRET (Vercel Cron fires GET). `?since=<unixSeconds>` bounds charges/invoices/refunds.
 */
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const sinceParam = req.nextUrl.searchParams.get("since");
    const since = sinceParam ? parseInt(sinceParam, 10) : undefined;
    const synced = await syncStripe(Number.isFinite(since) ? since : undefined);
    return NextResponse.json({ ok: true, synced });
  } catch (e) {
    console.error("[cron/sync-stripe] failed:", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
