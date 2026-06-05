import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { callDispositions } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { ghl } from "@/lib/ghl/client";
import { logActivity } from "@/lib/activity/logger";

export const dynamic = "force-dynamic";

const VALID_OUTCOMES = [
  "no_show",
  "closed",
  "preparing_proposal",
  "sent_proposal",
  "rebooked",
  "not_interested",
  "budget_objection",
  "needs_time",
  "follow_up",
] as const;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { eventId } = await params;
  const body = await req.json();
  const { outcome, notes, contactId, contactName, repEmail } = body;

  if (!VALID_OUTCOMES.includes(outcome)) {
    return NextResponse.json({ error: "Invalid outcome" }, { status: 400 });
  }

  try {
    // Save disposition record
    await db().insert(callDispositions).values({
      calendarEventId: eventId,
      contactId: contactId ?? null,
      contactName: contactName ?? null,
      repEmail: repEmail ?? user.email,
      outcome,
      notes: notes || null,
    }).onConflictDoNothing(); // idempotent — ignore if already dispositioned

    logActivity({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      action: "call.dispositioned",
      entityType: "call",
      entityId: eventId,
      entityName: contactName ?? eventId,
      metadata: { outcome, has_notes: !!notes, rep_email: repEmail ?? user.email },
    });

    // Push notes to GHL contact if provided
    if (notes?.trim() && contactId) {
      const noteBody = `[Call outcome: ${outcome.replace(/_/g, " ")}]\n\n${notes.trim()}`;
      await ghl.post(`/contacts/${contactId}/notes/`, { body: noteBody }).catch((err) => {
        // Non-fatal — log but don't fail the request
        console.error("[outcome] Failed to push note to GHL:", err.message);
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/dashboard/calls/[eventId]/outcome]", err);
    return NextResponse.json({ error: "Failed to save outcome" }, { status: 500 });
  }
}
