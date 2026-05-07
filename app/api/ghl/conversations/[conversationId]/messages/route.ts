import { NextRequest, NextResponse } from "next/server";
import { ghl } from "@/lib/ghl/client";
import type { GHLMessage } from "@/lib/ghl/types";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params;

  try {
    // Cast to any so all GHL fields (including emailMessageId) pass through
    const data = await ghl.get<{ messages: { messages: Array<GHLMessage & Record<string, unknown>> } }>(
      `/conversations/${conversationId}/messages`
    );
    // v2 returns { messages: { messages: [...] } }
    return NextResponse.json({ messages: data.messages?.messages ?? [] });
  } catch (err) {
    console.error("[GET /api/ghl/conversations/[id]/messages]", err);
    return NextResponse.json({ messages: [] }, { status: 500 });
  }
}

// Map GHL read-format channel types to the send API enum values.
// GHL send API valid values: SMS | Email | WhatsApp | IG | FB | Custom | Live_Chat
// Source: https://highlevel.stoplight.io/docs/integrations/0a75571b8b3bf-send-a-new-message
function toGHLSendType(type: string): string {
  const map: Record<string, string> = {
    TYPE_SMS:       "SMS",
    TYPE_EMAIL:     "Email",
    TYPE_INSTAGRAM: "IG",
    TYPE_FB:        "FB",
    TYPE_WHATSAPP:  "WhatsApp",
    TYPE_TIKTOK:    "TikTok",
    SMS:            "SMS",
    Email:          "Email",
    IG:             "IG",
    FB:             "FB",
    WhatsApp:       "WhatsApp",
    TikTok:         "TikTok",
    Custom:         "Custom",
    Live_Chat:      "Live_Chat",
  };
  return map[type] ?? "SMS";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params;
  const { message, type = "TYPE_SMS", contactId, subject, html, cc, bcc } = await req.json();

  if (!message?.trim() && !html?.trim()) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  if (!contactId) {
    return NextResponse.json({ error: "contactId is required" }, { status: 400 });
  }

  const sendType = toGHLSendType(type);

  try {
    // GHL send API: POST /conversations/messages (global endpoint).
    // The conversation-scoped path /conversations/{id}/messages is GET-only.
    // conversationId must be in the request body, not the URL path.
    const payload: Record<string, string> = {
      type: sendType,
      conversationId,
      contactId,
      message: (message ?? "").trim(),
    };

    // Email-specific fields — only forwarded when present
    if (sendType === "Email") {
      if (html?.trim()) payload.html = html.trim();
      if (subject?.trim()) payload.subject = subject.trim();
      if (cc?.trim()) payload.emailTo = cc.trim();   // GHL uses emailTo for CC-style addressing
      if (bcc?.trim()) payload.bcc = bcc.trim();
    }

    const data = await ghl.post(`/conversations/messages`, payload);
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/ghl/conversations/[id]/messages]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
