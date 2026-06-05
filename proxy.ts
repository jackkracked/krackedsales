import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";

const SESSION_COOKIE = "kracked_session";

/** Verify a signed session token of the form `{userId}|{hmac}` */
function verifySession(token: string): boolean {
  const [userId, sig] = token.split("|");
  if (!userId || !sig) return false;

  const secret = process.env.SESSION_SECRET ?? "dev-secret-change-me";
  const expected = createHmac("sha256", secret).update(userId).digest("hex");
  return sig === expected;
}

const PUBLIC_PATHS = [
  "/login",
  "/terms",
  "/privacy",
  "/p/",                        // Public proposal signing pages — no auth required
  "/api/proposals/public/",    // API called by the public signing page — no auth required
  "/api/auth/login",
  "/api/cron/",    // Vercel cron runner — routes validate CRON_SECRET themselves
  "/api/webhooks/",
  "/api/stripe/webhook", // Stripe webhook — verifies its own stripe-signature, must not require a session cookie
  "/api/meta/subscribe-page",
  "/api/tiktok/auth",   // TikTok OAuth start + callback (unauthenticated redirects)
  "/api/meta/auth",     // Meta OAuth start + callback (unauthenticated redirects)
  "/api/comment-leads/backfill",
  "/api/clickup/demos/count",
  "/api/ghl/opportunities/booked-calls",
  "/api/ghl/opportunities/no-show-calls",
  "/api/ghl/opportunities/no-show-backfill",
  "/api/ghl/opportunities/demo-in-progress",
  "/api/workflows/webhook/",
  "/_next/",       // CSS, JS, fonts — must load before auth check
  "/favicon.ico",
  "/kracked-logo.png", // Used in transactional emails — must be publicly accessible
  "/tiktok",       // TikTok domain verification files
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths through
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow client-facing proposal actions — signing and PDF download are unauthenticated
  if (/^\/api\/proposals\/[^/]+\/(sign|pdf)$/.test(pathname)) {
    return NextResponse.next();
  }

  // Allow internal server-to-server calls (e.g. Slack agent fetching data)
  const internalSecret = request.headers.get("x-internal-secret");
  if (internalSecret && internalSecret === process.env.CRON_SECRET) {
    return NextResponse.next();
  }

  // Check session cookie
  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;
  if (sessionToken && verifySession(sessionToken)) {
    return NextResponse.next();
  }

  // Not authenticated → redirect to login
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}
