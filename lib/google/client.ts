/**
 * Google Workspace service account client with domain-wide delegation.
 *
 * Required env vars:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL  — the service account's email address
 *   GOOGLE_SERVICE_ACCOUNT_KEY    — the private key from the JSON key file
 *                                   (replace literal \n with actual newlines, or
 *                                    store as a base64-encoded JSON string — see below)
 *   GOOGLE_WORKSPACE_DOMAIN       — e.g. "youragency.com"
 *
 * The service account needs domain-wide delegation in Google Workspace Admin
 * with these scopes:
 *   https://www.googleapis.com/auth/calendar
 *   https://www.googleapis.com/auth/meetings.space.readonly
 *
 * Usage:
 *   const cal = await calendarClient("rep@yourworkspace.com");
 *   const events = await cal.events.list({ calendarId: "primary", ... });
 */

import { google } from "googleapis";
import { JWT } from "google-auth-library";

function getServiceAccountKey(): string {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY ?? "";
  if (!raw) return "";
  // Support base64-encoded JSON key file: GOOGLE_SERVICE_ACCOUNT_KEY=base64:...
  if (raw.startsWith("base64:")) {
    return Buffer.from(raw.slice(7), "base64").toString("utf8");
  }
  return raw;
}

function getServiceAccountEmail(): string {
  return process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "";
}

function isConfigured(): boolean {
  return !!(getServiceAccountEmail() && getServiceAccountKey());
}

/**
 * Returns a Google Auth JWT client impersonating the given user email.
 * Throws if service account credentials are not configured.
 */
function makeJWT(userEmail: string, scopes: string[]): JWT {
  if (!isConfigured()) {
    throw new Error(
      "Google service account not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_KEY."
    );
  }

  const keyRaw = getServiceAccountKey();
  let privateKey: string;

  try {
    // Try parsing as JSON key file
    const parsed = JSON.parse(keyRaw);
    privateKey = parsed.private_key;
  } catch {
    // Treat as raw PEM key
    privateKey = keyRaw.replace(/\\n/g, "\n");
  }

  return new JWT({
    email: getServiceAccountEmail(),
    key: privateKey,
    scopes,
    subject: userEmail,
  });
}

const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
];

const MEET_SCOPES = [
  "https://www.googleapis.com/auth/meetings.space.readonly",
];

// Requires the service account's domain-wide delegation to include this scope:
//   https://www.googleapis.com/auth/drive.readonly
// Add it in Google Admin Console → Security → API controls → Domain-wide delegation
const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
];

/**
 * Returns a Google Calendar API client impersonating the given user.
 */
export async function calendarClient(userEmail: string) {
  const auth = makeJWT(userEmail, CALENDAR_SCOPES);
  return google.calendar({ version: "v3", auth });
}

/**
 * Returns a Google Meet API client impersonating the given user (organiser).
 * Note: Meet API only returns conferences where the impersonated user is the organiser.
 */
export async function meetClient(userEmail: string) {
  const auth = makeJWT(userEmail, MEET_SCOPES);
  return google.meet({ version: "v2", auth });
}

/**
 * Returns a Google Drive API client impersonating the given user.
 * Used to search for Gemini meeting notes created after each Google Meet call.
 */
export async function driveClient(userEmail: string) {
  const auth = makeJWT(userEmail, DRIVE_SCOPES);
  return google.drive({ version: "v3", auth });
}

export { isConfigured as isGoogleConfigured };
