import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

// ─── GET — begin TikTok OAuth flow ───────────────────────────────────────────

export async function GET(_req: NextRequest) {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  if (!clientKey) {
    return NextResponse.json(
      { error: "TIKTOK_CLIENT_KEY is not set" },
      { status: 500 }
    );
  }

  const state = crypto.randomUUID();

  const authUrl = new URL("https://www.tiktok.com/v2/auth/authorize/");
  authUrl.searchParams.set("client_key", clientKey);
  authUrl.searchParams.set(
    "scope",
    "user.info.basic,dm.conversation,dm.conversation.messages,video.comment"
  );
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set(
    "redirect_uri",
    "https://kracked-sales.vercel.app/api/tiktok/auth/callback"
  );
  authUrl.searchParams.set("state", state);

  // Save state in a short-lived httpOnly cookie for CSRF validation on callback
  const cookieStore = await cookies();
  cookieStore.set("tiktok_oauth_state", state, {
    httpOnly: true,
    secure: true,
    maxAge: 600, // 10 minutes
    path: "/",
  });

  return NextResponse.redirect(authUrl.toString());
}
