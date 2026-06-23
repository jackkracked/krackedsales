import { NextRequest, NextResponse } from "next/server";
import { syncFathomForAllUsers } from "@/lib/fathom/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/sync-fathom
 *
 * Triggered by Vercel Cron every 2 minutes. Syncs recent Fathom meetings
 * for all users that have a Fathom API key configured.
 *
 * Authorization: Bearer <CRON_SECRET>
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // ?days=N widens the look-back window for a one-time backfill (default 1 day).
    const daysParam = Number(req.nextUrl.searchParams.get("days"));
    const sinceDays = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 365) : 1;
    const synced = await syncFathomForAllUsers(sinceDays);
    console.log(`[cron/sync-fathom] Sync complete (sinceDays=${sinceDays}):`, synced);
    return NextResponse.json({ synced, sinceDays });
  } catch (err) {
    console.error("[cron/sync-fathom] Sync failed:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
