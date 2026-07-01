import { after, NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { put } from "@vercel/blob";
import { db } from "@/lib/db";
import { calls } from "@/lib/db/schema";
import { getDialerConfig } from "@/lib/dialer/twilio";
import { transcribeAudio, diarizedToStored, generateAndStoreInsights } from "@/lib/ai/call-insights";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/dialer/voice/recording
 * Twilio recording status callback (fired on "completed"). Attaches the recording
 * to the call row, then (after the 204) downloads it to Blob, transcribes it with
 * Gemini, and generates the same AI insights the Fathom calls get.
 *
 * Resilience: the DB write + response are fast; all heavy work runs in after().
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const CallSid = form.get("CallSid");
    const RecordingUrl = form.get("RecordingUrl");
    const RecordingDuration = form.get("RecordingDuration");

    if (CallSid) {
      const sid = String(CallSid);
      const twilioMp3 = RecordingUrl ? `${String(RecordingUrl)}.mp3` : null;
      const durationSeconds = Number(RecordingDuration) || null;

      await db()
        .update(calls)
        .set({ recordingUrl: twilioMp3, recordingAvailable: true, durationSeconds })
        .where(eq(calls.twilioCallSid, sid));

      // Heavy work after responding: fetch the audio once, store our own copy in
      // Blob (Twilio's URL is auth-gated), transcribe, and analyse.
      if (twilioMp3) {
        after(async () => {
          try {
            const cfg = await getDialerConfig();
            if (!cfg) return;
            const auth = "Basic " + Buffer.from(`${cfg.apiKeySid}:${cfg.apiKeySecret}`).toString("base64");
            const res = await fetch(twilioMp3, { headers: { Authorization: auth } });
            if (!res.ok) { console.error("[dialer/recording] fetch mp3 failed:", res.status); return; }
            const buf = Buffer.from(await res.arrayBuffer());

            // Store a public copy so the browser can play it without Twilio auth.
            try {
              const blob = await put(`dialer-recordings/${sid}.mp3`, buf, {
                access: "public",
                contentType: "audio/mpeg",
                token: process.env.BLOB_READ_WRITE_TOKEN,
              });
              await db().update(calls).set({ recordingUrl: blob.url }).where(eq(calls.twilioCallSid, sid));
            } catch (e) {
              console.error("[dialer/recording] blob put failed:", e);
            }

            // Transcribe + insights (skip silently if there's no speech).
            const [row] = await db()
              .select({ id: calls.id, contactId: calls.contactId })
              .from(calls)
              .where(eq(calls.twilioCallSid, sid))
              .limit(1);
            if (!row) return;
            const transcript = await transcribeAudio(buf.toString("base64"), "audio/mpeg");
            if (transcript) {
              await db().update(calls).set({
                transcriptText: diarizedToStored(transcript),
                transcriptAvailable: true,
                transcriptStoredAt: new Date(),
              }).where(eq(calls.id, row.id));
              await generateAndStoreInsights(row.id, row.contactId, transcript);
            }
          } catch (e) {
            console.error("[dialer/recording] post-processing failed:", e);
          }
        });
      }
    }
  } catch (err) {
    console.error("[dialer/recording] handler error:", err);
  }

  return new NextResponse(null, { status: 204 });
}
