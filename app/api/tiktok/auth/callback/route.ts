import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { tiktokSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

// ─── GET — handle TikTok OAuth callback ──────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  // Validate CSRF state
  const cookieStore = await cookies();
  const savedState = cookieStore.get("tiktok_oauth_state")?.value;

  if (!state || !savedState || state !== savedState) {
    console.error("[TikTok /auth/callback] State mismatch — possible CSRF");
    return NextResponse.json({ error: "Invalid state parameter" }, { status: 400 });
  }

  if (!code) {
    console.error("[TikTok /auth/callback] Missing code parameter");
    return NextResponse.json({ error: "Missing code parameter" }, { status: 400 });
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    console.error("[TikTok /auth/callback] Missing TIKTOK_CLIENT_KEY or TIKTOK_CLIENT_SECRET");
    return NextResponse.json(
      { error: "TikTok credentials not configured" },
      { status: 500 }
    );
  }

  // Exchange code for tokens
  let tokenData: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    open_id: string;
  };

  try {
    const body = new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: "https://kracked-sales.vercel.app/api/tiktok/auth/callback",
    });

    const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Token exchange failed ${res.status}: ${text}`);
    }

    const json = (await res.json()) as { data: typeof tokenData };
    tokenData = json.data;
  } catch (err) {
    console.error("[TikTok /auth/callback] Token exchange error:", err);
    return NextResponse.json(
      { error: "Failed to exchange TikTok authorization code" },
      { status: 500 }
    );
  }

  const tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

  try {
    const client = db();
    const rows = await client.select().from(tiktokSettings).limit(1);

    if (rows.length > 0) {
      await client
        .update(tiktokSettings)
        .set({
          openId: tokenData.open_id,
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          tokenExpiresAt,
          updatedAt: new Date(),
        })
        .where(eq(tiktokSettings.id, rows[0].id));
    } else {
      await client.insert(tiktokSettings).values({
        openId: tokenData.open_id,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        tokenExpiresAt,
      });
    }
  } catch (err) {
    console.error("[TikTok /auth/callback] DB upsert failed:", err);
    return NextResponse.json(
      { error: "Failed to save TikTok tokens" },
      { status: 500 }
    );
  }

  // Clear the CSRF state cookie
  cookieStore.delete("tiktok_oauth_state");

  return NextResponse.redirect(
    new URL(
      "/settings?tab=integrations&tiktok=connected",
      req.nextUrl.origin
    )
  );
}
