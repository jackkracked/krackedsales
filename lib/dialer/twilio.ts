import twilio from "twilio";
import { db } from "@/lib/db";
import { dialerSettings } from "@/lib/db/schema";
import { decryptSecret } from "./crypto";

export interface DialerConfig {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  twimlAppSid: string | null;
  callerId: string | null;
}

/** Load + decrypt the Twilio config. Returns null until an admin has connected Twilio. */
export async function getDialerConfig(): Promise<DialerConfig | null> {
  const [row] = await db().select().from(dialerSettings).limit(1);
  if (!row?.twilioAccountSid || !row.twilioApiKeySid || !row.twilioApiKeySecret) return null;
  const secret = decryptSecret(row.twilioApiKeySecret);
  if (!secret) return null;
  return {
    accountSid: row.twilioAccountSid,
    apiKeySid: row.twilioApiKeySid,
    apiKeySecret: secret,
    twimlAppSid: row.twimlAppSid,
    callerId: row.callerId,
  };
}

/** A REST client authenticated with the API key (scoped to the account). */
export function twilioClient(cfg: DialerConfig) {
  return twilio(cfg.apiKeySid, cfg.apiKeySecret, { accountSid: cfg.accountSid });
}

/** Mint a short-lived Voice access token for a logged-in user's browser Device. */
export function mintVoiceToken(cfg: DialerConfig, identity: string): string {
  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;
  const token = new AccessToken(cfg.accountSid, cfg.apiKeySid, cfg.apiKeySecret, { identity, ttl: 3600 });
  token.addGrant(new VoiceGrant({
    outgoingApplicationSid: cfg.twimlAppSid ?? undefined,
    incomingAllow: true,
  }));
  return token.toJwt();
}

/** A Twilio "client" identity for a rep (used by inbound <Client> routing). */
export function repIdentity(userId: string): string {
  return `rep_${userId}`;
}
