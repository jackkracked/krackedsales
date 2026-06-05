/**
 * GET /api/inbox/queue
 *
 * Aggregates all conversations that are awaiting a reply across every channel
 * (GHL, Meta/Facebook/Instagram, TikTok), ranked by staleness.
 *
 * "Awaiting reply" means:
 *  GHL:     lastMessageDirection === "inbound" (or unreadCount > 0 as fallback)
 *  Meta/IG: conversation.updatedAt > last entry in platformReplies for that conversation
 *  TikTok:  unreadCount > 0
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { platformReplies, users } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { ghl, locationId } from "@/lib/ghl/client";
import { meta } from "@/lib/meta/client";
import { openGet, getTiktokSettings } from "@/lib/tiktok/client";

export const dynamic = "force-dynamic";

export interface QueueItem {
  id: string;           // conversationId / participantId / TikTok conversation_id
  channel: "GHL" | "Meta" | "TikTok";
  platform?: string;    // "facebook" | "instagram" for Meta
  type?: string;        // GHL conversation type: TYPE_SMS, TYPE_EMAIL, etc.
  contactName: string;
  lastMessage: string;
  updatedAt: string;
  staleDays: number;
  contactId?: string;   // GHL contactId if available
  recipientId?: string; // Meta: participant ID needed for sending
  assignedTo?: string;  // Assigned rep display name (resolved)
  assignedToId?: string; // Raw GHL user id of the assigned rep (for filtering)
}

interface GHLConversation {
  id: string;
  contactId?: string;
  contactName?: string;
  lastMessageBody?: string;
  lastMessageDirection?: "inbound" | "outbound";
  lastMessageType?: string;
  type?: string;
  unreadCount?: number;
  dateUpdated?: string;
  dateLastMessage?: string;
  lastMessageDate?: string;
  assignedTo?: string;
}

interface GHLConversationsResponse {
  conversations?: GHLConversation[];
}

interface MetaConv {
  id: string;
  participantId: string;
  participantName?: string;
  lastMessage: string;
  updatedAt: string;
  platform?: string;
}

interface MetaConversationsResponse {
  conversations?: MetaConv[];
}

interface TikTokConv {
  conversation_id: string;
  participants?: Array<{ open_id: string; display_name?: string }>;
  latest_message?: { text?: string };
  unread_count?: number;
  update_time?: number;
}

interface TikTokListResponse {
  data?: { conversations?: TikTokConv[] };
}

function staleDays(updatedAt: string): number {
  return Math.floor(
    (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24)
  );
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const items: QueueItem[] = [];

  // Build GHL user ID → rep name map for assigned rep display
  const ghlUserMap = new Map<string, string>();
  try {
    const teamRows = await db()
      .select({ ghlUserId: users.ghlUserId, name: users.name })
      .from(users)
      .where(eq(users.isActive, true));
    for (const r of teamRows) {
      if (r.ghlUserId) ghlUserMap.set(r.ghlUserId, r.name);
    }
  } catch {}

  // ── 1. GHL conversations ─────────────────────────────────────────────────────
  try {
    const loc = locationId();
    const data = await ghl.get<GHLConversationsResponse>(
      `/conversations/search?locationId=${loc}&limit=100&sortBy=last_message_date&sortOrder=desc`
    );
    for (const conv of data.conversations ?? []) {
      const isAwaiting =
        conv.lastMessageDirection === "inbound" || (conv.unreadCount ?? 0) > 0;
      if (!isAwaiting) continue;

      const updatedAt =
        conv.dateLastMessage ?? conv.dateUpdated ?? conv.lastMessageDate ?? new Date().toISOString();

      // Detect Instagram/Facebook DMs routed through GHL so the queue badge is accurate
      const msgType = (conv.lastMessageType ?? conv.type ?? "").toUpperCase();
      const isIg = msgType.includes("INSTAGRAM");
      const isFb = msgType.includes("_FB") || msgType === "TYPE_FB";

      items.push({
        id: conv.id,
        channel: "GHL",
        platform: isIg ? "instagram" : isFb ? "facebook" : undefined,
        type: conv.type ?? conv.lastMessageType ?? undefined,
        contactName: conv.contactName ?? "Unknown",
        lastMessage: conv.lastMessageBody ?? "",
        updatedAt,
        staleDays: staleDays(updatedAt),
        contactId: conv.contactId,
        assignedTo: conv.assignedTo ? (ghlUserMap.get(conv.assignedTo) ?? undefined) : undefined,
        assignedToId: conv.assignedTo ?? undefined,
      });
    }
  } catch (err) {
    console.error("[inbox/queue] GHL fetch failed:", err);
  }

  // ── 2. Meta conversations ────────────────────────────────────────────────────
  try {
    const data = await meta.get<MetaConversationsResponse>("/me/conversations?fields=id,messages{message,from,created_time},updated_time,participants&platform=MESSENGER&limit=100");

    // Fetch our last reply times for all meta conversation IDs in one query
    const metaConvIds = (data.conversations ?? []).map((c: MetaConv) => c.id);
    const replyRows = metaConvIds.length > 0
      ? await db()
          .select()
          .from(platformReplies)
          .where(
            and(
              inArray(platformReplies.platform, ["facebook", "instagram"]),
              inArray(platformReplies.externalId, metaConvIds)
            )
          )
      : [];

    const replyMap = new Map(replyRows.map((r) => [r.externalId, r.repliedAt]));

    for (const conv of data.conversations ?? []) {
      const updatedAt = conv.updatedAt ?? new Date().toISOString();
      const lastReply = replyMap.get(conv.id);
      const isAwaiting = !lastReply || new Date(updatedAt) > lastReply;
      if (!isAwaiting) continue;

      items.push({
        id: conv.id,
        channel: "Meta",
        platform: conv.platform ?? "facebook",
        contactName: conv.participantName ?? "Unknown",
        lastMessage: conv.lastMessage ?? "",
        updatedAt,
        staleDays: staleDays(updatedAt),
        recipientId: conv.participantId,
      });
    }
  } catch (err) {
    console.error("[inbox/queue] Meta fetch failed:", err);
  }

  // ── 3. TikTok conversations ──────────────────────────────────────────────────
  try {
    await getTiktokSettings(); // throws if not configured
    const res = (await openGet("/dm/conversation/list/", {
      fields: "conversation_id,participants,latest_message,unread_count,update_time",
      max_count: "50",
    })) as TikTokListResponse;

    for (const conv of res.data?.conversations ?? []) {
      if ((conv.unread_count ?? 0) === 0) continue;
      const updatedAt = conv.update_time
        ? new Date(conv.update_time * 1000).toISOString()
        : new Date().toISOString();
      const contactName =
        conv.participants?.find((p: { open_id: string; display_name?: string }) => p.open_id)?.display_name ?? "Unknown";

      items.push({
        id: conv.conversation_id,
        channel: "TikTok",
        contactName,
        lastMessage: conv.latest_message?.text ?? "",
        updatedAt,
        staleDays: staleDays(updatedAt),
      });
    }
  } catch (err) {
    // Non-fatal: TikTok may not be configured
    if (!(err as Error)?.message?.includes("not configured")) {
      console.error("[inbox/queue] TikTok fetch failed:", err);
    }
  }

  // Rank: stalest first (most urgent)
  items.sort((a, b) => b.staleDays - a.staleDays);

  // Personalised dashboard view (scope=mine): a rep sees only conversations
  // assigned to them; admins still see everything (full overview). The full
  // inbox page does NOT pass scope=mine, so it is unaffected.
  // Reps without a linked GHL user id fall back to all (can't scope safely).
  // TODO(phase 2): also include conversations the rep last responded to, once we
  // capture message authors (see lastRespondedBy plan).
  const scope = req.nextUrl.searchParams.get("scope");
  const isRep = user.role !== "admin";
  const visibleItems =
    scope === "mine" && isRep && user.ghlUserId
      ? items.filter((it) => it.assignedToId === user.ghlUserId)
      : items;

  return NextResponse.json({ items: visibleItems, total: visibleItems.length });
}
