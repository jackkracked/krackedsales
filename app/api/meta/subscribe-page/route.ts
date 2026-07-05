import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { metaPages } from "@/lib/db/schema";
import { pageId } from "@/lib/meta/client";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** Admin-only: this endpoint writes webhook subscriptions with our page tokens. */
async function requireAdmin(): Promise<NextResponse | null> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }
  return null;
}

/**
 * Subscribes connected Facebook Page(s) to the webhook fields we consume:
 * comments/messages AND `leadgen` (Lead Ads form submissions). Iterates every
 * page stored via OAuth (each with its own token); falls back to the env page.
 * Idempotent, safe to re-run after connecting a new page or adding a field.
 *
 * GET  /api/meta/subscribe-page, current subscription status per page
 * POST /api/meta/subscribe-page, subscribe / re-subscribe every page
 */

const FIELDS = "feed,messages,messaging_postbacks,messaging_referrals,leadgen";

async function connectedPages(): Promise<{ pageId: string; token: string; name?: string }[]> {
  try {
    const rows = await db().select().from(metaPages);
    if (rows.length) return rows.map((r) => ({ pageId: r.pageId, token: r.pageAccessToken, name: r.pageName }));
  } catch {
    // DB unavailable, fall through to env
  }
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (token) return [{ pageId: pageId(), token }];
  return [];
}

async function subscribeOne(pid: string, token: string) {
  const res = await fetch(`https://graph.facebook.com/v25.0/${pid}/subscribed_apps`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `subscribed_fields=${FIELDS}&access_token=${token}`,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const pages = await connectedPages();
  const results = await Promise.all(
    pages.map(async (p) => {
      const res = await fetch(
        `https://graph.facebook.com/v25.0/${p.pageId}/subscribed_apps?access_token=${p.token}`,
        { cache: "no-store" },
      );
      const data = await res.json().catch(() => ({}));
      return { pageId: p.pageId, name: p.name, subscription: data };
    }),
  );
  return NextResponse.json({ fields: FIELDS, pages: results });
}

export async function POST() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const pages = await connectedPages();
  if (!pages.length) {
    return NextResponse.json({ error: "No connected pages and META_PAGE_ACCESS_TOKEN is not set" }, { status: 400 });
  }

  const results = [];
  for (const p of pages) {
    const r = await subscribeOne(p.pageId, p.token);
    if (!r.ok) console.error("[subscribe-page] Failed for", p.pageId, r.data);
    else console.log("[subscribe-page] Subscribed", p.pageId, "to", FIELDS);
    results.push({ pageId: p.pageId, name: p.name, ...r });
  }

  const allOk = results.every((r) => r.ok);
  return NextResponse.json({ ok: allOk, fields: FIELDS, results }, { status: allOk ? 200 : 502 });
}
