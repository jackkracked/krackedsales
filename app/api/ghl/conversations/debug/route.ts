import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Require the internal secret so this isn't publicly accessible
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("x-internal-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const locId = locationId();

  const data = await ghl.get<{ conversations: Record<string, unknown>[] }>(
    `/conversations/search?locationId=${locId}&limit=20&sortBy=last_message_date&sortOrder=desc`
  );

  const convs = (data.conversations ?? []).map((c) => ({
    id: c.id,
    contactId: c.contactId,
    lastMessageBody: c.lastMessageBody,
    lastMessageDirection: c.lastMessageDirection,
    lastMessageDate: c.lastMessageDate,
    lastMessageType: c.lastMessageType,
    unreadCount: c.unreadCount,
  }));

  return NextResponse.json({ conversations: convs });
}
