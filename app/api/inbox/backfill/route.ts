import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { messageIndex } from "@/lib/db/schema";
import { ghl, locationId } from "@/lib/ghl/client";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CHANNEL_MAP: Record<string, string> = {
  TYPE_SMS: "sms",
  TYPE_PHONE: "sms",
  TYPE_EMAIL: "email",
  TYPE_TIKTOK: "tiktok",
  TYPE_INSTAGRAM: "meta",
  TYPE_FB: "meta",
};

function ghlTypeToChannel(type: string): string {
  return CHANNEL_MAP[type] ?? "ghl";
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { maxConversations = 200 } = await req.json().catch(() => ({}));

  let conversationsFetched = 0;
  let messagesIndexed = 0;
  let errors = 0;

  try {
    // Fetch conversations page by page
    const locId = locationId();
    let page = 1;
    let hasMore = true;

    while (hasMore && conversationsFetched < maxConversations) {
      const data = await ghl.get<{
        conversations: Array<{
          id: string; contactId?: string; fullName?: string; type?: string;
          contact?: { id?: string; name?: string };
        }>;
        meta?: { nextPageUrl?: string };
      }>(`/conversations/search?locationId=${locId}&limit=20&page=${page}&sortBy=last_message_date&sortOrder=desc`);

      const convos = data.conversations ?? [];
      if (convos.length === 0) break;

      for (const convo of convos) {
        if (conversationsFetched >= maxConversations) break;
        conversationsFetched++;

        try {
          const msgData = await ghl.get<{
            messages: { messages: Array<{ id: string; body?: string; direction?: string; messageType?: string; dateAdded?: string }> };
          }>(`/conversations/${convo.id}/messages?limit=50`);

          const msgs = msgData.messages?.messages ?? [];
          const contactName = convo.fullName ?? convo.contact?.name ?? null;
          const contactId = convo.contactId ?? convo.contact?.id ?? null;
          const channel = ghlTypeToChannel(convo.type ?? "");

          const rows = msgs
            .filter((m) => m.body && m.body.trim().length > 0)
            .map((m) => ({
              id: m.id,
              conversationId: convo.id,
              contactId,
              contactName,
              body: m.body!.trim(),
              channel,
              direction: m.direction ?? null,
              dateAdded: m.dateAdded ? new Date(m.dateAdded) : null,
            }));

          if (rows.length > 0) {
            await db()
              .insert(messageIndex)
              .values(rows)
              .onConflictDoNothing();
            messagesIndexed += rows.length;
          }
        } catch {
          errors++;
        }
      }

      hasMore = !!data.meta?.nextPageUrl && convos.length === 20;
      page++;
    }

    return NextResponse.json({ conversationsFetched, messagesIndexed, errors });
  } catch (err) {
    console.error("[POST /api/inbox/backfill]", err);
    return NextResponse.json({ error: "Backfill failed" }, { status: 500 });
  }
}
