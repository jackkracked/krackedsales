import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { calls } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/dialer/voice/recording
 * Twilio recording status callback (fired on "completed"). Attaches the recording
 * URL + duration to the matching call row.
 *
 * Resilience: best-effort DB update wrapped in try/catch; always returns 204 so
 * Twilio does not retry.
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const CallSid = form.get("CallSid");
    const RecordingUrl = form.get("RecordingUrl");
    const RecordingDuration = form.get("RecordingDuration");

    if (CallSid) {
      const recordingUrl = RecordingUrl ? `${String(RecordingUrl)}.mp3` : null;
      const durationSeconds = Number(RecordingDuration) || null;

      await db()
        .update(calls)
        .set({
          recordingUrl,
          recordingAvailable: true,
          durationSeconds,
        })
        .where(eq(calls.twilioCallSid, String(CallSid)));

      // TODO: enqueue transcription via lib/ai/call-insights
    }
  } catch (err) {
    console.error("[dialer/recording] handler error:", err);
  }

  return new NextResponse(null, { status: 204 });
}
