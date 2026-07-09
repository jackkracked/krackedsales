import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { proposals } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { logProposalEvent, classifyOpen } from "@/lib/proposals/track";

export const dynamic = "force-dynamic";

// 1x1 transparent GIF.
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");

/**
 * Email-open pixel. Returns a 1x1 GIF and logs a classified "email_opened" event so an
 * Apple-Mail pre-fetch is recorded as delivered, not as a genuine open. Always returns
 * the pixel even if logging fails, so the email never shows a broken image.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const [p] = await db().select({ id: proposals.id, sentAt: proposals.sentAt }).from(proposals).where(eq(proposals.token, token)).limit(1);
    if (p) {
      await logProposalEvent(p.id, token, "email_opened", req, {
        classification: classifyOpen(req, p.sentAt),
        dedupMs: 10 * 60_000,
      });
    }
  } catch { /* best effort */ }
  return new Response(PIXEL, {
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
    },
  });
}
