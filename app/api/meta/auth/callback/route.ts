import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { metaPages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const REDIRECT_URI = "https://kracked-sales.vercel.app/api/meta/auth/callback";
const GRAPH_BASE = "https://graph.facebook.com/v25.0";

const SUCCESS_HTML = `<html><body><script>
window.opener && window.opener.postMessage({ type: 'meta-oauth-success' }, '*');
window.close();
</script><p>Connected! You can close this window.</p></body></html>`;

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // Surface any OAuth-level errors from Facebook
  if (error) {
    const desc = searchParams.get("error_description") ?? error;
    console.error("[Meta OAuth] Facebook returned error:", desc);
    return NextResponse.json({ error: desc }, { status: 400 });
  }

  // Validate CSRF state
  const savedState = req.cookies.get("meta_oauth_state")?.value;
  if (!state || !savedState || state !== savedState) {
    console.error("[Meta OAuth] State mismatch — possible CSRF");
    return NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 });
  }

  if (!code) {
    return NextResponse.json({ error: "Missing code parameter" }, { status: 400 });
  }

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    return NextResponse.json({ error: "META_APP_ID or META_APP_SECRET not configured" }, { status: 500 });
  }

  // Step 1: Exchange code for short-lived user token
  const shortTokenUrl = new URL(`${GRAPH_BASE}/oauth/access_token`);
  shortTokenUrl.searchParams.set("client_id", appId);
  shortTokenUrl.searchParams.set("client_secret", appSecret);
  shortTokenUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  shortTokenUrl.searchParams.set("code", code);

  const shortRes = await fetch(shortTokenUrl.toString(), { cache: "no-store" });
  if (!shortRes.ok) {
    const body = await shortRes.text().catch(() => "");
    console.error("[Meta OAuth] Short token exchange failed:", body);
    return NextResponse.json({ error: "Failed to exchange code for token" }, { status: 500 });
  }
  const { access_token: shortLivedToken } = await shortRes.json() as { access_token: string };

  // Step 2: Exchange short-lived token for long-lived user token
  const longTokenUrl = new URL(`${GRAPH_BASE}/oauth/access_token`);
  longTokenUrl.searchParams.set("grant_type", "fb_exchange_token");
  longTokenUrl.searchParams.set("client_id", appId);
  longTokenUrl.searchParams.set("client_secret", appSecret);
  longTokenUrl.searchParams.set("fb_exchange_token", shortLivedToken);

  const longRes = await fetch(longTokenUrl.toString(), { cache: "no-store" });
  if (!longRes.ok) {
    const body = await longRes.text().catch(() => "");
    console.error("[Meta OAuth] Long token exchange failed:", body);
    return NextResponse.json({ error: "Failed to exchange for long-lived token" }, { status: 500 });
  }
  const { access_token: longLivedToken } = await longRes.json() as { access_token: string };

  // Step 3: Get pages the user manages (includes page-level tokens)
  const accountsUrl = new URL(`${GRAPH_BASE}/me/accounts`);
  accountsUrl.searchParams.set("fields", "id,name,picture,access_token");
  accountsUrl.searchParams.set("access_token", longLivedToken);

  const accountsRes = await fetch(accountsUrl.toString(), { cache: "no-store" });
  if (!accountsRes.ok) {
    const body = await accountsRes.text().catch(() => "");
    console.error("[Meta OAuth] Failed to fetch accounts:", body);
    return NextResponse.json({ error: "Failed to fetch managed pages" }, { status: 500 });
  }
  const accountsData = await accountsRes.json() as {
    data: Array<{
      id: string;
      name: string;
      picture?: { data?: { url?: string } };
      access_token: string;
    }>;
  };

  const pages = accountsData.data ?? [];
  if (pages.length === 0) {
    console.warn("[Meta OAuth] No pages found for this user");
  }

  // Step 4: For each page, get linked Instagram account and upsert into DB
  for (const page of pages) {
    let instagramAccountId: string | null = null;
    let instagramHandle: string | null = null;
    let instagramAvatar: string | null = null;

    try {
      const igUrl = new URL(`${GRAPH_BASE}/${page.id}`);
      igUrl.searchParams.set(
        "fields",
        "instagram_business_account{id,username,profile_picture_url}"
      );
      igUrl.searchParams.set("access_token", page.access_token);

      const igRes = await fetch(igUrl.toString(), { cache: "no-store" });
      if (igRes.ok) {
        const igData = await igRes.json() as {
          instagram_business_account?: {
            id?: string;
            username?: string;
            profile_picture_url?: string;
          };
        };
        const igAccount = igData.instagram_business_account;
        if (igAccount) {
          instagramAccountId = igAccount.id ?? null;
          instagramHandle = igAccount.username ?? null;
          instagramAvatar = igAccount.profile_picture_url ?? null;
        }
      }
    } catch (err) {
      // Non-fatal — page may not have an Instagram account linked
      console.warn(`[Meta OAuth] Could not fetch Instagram for page ${page.id}:`, err);
    }

    const pageAvatar = page.picture?.data?.url ?? null;

    await db()
      .insert(metaPages)
      .values({
        pageId: page.id,
        pageName: page.name,
        pageAvatar,
        pageAccessToken: page.access_token,
        instagramAccountId,
        instagramHandle,
        instagramAvatar,
        connectedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: metaPages.pageId,
        set: {
          pageName: page.name,
          pageAvatar,
          pageAccessToken: page.access_token,
          instagramAccountId,
          instagramHandle,
          instagramAvatar,
          connectedAt: new Date(),
        },
      });

    console.log(`[Meta OAuth] Upserted page ${page.id} (${page.name})`);
  }

  // Clear state cookie and return success HTML that closes the popup
  const response = new NextResponse(SUCCESS_HTML, {
    headers: { "Content-Type": "text/html" },
  });
  response.cookies.set("meta_oauth_state", "", {
    httpOnly: true,
    secure: true,
    maxAge: 0,
    path: "/",
  });

  return response;
}
