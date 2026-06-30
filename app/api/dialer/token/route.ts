import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getDialerConfig, mintVoiceToken, repIdentity } from "@/lib/dialer/twilio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/dialer/token
 * Mint a short-lived Twilio Voice access token for the logged-in rep's browser Device.
 * Returns { configured: false } (200) until an admin has connected Twilio.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cfg = await getDialerConfig();
  if (!cfg) {
    return NextResponse.json({ configured: false });
  }

  const identity = repIdentity(user.id);
  return NextResponse.json({
    configured: true,
    token: mintVoiceToken(cfg, identity),
    identity,
  });
}
