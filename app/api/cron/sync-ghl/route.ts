import { NextRequest, NextResponse } from "next/server";
import { runSync } from "@/app/api/ghl/sync/route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily reconcile of the local GHL mirror (local_opportunities / contacts / pipelines /
 * conversations). Webhooks keep the mirror real-time between runs; this cron self-heals any
 * drift so pages can safely read from Postgres instead of scraping GHL live. Vercel Cron fires
 * GET; protected by CRON_SECRET (a POST-only sync route would silently never run on a GET cron).
 */
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const synced = await runSync();
    return NextResponse.json({ ok: true, synced });
  } catch (e) {
    console.error("[cron/sync-ghl] failed:", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
