import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { sendGhlMessage, toGHLSendType } from "@/lib/ghl/send";
import { logActivity } from "@/lib/activity/logger";
import { updateLastResponder } from "@/lib/ghl/sync";

export const dynamic = "force-dynamic";

interface Target {
  type: string;              // TYPE_SMS | TYPE_EMAIL | TYPE_INSTAGRAM | TYPE_FB | TYPE_TIKTOK
  conversationId?: string;   // present for the channel the thread is currently on
}

/**
 * Cross-channel send: one message, one or more channels. Compose once, "catch them everywhere."
 * Each channel goes through GHL's own send path (same as replying in GHL), so every channel behaves
 * identically to native. Per-channel results so the UI can show exactly what landed and what didn't.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { contactId, message, subject, html, targets, attachments } = (await req.json().catch(() => ({}))) as {
    contactId?: string;
    message?: string;
    subject?: string;
    html?: string;
    targets?: Target[];
    attachments?: string[];
  };

  const cleanAttachments = (Array.isArray(attachments) ? attachments : []).filter(
    (u): u is string => typeof u === "string" && /^https?:\/\//i.test(u),
  );

  if (!contactId) return NextResponse.json({ error: "contactId is required" }, { status: 400 });
  if (!Array.isArray(targets) || targets.length === 0) {
    return NextResponse.json({ error: "At least one channel is required" }, { status: 400 });
  }
  // A message needs text OR at least one attachment (an image-only reply is valid).
  if (!message?.trim() && !html?.trim() && cleanAttachments.length === 0) {
    return NextResponse.json({ error: "Message or attachment is required" }, { status: 400 });
  }

  // De-dupe channels (keep the first, which carries the conversationId if any).
  const seen = new Set<string>();
  const unique = targets.filter((t) => t?.type && !seen.has(t.type) && seen.add(t.type));

  const results = await Promise.all(
    unique.map(async (t) => {
      try {
        await sendGhlMessage({
          type: t.type,
          contactId,
          message,
          subject,
          html,
          conversationId: t.conversationId,
          attachments: cleanAttachments,
        });
        if (user.ghlUserId && t.conversationId) {
          await updateLastResponder(t.conversationId, user.ghlUserId, "api", new Date()).catch(() => {});
        }
        return { type: t.type, channel: toGHLSendType(t.type), ok: true as const };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[POST /api/inbox/send] ${t.type} failed:`, msg);
        return { type: t.type, channel: toGHLSendType(t.type), ok: false as const, error: msg };
      }
    }),
  );

  const anyOk = results.some((r) => r.ok);
  if (anyOk) {
    logActivity({
      userId: user.id,
      userName: user.name ?? "Unknown",
      userEmail: user.email ?? "unknown@unknown.com",
      action: "message.sent",
      entityType: "contact",
      entityId: contactId,
      metadata: { channels: results.filter((r) => r.ok).map((r) => r.channel).join(", ") },
    });
  }

  return NextResponse.json({ results, ok: anyOk }, { status: anyOk ? 200 : 502 });
}
