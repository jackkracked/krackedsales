import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import type { GHLConversation } from "@/lib/ghl/types";
import { db } from "@/lib/db";
import { conversationFlags } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

interface GHLConversationsResponse {
  conversations: GHLConversation[];
  meta?: { total: number };
}

// GHL doesn't return the contact photo under a single stable key across channels
// (Instagram/Facebook social contacts carry a profile picture, but the field name
// varies). Normalise any of the plausible keys to `avatarUrl` so the inbox can render
// the real photo GHL has — matching what GHL's own UI shows. Harmless when absent.
const AVATAR_KEYS = [
  "avatarUrl", "avatar", "profilePhoto", "profilePicture", "photo",
  "contactPhoto", "userProfilePhoto", "userProfileImg", "profilePicUrl", "image",
] as const;

function pickAvatarUrl(raw: Record<string, unknown>): string | undefined {
  for (const key of AVATAR_KEYS) {
    const v = raw[key];
    if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
  }
  return undefined;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const typeFilter = url.searchParams.get("type");
  const contactId = url.searchParams.get("contactId");
  const unreadOnly = url.searchParams.get("unreadOnly") === "true";
  const limit = url.searchParams.get("limit") ?? "25";
  const page = parseInt(url.searchParams.get("page") ?? "1", 10);

  try {
    const params = new URLSearchParams({
      locationId: locationId(),
      limit,             // pass through from client (100 when filtering unread)
      page: String(page),
      sortBy: "last_message_date",
      sortOrder: "desc",
    });

    // GHL v2 conversation objects use the full TYPE_* prefix format.
    // Pass the type filter through as-is (GHL internal format), but map
    // any short aliases we use internally.
    const TYPE_MAP: Record<string, string> = {
      TYPE_SMS:       "TYPE_SMS",
      TYPE_PHONE:     "TYPE_PHONE",
      TYPE_EMAIL:     "TYPE_EMAIL",
      TYPE_INSTAGRAM: "TYPE_INSTAGRAM",
      TYPE_FB:        "TYPE_FB",
      TYPE_WHATSAPP:  "TYPE_WHATSAPP",
      TYPE_TIKTOK:    "TYPE_TIKTOK",
      // short aliases → full format
      SMS:       "TYPE_SMS",
      Email:     "TYPE_EMAIL",
      Instagram: "TYPE_INSTAGRAM",
      FB:        "TYPE_FB",
      WhatsApp:  "TYPE_WHATSAPP",
      TikTok:    "TYPE_TIKTOK",
    };
    if (typeFilter) params.set("type", TYPE_MAP[typeFilter] ?? typeFilter);
    if (contactId) params.set("contactId", contactId);
    if (unreadOnly) params.set("unreadOnly", "true");

    const data = await ghl.get<GHLConversationsResponse>(
      `/conversations/search?${params.toString()}`
    );

    // Surface the contact photo GHL holds (Instagram/Facebook avatars) under a stable key.
    data.conversations = (data.conversations ?? []).map((c) => {
      if (c.avatarUrl) return c;
      const found = pickAvatarUrl(c as unknown as Record<string, unknown>);
      return found ? { ...c, avatarUrl: found } : c;
    });

    // Merge our per-conversation user intent (starred / read override / soft-delete) from
    // conversation_flags — the source of truth that the GHL mirror sync never touches. Drives the
    // Starred filter, the read/unread state, and hides deleted conversations.
    try {
      const ids = (data.conversations ?? []).map((c) => c.id).filter(Boolean);
      if (ids.length) {
        const rows = await db()
          .select({
            id: conversationFlags.conversationId,
            starred: conversationFlags.starred,
            readState: conversationFlags.readState,
            deletedAt: conversationFlags.deletedAt,
          })
          .from(conversationFlags)
          .where(inArray(conversationFlags.conversationId, ids));
        const flagMap = new Map(rows.map((r) => [r.id, r]));
        data.conversations = (data.conversations ?? [])
          .map((c) => {
            const f = flagMap.get(c.id);
            if (!f) return { ...c, starred: false };
            // Read override: "read" forces the badge off; "unread" forces it on (re-bold).
            let unreadCount = c.unreadCount ?? 0;
            if (f.readState === "read") unreadCount = 0;
            else if (f.readState === "unread") unreadCount = Math.max(unreadCount, 1);
            return { ...c, starred: !!f.starred, unreadCount, deletedAt: f.deletedAt ?? null };
          })
          // Hide soft-deleted conversations UNLESS a new message arrived after the delete
          // (GHL-consistent: a deleted thread reappears when the contact messages again).
          .filter((c) => {
            const deletedAt = (c as { deletedAt?: Date | string | null }).deletedAt;
            if (!deletedAt) return true;
            const lastMsg = c.lastMessageDate ? new Date(c.lastMessageDate).getTime() : 0;
            return lastMsg > new Date(deletedAt).getTime();
          })
          // Strip the internal deletedAt before returning to the client.
          .map((c) => {
            const clone = { ...c } as GHLConversation & { deletedAt?: unknown };
            delete clone.deletedAt;
            return clone;
          });
      } else {
        data.conversations = (data.conversations ?? []).map((c) => ({ ...c, starred: false }));
      }
    } catch (e) {
      console.error("[GET /api/ghl/conversations] flags merge failed:", e);
    }

    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/ghl/conversations]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
