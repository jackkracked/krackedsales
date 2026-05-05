import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const REDIRECT_URI = "https://kracked-sales.vercel.app/api/meta/auth/callback";

const SCOPES = [
  "pages_show_list",
  "pages_messaging",
  "instagram_basic",
  "instagram_manage_messages",
  "pages_read_engagement",
].join(",");

export async function GET() {
  const appId = process.env.META_APP_ID;
  if (!appId) {
    return NextResponse.json({ error: "META_APP_ID is not configured" }, { status: 500 });
  }

  const state = crypto.randomUUID();

  const authUrl = new URL("https://www.facebook.com/v25.0/dialog/oauth");
  authUrl.searchParams.set("client_id", appId);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authUrl.toString());

  // Store state in a short-lived httpOnly cookie to validate on callback
  response.cookies.set("meta_oauth_state", state, {
    httpOnly: true,
    secure: true,
    maxAge: 600,
    path: "/",
    sameSite: "lax",
  });

  return response;
}
