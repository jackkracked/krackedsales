import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dialerSettings, twilioNumbers } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { encryptSecret } from "@/lib/dialer/crypto";
import { getDialerConfig, twilioClient } from "@/lib/dialer/twilio";

export const dynamic = "force-dynamic";

/** Mask an Account SID for display, e.g. "AC••••1234". Never expose the full value. */
function maskAccountSid(sid: string | null): string | null {
  if (!sid) return null;
  const last4 = sid.slice(-4);
  return `AC••••${last4}`;
}

/**
 * GET /api/dialer/settings (admin only)
 * Reports whether Twilio is connected. Never returns the API key secret.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const config = await getDialerConfig();
    const [row] = await db().select().from(dialerSettings).limit(1);

    return NextResponse.json({
      connected: config !== null,
      accountSid: maskAccountSid(row?.twilioAccountSid ?? null),
      callerId: row?.callerId ?? null,
    });
  } catch (err) {
    console.error("[Dialer Settings GET]", err);
    return NextResponse.json({ error: "Failed to load telephony settings" }, { status: 500 });
  }
}

interface DialerSettingsBody {
  accountSid?: string;
  apiKeySid?: string;
  apiKeySecret?: string;
  callerId?: string;
}

/**
 * POST /api/dialer/settings (admin only)
 * Validates the Twilio credentials against the live API, then stores them
 * (the API key secret encrypted at rest). There is only ever one row.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: DialerSettingsBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const accountSid = body.accountSid?.trim();
  const apiKeySid = body.apiKeySid?.trim();
  const apiKeySecret = body.apiKeySecret?.trim();
  const callerId = body.callerId?.trim();

  if (!accountSid || !apiKeySid || !apiKeySecret || !callerId) {
    return NextResponse.json(
      { error: "All fields are required: Account SID, API Key SID, API Key Secret, and Caller ID" },
      { status: 400 },
    );
  }

  if (!accountSid.startsWith("AC")) {
    return NextResponse.json(
      { error: "Account SID must start with \"AC\"" },
      { status: 400 },
    );
  }

  // Webhook URLs Twilio will call (absolute, from the deployed origin).
  const origin = req.nextUrl.origin;
  const outboundUrl = `${origin}/api/dialer/voice/outbound`;
  const inboundUrl = `${origin}/api/dialer/voice/inbound`;

  const [existing] = await db().select().from(dialerSettings).limit(1);
  let twimlAppSid = existing?.twimlAppSid ?? null;

  // 1) Validate the credentials against the live Twilio API before saving anything.
  let client: ReturnType<typeof twilioClient>;
  try {
    client = twilioClient({ accountSid, apiKeySid, apiKeySecret, twimlAppSid: null, callerId });
    await client.api.v2010.accounts(accountSid).fetch();
  } catch {
    return NextResponse.json({ error: "Could not connect to Twilio — check the credentials" }, { status: 400 });
  }

  // 2) Provision the TwiML app outbound browser calls route through (essential).
  //    Reuse the existing app if we have one; otherwise create it. Points its voice
  //    URL at our outbound webhook so a browser Device.connect() dials the number.
  try {
    if (twimlAppSid) {
      await client.applications(twimlAppSid).update({ voiceUrl: outboundUrl, voiceMethod: "POST" });
    } else {
      const app = await client.applications.create({ friendlyName: "Kracked Dialer", voiceUrl: outboundUrl, voiceMethod: "POST" });
      twimlAppSid = app.sid;
    }
  } catch (e) {
    console.error("[Dialer Settings] TwiML app provisioning failed", e);
    return NextResponse.json({ error: "Connected, but couldn't set up the calling app — make sure the API key is a Standard key with full access." }, { status: 400 });
  }

  // 3) Point the caller number at our inbound webhook + record it in the pool (best-effort).
  try {
    const nums = await client.incomingPhoneNumbers.list({ phoneNumber: callerId, limit: 1 });
    if (nums[0]) {
      await client.incomingPhoneNumbers(nums[0].sid).update({ voiceUrl: inboundUrl, voiceMethod: "POST" });
      await db().insert(twilioNumbers).values({ phoneNumber: callerId, twilioSid: nums[0].sid, label: "Shared", isShared: true }).onConflictDoNothing();
    }
  } catch (e) {
    console.error("[Dialer Settings] number webhook config failed (non-fatal)", e);
  }

  // 4) Save (API key secret encrypted at rest). Single row, whitelisted fields.
  try {
    const values = {
      twilioAccountSid: accountSid,
      twilioApiKeySid: apiKeySid,
      twilioApiKeySecret: encryptSecret(apiKeySecret),
      twimlAppSid,
      callerId,
      updatedBy: user.id,
      updatedAt: new Date(),
    };
    if (existing) await db().update(dialerSettings).set(values);
    else await db().insert(dialerSettings).values(values);
    return NextResponse.json({ connected: true, accountSid: maskAccountSid(accountSid), callerId });
  } catch (err) {
    console.error("[Dialer Settings POST]", err);
    return NextResponse.json({ error: "Failed to save telephony settings" }, { status: 500 });
  }
}
