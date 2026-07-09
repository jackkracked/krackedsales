import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { logProposalEvent } from "@/lib/proposals/track";

export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://kracked-sales.vercel.app";

/**
 * Tracked click: the email CTA points here. Logs a reliable "clicked" event, then
 * redirects to the real proposal page. The redirect target is ALWAYS our own
 * /p/{token} (no open-redirect), so a hostile token can only ever land on our page.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const [p] = await db().select({ id: proposals.id }).from(proposals).where(eq(proposals.token, token)).limit(1);
    if (p) await logProposalEvent(p.id, token, "clicked", req, { dedupMs: 30 * 60_000 });
  } catch { /* best effort */ }
  return NextResponse.redirect(`${APP_URL}/p/${encodeURIComponent(token)}`, 302);
}
