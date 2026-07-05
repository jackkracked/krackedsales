import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { metaPages, facebookLeads } from "@/lib/db/schema";
import { count } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { backfillPageLeads } from "@/lib/meta/leads";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Lead-capture status: how many real Facebook leads we hold + whether a page is connected. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [leadRow] = await db().select({ n: count() }).from(facebookLeads);
  const [pageRow] = await db().select({ n: count() }).from(metaPages);
  return NextResponse.json({
    leadsCaptured: Number(leadRow?.n ?? 0),
    pagesConnected: Number(pageRow?.n ?? 0),
  });
}

/**
 * Pull historical Facebook/Instagram Lead Ads submissions for every connected page
 * into facebook_leads, so "New Leads" is populated the moment Lead Ads is connected
 * rather than empty until the next new submission. Admin-only. Idempotent (deduped
 * on leadgen_id), so it is safe to run repeatedly.
 */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const pages = await db().select().from(metaPages);
  if (!pages.length) {
    return NextResponse.json({ error: "No connected Facebook pages. Connect a page first." }, { status: 400 });
  }

  let inserted = 0;
  let forms = 0;
  const perPage: { pageId: string; name: string; inserted: number; forms: number }[] = [];

  for (const p of pages) {
    const res = await backfillPageLeads({
      pageId: p.pageId,
      pageName: p.pageName,
      pageAccessToken: p.pageAccessToken,
    });
    inserted += res.inserted;
    forms += res.forms;
    perPage.push({ pageId: p.pageId, name: p.pageName, inserted: res.inserted, forms: res.forms });
  }

  return NextResponse.json({ ok: true, inserted, forms, pages: perPage });
}
