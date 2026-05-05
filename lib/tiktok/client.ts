import { db } from "@/lib/db";
import { tiktokSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const OPEN_BASE = "https://open.tiktokapis.com/v2";
const BUSINESS_BASE = "https://business-api.tiktok.com/open_api/v1.3";

// ─── Settings helpers ─────────────────────────────────────────────────────────

/** Loads the single tiktokSettings row. Throws if none exists. */
export async function getTiktokSettings(): Promise<
  typeof tiktokSettings.$inferSelect
> {
  const client = db();
  const rows = await client.select().from(tiktokSettings).limit(1);
  if (rows.length === 0) {
    throw new Error("TikTok settings not configured");
  }
  return rows[0];
}

/**
 * Checks if accessToken is expiring within 1 hour.
 * If so, refreshes and saves new tokens to DB. Returns updated settings.
 */
export async function refreshAccessTokenIfNeeded(
  settings: typeof tiktokSettings.$inferSelect
): Promise<typeof tiktokSettings.$inferSelect> {
  const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);

  // If token is not set or not expiring soon, nothing to do
  if (!settings.tokenExpiresAt || settings.tokenExpiresAt > oneHourFromNow) {
    return settings;
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    throw new Error("TIKTOK_CLIENT_KEY or TIKTOK_CLIENT_SECRET is not set");
  }

  const res = await fetch(`${OPEN_BASE}/oauth/token/refresh/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: settings.refreshToken,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TikTok token refresh failed ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    data: {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
  };

  const tokenExpiresAt = new Date(
    Date.now() + data.data.expires_in * 1000
  );

  const client = db();
  const [updated] = await client
    .update(tiktokSettings)
    .set({
      accessToken: data.data.access_token,
      refreshToken: data.data.refresh_token,
      tokenExpiresAt,
      updatedAt: new Date(),
    })
    .where(eq(tiktokSettings.id, settings.id))
    .returning();

  return updated;
}

// ─── Open Platform client (DMs) ───────────────────────────────────────────────

/** GET https://open.tiktokapis.com/v2{path} — auto-refreshes token if needed */
export async function openGet(
  path: string,
  params?: Record<string, string>
): Promise<unknown> {
  const settings = await refreshAccessTokenIfNeeded(await getTiktokSettings());

  const url = new URL(`${OPEN_BASE}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${settings.accessToken}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TikTok Open API GET ${path} failed ${res.status}: ${body}`);
  }

  return res.json();
}

/** POST https://open.tiktokapis.com/v2{path} — auto-refreshes token if needed */
export async function openPost(
  path: string,
  body: unknown
): Promise<unknown> {
  const settings = await refreshAccessTokenIfNeeded(await getTiktokSettings());

  const res = await fetch(`${OPEN_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`TikTok Open API POST ${path} failed ${res.status}: ${text}`);
  }

  return res.json();
}

// ─── Business API client (comments) ──────────────────────────────────────────

/** GET https://business-api.tiktok.com/open_api/v1.3{path} */
export async function businessGet(
  path: string,
  params?: Record<string, string>
): Promise<unknown> {
  const settings = await getTiktokSettings();

  const url = new URL(`${BUSINESS_BASE}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { "Access-Token": settings.businessAccessToken ?? "" },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `TikTok Business API GET ${path} failed ${res.status}: ${body}`
    );
  }

  return res.json();
}

/** POST https://business-api.tiktok.com/open_api/v1.3{path} */
export async function businessPost(
  path: string,
  body: unknown
): Promise<unknown> {
  const settings = await getTiktokSettings();

  const res = await fetch(`${BUSINESS_BASE}${path}`, {
    method: "POST",
    headers: {
      "Access-Token": settings.businessAccessToken ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `TikTok Business API POST ${path} failed ${res.status}: ${text}`
    );
  }

  return res.json();
}
