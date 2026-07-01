import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { db } from "@/lib/db";
import { calls } from "@/lib/db/schema";
import { getDialerConfig } from "@/lib/dialer/twilio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/dialer/voice/outbound
 * Twilio hits this when a rep's browser Device places an outbound call.
 * Body is form-urlencoded. We respond with TwiML that dials the target number,
 * records the call, and points recording status callbacks back at us.
 *
 * Resilience: Twilio calls this, so we MUST always return valid TwiML — even if
 * the DB write or config load fails. The <Dial> is built first and never depends
 * on the best-effort INSERT.
 */
export async function POST(req: NextRequest) {
  const vr = new twilio.twiml.VoiceResponse();

  try {
    const form = await req.formData();
    const To = String(form.get("To") ?? "");
    const CallSid = form.get("CallSid");
    // Custom params we pass from the client when placing the call.
    const contactId = form.get("contactId");
    const repEmail = form.get("repEmail");

    let cfg = null;
    try {
      cfg = await getDialerConfig();
    } catch (err) {
      console.error("[dialer/outbound] getDialerConfig failed:", err);
    }

    const dial = vr.dial({
      callerId: cfg?.callerId ?? undefined,
      answerOnBridge: true,
      record: "record-from-answer-dual",
      recordingStatusCallback: new URL(
        "/api/dialer/voice/recording",
        req.nextUrl.origin
      ).toString(),
      recordingStatusCallbackEvent: ["completed"],
    });
    // Status callback on the dialed leg → tells us the final call status
    // (completed / no-answer / busy / failed) so the row doesn't stay "in_progress".
    dial.number(
      {
        statusCallback: new URL("/api/dialer/voice/status", req.nextUrl.origin).toString(),
        statusCallbackEvent: ["completed"],
        statusCallbackMethod: "POST",
      },
      To,
    );

    // Best-effort: log the call row. Never let a DB error break the XML.
    try {
      await db()
        .insert(calls)
        .values({
          callType: "dialer",
          source: "twilio",
          direction: "outbound",
          status: "in_progress",
          twilioCallSid: CallSid ? String(CallSid) : "",
          contactId: contactId ? String(contactId) : null,
          toNumber: To || null,
          startedAt: new Date(),
          repEmail: repEmail ? String(repEmail) : null,
        });
    } catch (err) {
      console.error("[dialer/outbound] call insert failed:", err);
    }

    return new NextResponse(vr.toString(), {
      headers: { "Content-Type": "text/xml" },
    });
  } catch (err) {
    // Absolute fallback: still return valid TwiML so the call doesn't hard-fail.
    console.error("[dialer/outbound] handler error:", err);
    return new NextResponse(vr.toString(), {
      headers: { "Content-Type": "text/xml" },
    });
  }
}
