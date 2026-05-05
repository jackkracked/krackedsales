import { NextResponse } from "next/server";
import { pageId } from "@/lib/meta/client";

export const dynamic = "force-dynamic";

/**
 * One-time setup: subscribes the Facebook Page to receive webhook events
 * for feed (comments) and messages. Must be called once after app publish.
 *
 * GET /api/meta/subscribe-page  — check current subscription
 * POST /api/meta/subscribe-page — subscribe / re-subscribe
 */

const FIELDS = "feed,messages,messaging_postbacks,messaging_referrals";

export async function GET() {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  const pid = pageId();

  const url = `https://graph.facebook.com/v25.0/${pid}/subscribed_apps?access_token=${token}`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();

  return NextResponse.json({ pageId: pid, subscription: data });
}

export async function POST() {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  const pid = pageId();

  const url = `https://graph.facebook.com/v25.0/${pid}/subscribed_apps`;
  const res = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `subscribed_fields=${FIELDS}&access_token=${token}`,
  });

  const data = await res.json();

  if (!res.ok) {
    console.error("[subscribe-page] Failed:", data);
    return NextResponse.json({ error: data }, { status: res.status });
  }

  console.log("[subscribe-page] Subscribed page", pid, "to fields:", FIELDS);
  return NextResponse.json({ ok: true, pageId: pid, fields: FIELDS, result: data });
}
