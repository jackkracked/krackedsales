/**
 * GET /api/cron/followup-analyse
 *
 * Nightly cron — pre-generates AI follow-up recommendations for all active contacts.
 * Runs at 8am UTC so recommendations are ready when you open the page.
 *
 * Protected by CRON_SECRET (Vercel sets Authorization: Bearer <secret> automatically).
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Delegate to the analyse endpoint
  const baseUrl = process.env.NEXTAUTH_URL ?? process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  const start = Date.now();

  try {
    const res = await fetch(`${baseUrl}/api/follow-ups/analyse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
      },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[cron/followup-analyse] analyse endpoint returned ${res.status}:`, text);
      return NextResponse.json(
        { cron: "followup-analyse", error: `upstream ${res.status}`, durationMs: Date.now() - start },
        { status: 500 }
      );
    }

    const data = await res.json();
    const durationMs = Date.now() - start;
    console.log(`[cron/followup-analyse] Done in ${durationMs}ms:`, data);

    return NextResponse.json({ cron: "followup-analyse", durationMs, ...data });
  } catch (err) {
    const durationMs = Date.now() - start;
    console.error(`[cron/followup-analyse] Failed after ${durationMs}ms:`, err);
    return NextResponse.json(
      { cron: "followup-analyse", error: "unexpected failure", durationMs },
      { status: 500 }
    );
  }
}
