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
 * Returns the transcript entries for a Google Meet call.
 * Non-Meet calls or calls without a transcript return { entries: [] }.
 *
 * Response: { entries: Array<{ speaker, text, startTime }> }
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

    // Only Meet calls with a confirmed transcript can provide entries
    if (call.callType !== "meet" || !call.transcriptAvailable) {
      return NextResponse.json({ entries: [] });
    }

    if (!call.meetConferenceId) {
      return NextResponse.json({ entries: [] });
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
      return NextResponse.json({ entries: [] });
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

    return NextResponse.json({ entries: allEntries });
  } catch (err) {
    console.error(`[GET /api/calls/${id}/transcript]`, err);
    return NextResponse.json(
      { error: "Failed to fetch transcript" },
      { status: 500 }
    );
  }
}
