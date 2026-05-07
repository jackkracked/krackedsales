import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { commentLeads } from "@/lib/db/schema";
import { ghl } from "@/lib/ghl/client";
import type { TimelineEvent } from "@/lib/contacts/types";

export const dynamic = "force-dynamic";

interface GHLMessage {
  id: string;
  body?: string;
  direction?: "inbound" | "outbound";
  messageType?: string;
  dateAdded: string;
  meta?: { email?: { subject?: string } };
}

interface GHLNote {
  id: string;
  body: string;
  dateAdded?: string;
  createdAt?: string;
}

function isActivityMessage(msg: GHLMessage): boolean {
  const t = (msg.messageType ?? "").toUpperCase();
  if (t.includes("ACTIVITY") || t.includes("NOTE") || t === "") return true;
  const b = (msg.body ?? "").toLowerCase();
  return (
    b.includes("moved to ") ||
    b.includes("pipeline stage") ||
    b.includes("added a note") ||
    b.includes("created opportunity") ||
    b.includes("contact created")
  );
}

function msgToEvent(msg: GHLMessage): TimelineEvent {
  const isEmail = (msg.messageType ?? "").includes("EMAIL");
  const dir = msg.direction ?? "outbound";
  let type: TimelineEvent["type"];
  if (isEmail) {
    type = dir === "inbound" ? "email_received" : "email_sent";
  } else {
    type = dir === "inbound" ? "message_received" : "message_sent";
  }

  const subject = msg.meta?.email?.subject;
  return {
    id: msg.id,
    type,
    title: subject ? `Email: ${subject}` : dir === "inbound" ? "Message received" : "Message sent",
    body: msg.body,
    occurredAt: msg.dateAdded,
  };
}

async function ghlTimeline(contactId: string, contactCreatedAt: string): Promise<TimelineEvent[]> {
  const events: TimelineEvent[] = [];

  // Lead captured — use the createdAt passed from the client (from opportunity.createdAt)
  // rather than fetching it again. GHL's contact endpoint often lacks the createdAt field.
  events.push({
    id: `lead_${contactId}`,
    type: "lead_captured",
    title: "Lead captured from Meta ad",
    occurredAt: contactCreatedAt,
  });

  // Notes
  try {
    const data = await ghl.get<{ notes: GHLNote[] }>(`/contacts/${contactId}/notes/`);
    for (const note of data.notes ?? []) {
      events.push({
        id: `note_${note.id}`,
        type: "note_added",
        title: "Note added",
        body: note.body,
        occurredAt: note.createdAt ?? note.dateAdded ?? new Date().toISOString(),
      });
    }
  } catch { /* ignore */ }

  // Messages — get conversation first
  try {
    const convData = await ghl.get<{ conversations: Array<{ id: string }> }>(
      `/conversations/search?contactId=${contactId}&limit=10`
    );
    const conv = convData.conversations?.[0];
    if (conv) {
      const msgData = await ghl.get<{ messages: { messages: GHLMessage[] } }>(
        `/conversations/${conv.id}/messages?limit=100`
      );
      const messages = msgData.messages?.messages ?? [];
      for (const msg of messages) {
        if (!isActivityMessage(msg) && msg.body?.trim()) {
          events.push(msgToEvent(msg));
        }
      }
    }
  } catch { /* ignore */ }

  return events;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const createdAt = req.nextUrl.searchParams.get("createdAt") ?? new Date().toISOString();

  try {
    let events: TimelineEvent[] = [];

    if (id.startsWith("ghl_")) {
      const contactId = id.slice(4);
      events = await ghlTimeline(contactId, createdAt);
    } else if (id.startsWith("cl_")) {
      const clId = id.slice(3);
      const database = db();
      const [cl] = await database
        .select()
        .from(commentLeads)
        .where(eq(commentLeads.id, clId))
        .limit(1);

      if (cl) {
        events.push({
          id: `cl_created_${cl.id}`,
          type: "lead_captured",
          title: `Comment lead captured from ${cl.platform}`,
          body: cl.commentText,
          occurredAt: cl.createdAt.toISOString(),
        });
        if (cl.contactedAt) {
          events.push({
            id: `cl_contacted_${cl.id}`,
            type: "contacted",
            title: "Contacted",
            occurredAt: cl.contactedAt.toISOString(),
          });
        }
      }
    }

    // Sort oldest-first
    events.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());

    return NextResponse.json({ events });
  } catch (err) {
    console.error("[GET /api/contacts/[id]/timeline]", err);
    return NextResponse.json({ events: [] }, { status: 500 });
  }
}
