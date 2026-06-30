import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import twilio from "twilio";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { repIdentity } from "@/lib/dialer/twilio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/dialer/voice/inbound
 * Twilio hits this when a call comes in to the business number.
 *
 * v1 routing: ring every active rep's browser Device at once (<Client> per rep).
 * First to answer wins. If nobody answers within the timeout, fall through to a
 * voicemail prompt + recording.
 *
 * Resilience: Twilio calls this, so we MUST always return valid TwiML — even if
 * the user query fails. On any error we return a minimal valid <Response><Say>.
 */
export async function POST(req: NextRequest) {
  const vr = new twilio.twiml.VoiceResponse();

  try {
    const form = await req.formData();
    // From / CallSid are read for context (routing/logging hooks); kept explicit.
    void form.get("From");
    void form.get("CallSid");

    const activeUsers = await db()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.isActive, true));

    // Ring all logged-in reps in parallel; first to answer bridges.
    const dial = vr.dial({ answerOnBridge: true, timeout: 20 });
    for (const u of activeUsers) {
      dial.client(repIdentity(u.id));
    }

    // No answer → voicemail.
    vr.say("Sorry we missed you, please leave a message after the tone.");
    vr.record({ maxLength: 120, transcribe: false });

    return new NextResponse(vr.toString(), {
      headers: { "Content-Type": "text/xml" },
    });
  } catch (err) {
    console.error("[dialer/inbound] handler error:", err);
    const fallback = new twilio.twiml.VoiceResponse();
    fallback.say(
      "Sorry, we are unable to take your call right now. Please try again later."
    );
    return new NextResponse(fallback.toString(), {
      headers: { "Content-Type": "text/xml" },
    });
  }
}
