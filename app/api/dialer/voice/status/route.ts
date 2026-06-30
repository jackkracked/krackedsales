import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { calls } from "@/lib/db/schema";
import { pusherTrigger } from "@/lib/pusher/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/dialer/voice/status
 * Twilio call status callback. Updates the call row status and broadcasts the
 * change to the live dialer UI via Pusher.
 *
 * Resilience: every side effect is best-effort and wrapped; always returns 204
 * so Twilio does not retry.
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const CallSid = form.get("CallSid");
    const CallStatus = form.get("CallStatus");
    // From / To available for future routing/logging needs.
    void form.get("From");
    void form.get("To");

    if (CallSid) {
      try {
        if (CallStatus) {
          await db()
            .update(calls)
            .set({ status: String(CallStatus) })
            .where(eq(calls.twilioCallSid, String(CallSid)));
        }
      } catch (err) {
        console.error("[dialer/status] call update failed:", err);
      }

      try {
        await pusherTrigger("dialer-events", "call.status", {
          callSid: String(CallSid),
          status: String(CallStatus ?? ""),
        });
      } catch (err) {
        console.error("[dialer/status] pusher trigger failed:", err);
      }
    }
  } catch (err) {
    console.error("[dialer/status] handler error:", err);
  }

  return new NextResponse(null, { status: 204 });
}
