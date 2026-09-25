/**
 * lib/inbox/mirror-source.ts
 *
 * Mirror-backed replacement for the inbox queue's GHL conversation leg. GHL's
 * /conversations/search is hard-capped at 100 (cursor ignored); local_conversations is a
 * webhook-accumulated superset. The one subtlety: the awaiting-reply filter needs
 * lastMessageDirection/lastMessageType, which the webhook does NOT write into the conversation
 * rawData. We source those from the newest local_messages row per conversation (webhooks DO
 * persist per-message direction/type), then fall back to full-sync rawData, then unreadCount.
 */
import { desc, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { localConversations, localMessages } from "@/lib/db/schema";

export interface MirrorQueueConv {
  id: string;
  contactId?: string;
  contactName?: string;
  lastMessageBody?: string;
  lastMessageDirection?: "inbound" | "outbound";
  lastMessageType?: string;
  type?: string;
  unreadCount?: number;
  lastMessageDate?: string;
  assignedTo?: string;
}

export async function getGhlQueueConvsFromMirror(limit = 500): Promise<MirrorQueueConv[]> {
  const database = db();
  const convs = await database
    .select({
      id: localConversations.id,
      contactId: localConversations.contactId,
      contactName: localConversations.contactName,
      lastMessageBody: localConversations.lastMessageBody,
      lastMessageDate: localConversations.lastMessageDate,
      unreadCount: localConversations.unreadCount,
      type: localConversations.type,
      assignedTo: localConversations.assignedTo,
      rawData: localConversations.rawData,
    })
    .from(localConversations)
    .orderBy(sql`${localConversations.lastMessageDate} desc nulls last`)
    .limit(limit);

  const ids = convs.map((c) => c.id);
  const newestByConv = new Map<string, { direction: string | null; type: string | null }>();
  if (ids.length > 0) {
    // Newest message per conversation → authoritative direction + type (webhook persists these
    // per-message even when the conversation record does not carry them).
    const msgs = await database
      .selectDistinctOn([localMessages.conversationId], {
        conversationId: localMessages.conversationId,
        direction: localMessages.direction,
        type: localMessages.type,
      })
      .from(localMessages)
      .where(inArray(localMessages.conversationId, ids))
      .orderBy(localMessages.conversationId, desc(localMessages.messageDate));
    for (const m of msgs) newestByConv.set(m.conversationId, { direction: m.direction, type: m.type });
  }

  return convs.map((c) => {
    const raw = (c.rawData ?? {}) as { lastMessageDirection?: string; lastMessageType?: string };
    const newest = newestByConv.get(c.id);
    const direction = (newest?.direction ?? raw.lastMessageDirection ?? undefined) as
      | "inbound"
      | "outbound"
      | undefined;
    return {
      id: c.id,
      contactId: c.contactId ?? undefined,
      contactName: c.contactName ?? undefined,
      lastMessageBody: c.lastMessageBody ?? undefined,
      lastMessageDirection: direction,
      lastMessageType: newest?.type ?? raw.lastMessageType ?? undefined,
      type: c.type ?? undefined,
      unreadCount: c.unreadCount ?? 0,
      lastMessageDate: c.lastMessageDate ? c.lastMessageDate.toISOString() : undefined,
      assignedTo: c.assignedTo ?? undefined,
    };
  });
}
