import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookingLinks } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/**
 * The tracked booking link a prospect actually clicks.
 *
 * `/b/{token}` records the click and forwards to the GoHighLevel booking page. The prospect
 * sees an ordinary link and books in the normal way; we learn that this specific send produced
 * the visit, which is what lets the booked call be credited to the person who sent it.
 *
 * Same shape as `app/api/proposals/track/[token]/route.ts`, which already does this for
 * proposals.
 *
 * DELIBERATELY PUBLIC. It is clicked by prospects with no session, from an email client or a
 * phone, so it must never sit behind auth. It reveals nothing: a token maps to a calendar URL
 * that is already public, and an unknown token just goes to the site rather than confirming or
 * denying that it existed.
 *
 * NEVER BLOCKS THE REDIRECT. If logging the click fails, the person still reaches the booking
 * page. Losing a metric is a nuisance; losing a booking is revenue.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://kracked-sales.vercel.app";

  try {
    const [link] = await db()
      .select({ targetUrl: bookingLinks.targetUrl })
      .from(bookingLinks)
      .where(eq(bookingLinks.token, token))
      .limit(1);

    if (!link) return NextResponse.redirect(appUrl, 302);

    // Count every click, but only stamp the FIRST one, so "time to click" stays meaningful
    // when someone opens the link three times before choosing a slot.
    await db()
      .update(bookingLinks)
      .set({
        clickCount: sql`${bookingLinks.clickCount} + 1`,
        firstClickedAt: sql`coalesce(${bookingLinks.firstClickedAt}, now())`,
      })
      .where(eq(bookingLinks.token, token))
      .catch((e) => console.error("[booking-link] click not recorded", e));

    return NextResponse.redirect(link.targetUrl, 302);
  } catch (err) {
    console.error("[booking-link] redirect failed", err);
    return NextResponse.redirect(appUrl, 302);
  }
}
