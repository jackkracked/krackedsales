import { NextRequest, NextResponse } from "next/server";
import { attributeBookings } from "@/lib/booking/attribute";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/attribute-bookings
 *
 * Credits booked calls back to the tracked links that produced them. GET because Vercel crons
 * only ever issue GET.
 *
 * Authorization: Bearer <CRON_SECRET>.
 *
 * Always returns 200 on a completed run, including one that credited nothing: an empty result
 * is the normal state most of the day, and a non-200 would page for a job that worked fine.
 * A genuine failure is reported in the body and recorded against the job lock.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await attributeBookings();
  if (result.credited > 0 || result.status !== "ok") {
    console.log("[cron/attribute-bookings]", result);
  }
  return NextResponse.json(result);
}
