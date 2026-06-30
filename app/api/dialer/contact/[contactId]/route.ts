import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { ghl, locationId } from "@/lib/ghl/client";
import { getCustomFieldMap } from "@/lib/ghl/custom-fields";
import { resolveCustomFields, type FieldDef } from "@/lib/ghl/qualification";
import { db } from "@/lib/db";
import { calls, callInsights } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/** Relative time like "2d ago" from an ISO/epoch date. */
function rel(d: string | number | Date | null | undefined): string {
  if (!d) return "";
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

interface GHLContact {
  firstName?: string; lastName?: string; name?: string; companyName?: string;
  email?: string; phone?: string; tags?: string[];
  customFields?: Array<{ id: string; value?: unknown; field_value?: unknown }>;
  dateAdded?: string;
}

/**
 * GET /api/dialer/contact/[contactId] — assemble the full contact view the dialer
 * cockpit shows, from real GHL + our DB. Every source is best-effort so a single
 * failure degrades to an empty section instead of breaking the whole load.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ contactId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { contactId } = await params;

  const [contactRes, fieldMapRes, notesRes, lastCallRes, messagesRes] = await Promise.allSettled([
    ghl.get<{ contact: GHLContact }>(`/contacts/${contactId}`),
    getCustomFieldMap(),
    ghl.get<{ notes: Array<{ body?: string; userId?: string; dateAdded?: string; createdAt?: string }> }>(`/contacts/${contactId}/notes`),
    db().select().from(calls).leftJoin(callInsights, eq(callInsights.callId, calls.id))
      .where(eq(calls.contactId, contactId)).orderBy(desc(calls.startedAt)).limit(1),
    assembleMessages(contactId),
  ]);

  const contact = contactRes.status === "fulfilled" ? (contactRes.value.contact ?? {}) : {};
  const name = contact.name?.trim() || [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() || "Unknown contact";

  // Qualification from custom fields + definitions.
  let qualification: { q: string; a: string }[] = [];
  try {
    if (fieldMapRes.status === "fulfilled") {
      const defs: Record<string, FieldDef> = {};
      for (const [id, d] of fieldMapRes.value) defs[id] = { name: d.name, fieldKey: d.fieldKey, folder: d.folder };
      qualification = resolveCustomFields(contact.customFields ?? [], defs).map((q) => ({ q: q.label, a: q.cleanedUrl ?? q.value }));
    }
  } catch { /* leave empty */ }

  // Notes.
  const notes = notesRes.status === "fulfilled"
    ? (notesRes.value.notes ?? []).slice(0, 6).map((n) => ({ author: "Note", body: (n.body ?? "").trim(), time: rel(n.dateAdded ?? n.createdAt) })).filter((n) => n.body)
    : [];

  // Last call (DB insights).
  let lastCall: { when: string; summary: string; sentiment: "positive" | "neutral" | "negative"; objection: string | null } | undefined;
  if (lastCallRes.status === "fulfilled" && lastCallRes.value[0]) {
    const row = lastCallRes.value[0] as { calls: typeof calls.$inferSelect; call_insights: typeof callInsights.$inferSelect | null };
    const ins = row.call_insights;
    const summary = ins?.suggestedNotes || ins?.wantsText || row.calls.fathomSummary?.slice(0, 240) || "Previous call on record.";
    const sentiment = ins?.sentimentLabel === "positive" || ins?.sentimentLabel === "negative" ? ins.sentimentLabel : "neutral";
    lastCall = { when: rel(row.calls.startedAt), summary, sentiment, objection: ins?.objectionsText || null };
  }

  const messages = messagesRes.status === "fulfilled" ? messagesRes.value : [];

  const tags = Array.isArray(contact.tags) ? contact.tags.slice(0, 6) : [];
  const timeline = contact.dateAdded ? [{ label: "Contact created", time: rel(contact.dateAdded) }] : [];

  return NextResponse.json({
    contact: {
      id: contactId,
      name,
      company: contact.companyName?.trim() || "",
      phone: contact.phone ?? "",
      email: contact.email ?? "",
      stage: tags[0] ?? "Lead",
      tags,
      attempts: 0,
      qualification,
      messages,
      notes,
      timeline,
      lastCall,
    },
  });
}

interface DialerMessage {
  id?: string;
  dir: "in" | "out";
  body: string;
  time: string;
  messageType?: string;
  subject?: string;
  emailMessageId?: string;
}

async function assembleMessages(contactId: string): Promise<DialerMessage[]> {
  try {
    const conv = await ghl.get<{ conversations?: Array<{ id: string }> }>(
      `/conversations/search?locationId=${locationId()}&contactId=${contactId}&limit=1`,
    );
    const convId = conv.conversations?.[0]?.id;
    if (!convId) return [];
    const res = await ghl.get<{ messages?: { messages?: Array<{
      id?: string; direction?: string; body?: string; message?: string; dateAdded?: string;
      messageType?: string; emailMessageId?: string; meta?: { email?: { subject?: string; messageIds?: string[] } };
    }> } }>(
      `/conversations/${convId}/messages`,
    );
    const list = res.messages?.messages ?? [];
    return list.slice(0, 8).reverse().map((m) => ({
      id: m.id,
      dir: (m.direction === "inbound" ? "in" : "out") as "in" | "out",
      body: (m.body || m.message || "").trim(),
      time: rel(m.dateAdded),
      messageType: m.messageType,
      subject: m.meta?.email?.subject,
      emailMessageId: m.emailMessageId ?? m.meta?.email?.messageIds?.[0],
    // Keep emails even when their text body is empty (they render from fetched HTML).
    })).filter((m) => m.body || m.messageType === "TYPE_EMAIL");
  } catch {
    return [];
  }
}
