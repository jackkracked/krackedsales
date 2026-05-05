import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import type { GHLConversation } from "@/lib/ghl/types";

export const dynamic = "force-dynamic";

interface GHLConversationsResponse {
  conversations: GHLConversation[];
  meta?: { total: number };
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

    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/ghl/conversations]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
