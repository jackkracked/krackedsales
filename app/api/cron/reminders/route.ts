import { NextRequest, NextResponse } from "next/server";
import { runReminders } from "@/lib/reminders/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily reminder pass. Sends any due proposal/invoice reminder emails, exactly once
 * each (the engine owns dedup + all safety guards). Vercel Cron calls this with
 * `Authorization: Bearer ${CRON_SECRET}`; invoice reminders only fire when their
 * template is enabled (they ship paused).
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runReminders();
    console.log("[cron/reminders]", JSON.stringify(summary));
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[cron/reminders] failed:", err);
    return NextResponse.json({ error: "Reminder run failed" }, { status: 500 });
  }
}
