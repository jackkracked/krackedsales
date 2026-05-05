import { NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface RawConversation {
  id: string;
  contactId: string;
  lastMessageBody?: string;
  lastMessageDate?: string;
  lastMessageDirection?: string;
  unreadCount: number;
}

interface RawMessage {
  id: string;
  direction?: string;
  messageType?: string;
  body?: string;
  dateAdded: string;
}

/** Returns true if this message is a GHL system/activity event, not a real human message. */
function isActivityMessage(msg: RawMessage): boolean {
  const t = (msg.messageType ?? "").toUpperCase();
  return t.includes("ACTIVITY") || t.includes("NOTE") || t === "";
}

/** Returns true if the body looks like a GHL system event rather than a real message.
 *  GHL sometimes prefixes these with emoji (e.g. "🔄 Moved to ...") so we use
 *  substring matches rather than anchored ^ patterns. */
function bodyLooksLikeActivity(body: string): boolean {
  if (!body) return true;
  const b = body.toLowerCase();
  return (
    b.includes("moved to ") ||
    b.includes("pipeline stage") ||
    b.includes("added a note") ||
    b.includes("added note") ||
    b.includes("created opportunity") ||
    b.includes("contact created") ||
    b.includes("opportunity created") ||
    b.includes("opportunity status")
  );
}

export async function GET() {
  try {
    const locId = locationId();

    // Fetch recent conversations sorted by last message date.
    // GHL's conversation search API caps at 100 per request — using 200 causes
    // a silent failure (empty or error response) which is caught below and returns [].
    const data = await ghl.get<{ conversations: RawConversation[] }>(
      `/conversations/search?locationId=${locId}&limit=100&sortBy=last_message_date&sortOrder=desc`
    );

    if (!data || !Array.isArray(data.conversations)) {
      console.error("[awaiting-reply] unexpected GHL response shape:", JSON.stringify(data).slice(0, 200));
      return NextResponse.json({ contactIds: [] });
    }

    const conversations: RawConversation[] = data.conversations ?? [];
    console.log(`[awaiting-reply] fetched ${conversations.length} conversations`);

    const awaitingContactIds = new Set<string>();

    // Conversations that need a secondary messages fetch to determine true direction
    const needsCheck: RawConversation[] = [];

    for (const conv of conversations) {
      if (!conv.contactId) continue;

      const dir = conv.lastMessageDirection;
      const body = conv.lastMessageBody ?? "";
      const unread = conv.unreadCount;
      const isActivity = bodyLooksLikeActivity(body);

      // Log every conversation so we can debug
      console.log(`[awaiting-reply] conv=${conv.id} dir=${dir} unread=${unread} activity=${isActivity} body="${body.slice(0, 60)}"`);

      // Obvious: GHL says inbound was last → awaiting reply
      if (dir === "inbound") {
        awaitingContactIds.add(conv.contactId);
        continue;
      }

      // Obvious: unread messages exist → awaiting reply (haven't even read it yet)
      if (unread > 0) {
        awaitingContactIds.add(conv.contactId);
        continue;
      }

      // Ambiguous: direction is outbound but last message body looks like a GHL
      // activity event (stage change, note, etc.) — could be masking an inbound reply.
      // Limit secondary checks to conversations active in the last 30 days.
      const lastDate = conv.lastMessageDate ? new Date(conv.lastMessageDate).getTime() : 0;
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      if (isActivity && lastDate > thirtyDaysAgo) {
        needsCheck.push(conv);
      }
    }

    // Secondary check: fetch actual messages for ambiguous conversations.
    // Cap at 30 to stay within rate limits — they're ordered by recency so we
    // prioritise the most recently active conversations.
    const toCheck = needsCheck.slice(0, 30);

    console.log(`[awaiting-reply] needsCheck count: ${toCheck.length}`);

    await Promise.allSettled(
      toCheck.map(async (conv) => {
        try {
          const msgData = await ghl.get<{ messages: { messages: RawMessage[] } }>(
            `/conversations/${conv.id}/messages?limit=20`
          );
          const messages: RawMessage[] = msgData.messages?.messages ?? [];

          console.log(`[awaiting-reply] conv=${conv.id} messages count=${messages.length}`);
          messages.slice(0, 5).forEach((m) => {
            console.log(`  msg id=${m.id} type=${m.messageType} dir=${m.direction} body="${(m.body ?? "").slice(0, 40)}"`);
          });

          // Find the last message that isn't an activity/system event
          const lastReal = [...messages]
            .sort((a, b) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime())
            .find((m) => !isActivityMessage(m));

          console.log(`[awaiting-reply] conv=${conv.id} lastReal type=${lastReal?.messageType} dir=${lastReal?.direction}`);

          if (lastReal?.direction === "inbound") {
            awaitingContactIds.add(conv.contactId);
          }
        } catch (err) {
          console.error(`[awaiting-reply] error fetching messages for conv=${conv.id}:`, err);
        }
      })
    );

    return NextResponse.json({ contactIds: Array.from(awaitingContactIds) });
  } catch (err) {
    console.error("[awaiting-reply] TOP-LEVEL ERROR — returning empty contactIds:", err);
    return NextResponse.json({ contactIds: [] });
  }
}
