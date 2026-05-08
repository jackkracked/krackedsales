import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const locId = locationId();

  // All recent conversations — dump all fields to diagnose type values
  const all = await ghl.get<{ conversations: Record<string, unknown>[] }>(
    `/conversations/search?locationId=${locId}&limit=50&sortBy=last_message_date&sortOrder=desc`
  );

  // Also try fetching specifically with TYPE_TIKTOK filter
  const tiktok = await ghl.get<{ conversations: Record<string, unknown>[] }>(
    `/conversations/search?locationId=${locId}&limit=50&type=TYPE_TIKTOK&sortBy=last_message_date&sortOrder=desc`
  ).catch(() => ({ conversations: [] }));

  const summarise = (c: Record<string, unknown>) => ({
    id: c.id,
    type: c.type,
    lastMessageType: c.lastMessageType,
    fullName: c.fullName,
    unreadCount: c.unreadCount,
    lastMessageDate: c.lastMessageDate,
    lastMessageBody: typeof c.lastMessageBody === "string"
      ? c.lastMessageBody.slice(0, 60)
      : c.lastMessageBody,
  });

  // Count by type
  const typeCounts: Record<string, number> = {};
  const lastMsgTypeCounts: Record<string, number> = {};
  for (const c of all.conversations ?? []) {
    const t = String(c.type ?? "unknown");
    const lmt = String(c.lastMessageType ?? "unknown");
    typeCounts[t] = (typeCounts[t] ?? 0) + 1;
    lastMsgTypeCounts[lmt] = (lastMsgTypeCounts[lmt] ?? 0) + 1;
  }

  return NextResponse.json({
    typeCounts,
    lastMsgTypeCounts,
    tiktokConversations: (tiktok.conversations ?? []).map(summarise),
    recentConversations: (all.conversations ?? []).map(summarise),
  });
}
