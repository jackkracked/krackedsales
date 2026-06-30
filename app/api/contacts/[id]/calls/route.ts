import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { calls, callDispositions } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/**
 * GET /api/contacts/[id]/calls
 * Returns this contact's logged calls (meet + dialer) newest-first, each enriched
 * with its disposition outcome + notes (when one was set). Shape is Call-compatible
 * (see components/calls/calls-client.tsx) so a row can open the shared CallDetailModal.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const contactId = id.startsWith("ghl_") ? id.slice(4) : id;
  if (!contactId) return NextResponse.json({ calls: [] });

  try {
    const rows = await db()
      .select()
      .from(calls)
      .where(eq(calls.contactId, contactId))
      .orderBy(desc(calls.startedAt))
      .limit(100);

    // Outcomes/notes the rep set, keyed by GHL calendar event id (= meetConferenceId
    // minus the "ghlappt_" prefix).
    const dispos = await db()
      .select({ calendarEventId: callDispositions.calendarEventId, outcome: callDispositions.outcome, notes: callDispositions.notes })
      .from(callDispositions)
      .where(eq(callDispositions.contactId, contactId));
    const dispoMap = new Map(dispos.map((d) => [d.calendarEventId, d]));

    const nowMs = Date.now();
    const out = rows.map((r) => {
      const apptId = r.meetConferenceId?.startsWith("ghlappt_") ? r.meetConferenceId.slice(8) : null;
      const d = apptId ? dispoMap.get(apptId) : undefined;
      const status =
        r.callType === "meet"
          ? r.startedAt.getTime() > nowMs ? "upcoming" : d?.outcome === "no_show" ? "noshow" : "completed"
          : r.status ?? "completed";
      return {
        id: r.id,
        callType: r.callType as "meet" | "dialer",
        direction: r.direction as "inbound" | "outbound" | null,
        contactId: r.contactId,
        contactName: r.contactName,
        repEmail: r.repEmail,
        repName: r.repName,
        startedAt: r.startedAt.toISOString(),
        durationSeconds: r.durationSeconds,
        meetingUrl: r.meetingUrl,
        status,
        transcriptAvailable: r.transcriptAvailable,
        recordingAvailable: r.recordingAvailable,
        meetConferenceId: r.meetConferenceId ?? undefined,
        smartNotesUrl: r.smartNotesUrl ?? undefined,
        fathomRecordingId: r.fathomRecordingId,
        fathomShareUrl: r.fathomShareUrl ?? undefined,
        outcome: d?.outcome ?? null,
        notes: d?.notes ?? null,
      };
    });

    return NextResponse.json({ calls: out });
  } catch (err) {
    console.error("[GET /api/contacts/[id]/calls]", err);
    return NextResponse.json({ calls: [] }, { status: 500 });
  }
}
