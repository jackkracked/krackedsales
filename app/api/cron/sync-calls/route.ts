import { NextRequest, NextResponse } from "next/server";
import { runSync } from "@/app/api/calls/sync/route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/sync-calls
 *
 * Triggered by Vercel Cron on a schedule. Runs the same sync logic as the
 * manual POST /api/calls/sync endpoint.
 *
 * Authorization: Bearer <CRON_SECRET>
 */
export async function GET(req: NextRequest) {
  const authHeader  = req.headers.get("authorization");
  const cronSecret  = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const synced = await runSync();
    console.log("[cron/sync-calls] Sync complete:", synced);
    return NextResponse.json({ synced });
  } catch (err) {
    console.error("[cron/sync-calls] Sync failed:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
