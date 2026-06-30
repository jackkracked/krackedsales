import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { socialLeads } from "@/lib/db/schema";
import { eq, isNull, and } from "drizzle-orm";
import { ghl, locationId } from "@/lib/ghl/client";
import { meta } from "@/lib/meta/client";

export const dynamic = "force-dynamic";

type Channel = "platform" | "SMS" | "Live_Chat" | "Email";

interface SendBody {
  channel: Channel;
  message: string;
}

/** GHL contact search response */
interface GHLContactSearchResult {
  contacts: Array<{ id: string; phone?: string; email?: string }>;
}

/** GHL conversation search response */
interface GHLConversationSearchResult {
  conversations: Array<{ id: string }>;
}

/** Find an existing GHL contact by query (phone or email), or create one */
async function findOrCreateGHLContact(lead: {
  name: string;
  phone?: string | null;
  email?: string | null;
  commenterId?: string | null;
}): Promise<string> {
  const locId = locationId();
  const query = lead.phone ?? lead.email ?? "";

  // Try to find existing contact
  const search = await ghl.get<GHLContactSearchResult>(
    `/contacts/?locationId=${locId}&query=${encodeURIComponent(query)}&limit=1`
  ).catch(() => null);

  const existing = search?.contacts?.[0];
  if (existing) return existing.id;

  // Create new contact
  const nameParts = lead.name.trim().split(" ");
  const firstName = nameParts[0] ?? lead.name;
  const lastName = nameParts.slice(1).join(" ") || undefined;

  const created = await ghl.post<{ contact: { id: string } }>("/contacts/", {
    locationId: locId,
    firstName,
    lastName,
    ...(lead.phone && { phone: lead.phone }),
    ...(lead.email && { email: lead.email }),
    source: "Comment Lead",
  });

  return created.contact.id;
}

/** Find or create a GHL conversation for a contact */
async function findOrCreateGHLConversation(contactId: string): Promise<string> {
  const locId = locationId();

  const search = await ghl.get<GHLConversationSearchResult>(
    `/conversations/search?locationId=${locId}&contactId=${contactId}&limit=1`
  ).catch(() => null);

  const existing = search?.conversations?.[0];
  if (existing) return existing.id;

  // Create new conversation
  const created = await ghl.post<{ conversation: { id: string } }>("/conversations/", {
    locationId: locId,
    contactId,
  });

  return created.conversation.id;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body: SendBody = await req.json().catch(() => ({})) as SendBody;
  const { channel, message } = body;

  if (!channel || !message?.trim()) {
    return NextResponse.json({ error: "channel and message are required" }, { status: 400 });
  }

  // Load the lead from DB
  const client = await db();
  const rows = await client.select().from(socialLeads).where(eq(socialLeads.id, id));
  const lead = rows[0];

  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  /** Mark this lead as contacted if it hasn't been already */
  async function markContacted() {
    await client.update(socialLeads)
      .set({ contactedAt: new Date() })
      .where(and(eq(socialLeads.id, id), isNull(socialLeads.contactedAt)));
  }

  try {
    // ── Platform (FB/IG private reply) ─────────────────────────────────────
    if (channel === "platform") {
      const commentId = lead.commentId;
      const recipientId = lead.commenterId;

      if (!recipientId) {
        return NextResponse.json({ error: "No commenter ID on this lead" }, { status: 400 });
      }

      if (lead.platform === "facebook" && commentId) {
        const res = await meta.post<{ id: string }>(`/${commentId}/private_replies`, {
          message: message.trim(),
        });
        await markContacted();
        return NextResponse.json({ messageId: res.id, channel: "platform" });
      }

      // Fallback: direct Messenger/IG DM
      const res = await meta.post<{ message_id: string }>("/me/messages", {
        recipient: { id: recipientId },
        message: { text: message.trim() },
      });
      await markContacted();
      return NextResponse.json({ messageId: res.message_id, channel: "platform" });
    }

    // ── SMS / Live_Chat / Email (via GHL) ──────────────────────────────────
    if (channel === "SMS" || channel === "Live_Chat" || channel === "Email") {
      const contactId = await findOrCreateGHLContact({
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        commenterId: lead.commenterId,
      });

      const conversationId = await findOrCreateGHLConversation(contactId);

      await ghl.post("/conversations/messages", {
        type: channel === "Email" ? "Email" : channel,
        conversationId,
        contactId,
        message: message.trim(),
      });

      await markContacted();
      return NextResponse.json({ conversationId, contactId, channel });
    }

    return NextResponse.json({ error: "Unknown channel" }, { status: 400 });
  } catch (err) {
    console.error(`[POST /api/comment-leads/${id}/message]`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send" },
      { status: 500 }
    );
  }
}
