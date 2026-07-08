/**
 * Proposal engagement tracking. Logs prospect events (viewed / clicked / email_opened)
 * and classifies email opens so Apple Mail's pre-fetch never counts as a real open.
 * Everything here is best-effort: a tracking failure must never break a page or a send.
 */
import { db } from "@/lib/db";
import { proposalEvents } from "@/lib/db/schema";
import type { NextRequest } from "next/server";

export type EventType = "viewed" | "clicked" | "email_opened";
export type OpenClass = "genuine" | "apple_proxy";

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? "";
}

/**
 * Classify an email-open pixel hit. Apple Mail Privacy Protection pre-loads every image
 * from Apple's proxy range (17.0.0.0/8) at delivery, so those are "delivered", not opened.
 * Gmail proxies real opens through Google, so non-Apple hits are genuine human opens.
 */
export function classifyOpen(req: NextRequest): OpenClass {
  const ip = clientIp(req);
  const ua = (req.headers.get("user-agent") ?? "").toLowerCase();
  if (/^17\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) return "apple_proxy";
  if (ua.includes("applemail") || ua.includes("apple mail")) return "apple_proxy";
  return "genuine";
}

export async function logProposalEvent(
  proposalId: string,
  token: string | null,
  type: EventType,
  req: NextRequest,
  classification?: OpenClass | null,
): Promise<void> {
  try {
    await db().insert(proposalEvents).values({
      proposalId,
      token,
      type,
      classification: classification ?? null,
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent") ?? "",
    });
  } catch (e) {
    console.error("[track] logProposalEvent failed:", e);
  }
}
