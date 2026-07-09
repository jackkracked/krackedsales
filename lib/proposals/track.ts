/**
 * Proposal engagement tracking. Logs prospect events (viewed / clicked / email_opened),
 * DEDUPES rapid repeats (a single open triggers several page loads / pixel fetches), and
 * classifies email opens so machine pre-fetches never count as a real open.
 * Everything here is best-effort: a tracking failure must never break a page or a send.
 */
import { db } from "@/lib/db";
import { proposalEvents } from "@/lib/db/schema";
import { and, eq, gte } from "drizzle-orm";
import type { NextRequest } from "next/server";

export type EventType = "viewed" | "clicked" | "email_opened";
export type OpenClass = "genuine" | "apple_proxy" | "google_proxy" | "prefetch";

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? "";
}

// Apple Mail Privacy pre-fetch egress: 17.0.0.0/8 and 172.224.0.0/12 (172.224–172.239.x.x).
function isAppleProxy(ip: string): boolean {
  return /^17\./.test(ip) || /^172\.(22[4-9]|23[0-9])\./.test(ip);
}
// Gmail image proxy / Googlebot ranges (and the GoogleImageProxy UA).
function isGoogleProxy(ip: string, ua: string): boolean {
  return /^66\.249\./.test(ip) || /^66\.102\./.test(ip) || /^74\.125\./.test(ip) || /^209\.85\./.test(ip) || ua.includes("googleimageproxy");
}

/**
 * Classify an email-open pixel hit. Only "genuine" counts as a real human open.
 *   - apple_proxy / google_proxy: the mail provider pre-loaded the pixel (not an open).
 *   - prefetch: fired within ~2 min of the email being sent (delivery-time image fetch).
 * Note: iCloud Private Relay egress (Fastly/Akamai) is a REAL user, so it stays genuine.
 */
export function classifyOpen(req: NextRequest, sentAt?: Date | string | null): OpenClass {
  const ip = clientIp(req);
  const ua = (req.headers.get("user-agent") ?? "").toLowerCase();
  if (isAppleProxy(ip) || ua.includes("apple mail") || ua.includes("applemail")) return "apple_proxy";
  if (isGoogleProxy(ip, ua)) return "google_proxy";
  if (sentAt && Date.now() - new Date(sentAt).getTime() < 120_000) return "prefetch";
  return "genuine";
}

/**
 * Log an event, skipping a duplicate of the same (proposal, type, device) inside
 * `dedupMs` — collapses the burst of page loads / pixel fetches a single real open causes.
 * Deduped on user-agent (stable per device) since the IP rotates under Private Relay.
 */
export async function logProposalEvent(
  proposalId: string,
  token: string | null,
  type: EventType,
  req: NextRequest,
  opts: { classification?: OpenClass | null; dedupMs?: number } = {},
): Promise<void> {
  try {
    const userAgent = req.headers.get("user-agent") ?? "";
    if (opts.dedupMs) {
      const since = new Date(Date.now() - opts.dedupMs);
      const [dup] = await db()
        .select({ id: proposalEvents.id })
        .from(proposalEvents)
        .where(and(
          eq(proposalEvents.proposalId, proposalId),
          eq(proposalEvents.type, type),
          eq(proposalEvents.userAgent, userAgent),
          gte(proposalEvents.createdAt, since),
        ))
        .limit(1);
      if (dup) return; // a very recent identical event from this device — don't double-count
    }
    await db().insert(proposalEvents).values({
      proposalId,
      token,
      type,
      classification: opts.classification ?? null,
      ip: clientIp(req),
      userAgent,
    });
  } catch (e) {
    console.error("[track] logProposalEvent failed:", e);
  }
}
