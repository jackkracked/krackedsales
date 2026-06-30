import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { socialLeads } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const FIELDS = ["email", "phone", "website"] as const;
type Field = (typeof FIELDS)[number];

function fieldSet(field: Field, value: string) {
  return field === "email"
    ? { email: value }
    : field === "phone"
    ? { phone: value }
    : { website: value };
}

/**
 * Attach a single detected contact field (email / phone / website) to a Meta social lead,
 * straight from the inbox message thread. This NEVER promotes the lead into GHL (it does not
 * set demoStartedAt / ghlContactId) — promotion only happens on demo submit, keeping the
 * demo-makes-a-lead gate intact. Two ways to identify the lead:
 *   - commentLeadId: an existing social_leads row (a comment lead, or a DM that already has one).
 *   - platform + participantId (+ name): a raw DM with no row yet → upsert by identity.
 * (GHL-backed conversations do NOT use this route — they PATCH /api/ghl/contacts/[id] directly.)
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { field, value, commentLeadId, platform, participantId, name } = body as {
    field?: string;
    value?: string;
    commentLeadId?: string;
    platform?: string;
    participantId?: string;
    name?: string;
  };

  if (!field || !FIELDS.includes(field as Field)) {
    return NextResponse.json({ error: "Invalid field" }, { status: 400 });
  }
  if (typeof value !== "string" || !value.trim()) {
    return NextResponse.json({ error: "Missing value" }, { status: 400 });
  }
  const set = fieldSet(field as Field, value.trim());

  try {
    const client = await db();

    // Path 1 — known social lead row (comment lead, or a DM that already has a row).
    if (commentLeadId) {
      const updated = await client
        .update(socialLeads)
        .set(set)
        .where(eq(socialLeads.id, commentLeadId))
        .returning();
      if (!updated.length) {
        return NextResponse.json({ error: "Lead not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, lead: updated[0] });
    }

    // Path 2 — raw DM: upsert by (platform, commenterId). No promotion.
    if (platform && participantId) {
      const existing = await client
        .select()
        .from(socialLeads)
        .where(
          and(eq(socialLeads.platform, platform), eq(socialLeads.commenterId, participantId))
        )
        .limit(1);

      if (existing.length) {
        const updated = await client
          .update(socialLeads)
          .set(set)
          .where(eq(socialLeads.id, existing[0].id))
          .returning();
        return NextResponse.json({ ok: true, lead: updated[0] });
      }

      // Minimal DM-origin row. commentText / keyword / name are NOT NULL, so set safe
      // defaults; empty commentId + keyword also keep this row OUT of the comment-leads
      // inbox (see that route's filter) so a DM never shows up as a fake "comment".
      const inserted = await client
        .insert(socialLeads)
        .values({
          name: name?.trim() || "Unknown",
          platform,
          commenterId: participantId,
          commentText: "",
          keyword: "",
          ...set,
        })
        .returning();
      return NextResponse.json({ ok: true, lead: inserted[0] });
    }

    return NextResponse.json(
      { error: "Provide commentLeadId or platform + participantId" },
      { status: 400 }
    );
  } catch (err) {
    console.error("[POST /api/comment-leads/attach]", err);
    return NextResponse.json({ error: "Failed to attach" }, { status: 500 });
  }
}
