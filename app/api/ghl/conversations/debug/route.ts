import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Diagnostic endpoint — now dumps raw contact objects (PII). Require a logged-in user.
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  // Avatar discovery: for the first social (IG/FB/TikTok) conversation, dump the FULL raw
  // object keys + the raw contact object, so we can pinpoint exactly which field carries the
  // profile photo GHL stores. Read-only. Any value that looks like an image URL is flagged.
  const isSocial = (c: Record<string, unknown>) => {
    const t = String(c.type ?? "");
    const lmt = String(c.lastMessageType ?? "");
    return /INSTAGRAM|FB|TIKTOK|FACEBOOK/i.test(t) || /INSTAGRAM|FB|TIKTOK|FACEBOOK/i.test(lmt);
  };
  const socialSample = (all.conversations ?? []).find(isSocial) ?? null;
  const urlishFields = (obj: Record<string, unknown> | null | undefined) =>
    obj
      ? Object.entries(obj)
          .filter(([, v]) => typeof v === "string" && /^https?:\/\//i.test(v as string))
          .map(([k, v]) => ({ key: k, value: v }))
      : [];

  let contactRaw: Record<string, unknown> | null = null;
  let contactUrlish: Array<{ key: string; value: unknown }> = [];
  const contactId = socialSample?.contactId;
  if (contactId && typeof contactId === "string") {
    try {
      const cd = await ghl.get<{ contact: Record<string, unknown> }>(`/contacts/${contactId}`);
      contactRaw = cd.contact ?? (cd as Record<string, unknown>);
      contactUrlish = urlishFields(contactRaw);
    } catch (e) {
      contactRaw = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json({
    typeCounts,
    lastMsgTypeCounts,
    tiktokConversations: (tiktok.conversations ?? []).map(summarise),
    recentConversations: (all.conversations ?? []).map(summarise),
    avatarDiscovery: {
      socialConversationKeys: socialSample ? Object.keys(socialSample) : [],
      socialConversationUrlFields: urlishFields(socialSample),
      socialConversationRaw: socialSample,
      contactKeys: contactRaw ? Object.keys(contactRaw) : [],
      contactUrlFields: contactUrlish,
      contactRaw,
    },
  });
}
