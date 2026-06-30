import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

// Encrypt the Twilio API Key secret at rest. Key derived from SESSION_SECRET so we
// don't introduce a new secret to manage. AES-256-GCM (authenticated). Stored as
// "v1:<iv>:<tag>:<ciphertext>" (all base64).

const KEY_SALT = "kracked-dialer-v1";

function key(): Buffer {
  const secret = process.env.SESSION_SECRET ?? "dev-secret-change-me";
  return scryptSync(secret, KEY_SALT, 32);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  try {
    const [v, ivb, tagb, encb] = stored.split(":");
    if (v !== "v1" || !ivb || !tagb || !encb) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivb, "base64"));
    decipher.setAuthTag(Buffer.from(tagb, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(encb, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
