import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { calls } from "@/lib/db/schema";
import { meetClient } from "@/lib/google/client";

export const dynamic = "force-dynamic";

// ─── Google Meet transcript types ──────────────────────────────────────────────

interface MeetTranscript {
  name: string;   // "conferenceRecords/{id}/transcripts/{id}"
  state?: string;
}

interface MeetTranscriptEntry {
  name: string;
  participant?: {
    signedinUser?: { displayName?: string };
    anonymousUser?: { displayName?: string };
  };
  text?: string;
  startTime?: string;
}

interface TranscriptEntryResponse {
  speaker: string;
  text: string;
  startTime: string;
}

/**
 * GET /api/calls/[id]/transcript
 *
 * Returns transcript entries for a call. Checks for Fathom-synced transcript
 * data first (stored as JSON in transcriptText). Falls back to the Google Meet
 * API when no stored transcript exists.
 *
 * Response: { entries: Array<{ speaker, text, startTime }>, fathomSummary?, fathomShareUrl? }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Missing call id" }, { status: 400 });
  }

  try {
    const client = db();

    const [call] = await client
      .select()
      .from(calls)
      .where(eq(calls.id, id))
      .limit(1);

    if (!call) {
      return NextResponse.json({ error: "Call not found" }, { status: 404 });
    }

    // Base call metadata included in every response so the drawer can render the header
    const meta = {
      callId:        call.id,
      contactName:   call.contactName,
      repName:       call.repName,
      startedAt:     call.startedAt,
      smartNotesUrl: call.smartNotesUrl ?? null,
      fathomSummary: call.fathomSummary ?? null,
      fathomShareUrl: call.fathomShareUrl ?? null,
    };

    // ── Fathom-synced transcript (preferred path) ──────────────────────────
    // transcriptText is a JSON array of { speaker, text, timestamp } stored
    // by the Fathom sync process. If present, use it directly.
    if (call.transcriptText) {
      try {
        const items = JSON.parse(call.transcriptText) as Array<{
          speaker: { display_name: string };
          text: string;
          timestamp: string;
        }>;

        const entries: TranscriptEntryResponse[] = items.map((item) => ({
          speaker:   item.speaker.display_name,
          text:      item.text,
          startTime: item.timestamp,
        }));

        return NextResponse.json({ ...meta, entries });
      } catch {
        // Malformed JSON — fall through to Google Meet path
        console.warn(`[GET /api/calls/${id}/transcript] Failed to parse stored transcriptText, falling back to Meet API`);
      }
    }

    // ── Google Meet transcript (fallback) ──────────────────────────────────

    // Only Meet calls with a confirmed transcript can provide entries
    if (call.callType !== "meet" || !call.transcriptAvailable) {
      return NextResponse.json({ ...meta, entries: [] });
    }

    if (!call.meetConferenceId) {
      return NextResponse.json({ ...meta, entries: [] });
    }

    if (!call.repEmail) {
      return NextResponse.json(
        { error: "Call has no rep email — cannot impersonate Meet user" },
        { status: 422 }
      );
    }

    const meet = await meetClient(call.repEmail);

    // List transcripts for the conference record
    const txListRes = await (meet as any).conferenceRecords.transcripts.list({
      parent: call.meetConferenceId,
      pageSize: 10,
    });

    const transcripts =
      (txListRes.data?.transcripts as MeetTranscript[]) ?? [];

    if (transcripts.length === 0) {
      return NextResponse.json({ ...meta, entries: [] });
    }

    // Use the first (most recent / only) transcript
    const transcriptName = transcripts[0].name;

    // Fetch all transcript entries, paginating if needed
    const allEntries: TranscriptEntryResponse[] = [];
    let nextPageToken: string | undefined;

    for (let page = 0; page < 50; page++) {
      const entriesRes = await (meet as any).conferenceRecords.transcripts.entries.list({
        parent: transcriptName,
        pageSize: 100,
        ...(nextPageToken ? { pageToken: nextPageToken } : {}),
      });

      const batch =
        (entriesRes.data?.transcriptEntries as MeetTranscriptEntry[]) ?? [];

      for (const entry of batch) {
        const speaker =
          entry.participant?.signedinUser?.displayName ??
          entry.participant?.anonymousUser?.displayName ??
          "Unknown";

        allEntries.push({
          speaker,
          text:      entry.text ?? "",
          startTime: entry.startTime ?? "",
        });
      }

      nextPageToken = entriesRes.data?.nextPageToken ?? undefined;
      if (!nextPageToken || batch.length < 100) break;
    }

    return NextResponse.json({ ...meta, entries: allEntries });
  } catch (err) {
    console.error(`[GET /api/calls/${id}/transcript]`, err);
    return NextResponse.json(
      { error: "Failed to fetch transcript" },
      { status: 500 }
    );
  }
}
