import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { calls, userCalendars } from "@/lib/db/schema";
import { ghl, locationId } from "@/lib/ghl/client";
import { isGoogleConfigured, meetClient } from "@/lib/google/client";
import { generateAndStoreInsights } from "@/lib/ai/call-insights";

export const dynamic = "force-dynamic";

// ─── GHL response types ────────────────────────────────────────────────────────

interface GHLUserSearchResponse {
  users: Array<{
    id: string;
    email: string;
    name?: string;
    firstName?: string;
    lastName?: string;
  }>;
}

interface GHLConversation {
  id: string;
  contactId: string;
  contactName?: string;
  assignedTo?: string;
}

interface GHLConversationSearchResponse {
  conversations: GHLConversation[];
  meta?: { total?: number; nextPage?: boolean };
}

interface GHLMessage {
  id: string;
  messageType: string;
  type: number; // 1 = inbound, 2 = outbound
  dateAdded: string;
  meta?: {
    duration?: number; // seconds
  };
}

interface GHLMessagesResponse {
  messages: {
    messages: GHLMessage[];
    nextPage?: boolean;
    lastMessageId?: string;
  };
}

// ─── Google Meet response types ────────────────────────────────────────────────

interface MeetConferenceRecord {
  name: string;           // "conferenceRecords/{id}"
  startTime?: string;     // RFC 3339
  endTime?: string;       // RFC 3339
  space?: string;
}

interface MeetTranscript {
  name: string;           // "conferenceRecords/{id}/transcripts/{id}"
  state?: string;
}

// ─── Sync logic (shared between POST and cron GET) ────────────────────────────

export async function runSync(): Promise<{ meet: number; dialer: number }> {
  const client = db();
  const loc    = locationId();

  // Load all active rep calendars once — used by both sync paths
  const activeReps = await client
    .select()
    .from(userCalendars)
    .where(eq(userCalendars.isActive, true));

  let dialerCount = 0;
  let meetCount   = 0;

  // ── Source 1: GHL Dialer calls ─────────────────────────────────────────────

  for (const rep of activeReps) {
    // Resolve GHL user ID for this rep email
    let ghlUserId: string | null = null;
    try {
      const userSearch = await ghl.get<GHLUserSearchResponse>(
        `/users/search?locationId=${loc}&email=${encodeURIComponent(rep.repEmail)}`
      );
      ghlUserId = userSearch.users?.[0]?.id ?? null;
    } catch (err) {
      console.error(
        `[calls/sync] GHL user lookup failed for ${rep.repEmail}:`,
        err
      );
      continue;
    }

    if (!ghlUserId) {
      console.warn(`[calls/sync] No GHL user found for ${rep.repEmail} — skipping`);
      continue;
    }

    // Fetch conversations assigned to this rep
    let conversationCursor: string | undefined;
    const conversations: GHLConversation[] = [];

    for (let page = 0; page < 20; page++) {
      const cursorParam = conversationCursor
        ? `&lastId=${conversationCursor}`
        : "";
      try {
        const data = await ghl.get<GHLConversationSearchResponse>(
          `/conversations/search?locationId=${loc}&assignedTo=${ghlUserId}&limit=100${cursorParam}`
        );
        const batch = data.conversations ?? [];
        conversations.push(...batch);
        if (!data.meta?.nextPage || batch.length < 100) break;
        conversationCursor = batch[batch.length - 1]?.id;
        if (!conversationCursor) break;
      } catch (err) {
        console.error(
          `[calls/sync] Failed fetching conversations for ${rep.repEmail}:`,
          err
        );
        break;
      }
    }

    // Fetch messages for each conversation and pick up call messages
    for (const conv of conversations) {
      let messageCursor: string | undefined;

      for (let page = 0; page < 10; page++) {
        const cursorParam = messageCursor
          ? `&lastMessageId=${messageCursor}`
          : "";
        let messages: GHLMessage[] = [];

        try {
          const data = await ghl.get<GHLMessagesResponse>(
            `/conversations/${conv.id}/messages?limit=100${cursorParam}`
          );
          messages = data.messages?.messages ?? [];
          messageCursor = data.messages?.lastMessageId;
        } catch (err) {
          console.error(
            `[calls/sync] Failed fetching messages for conversation ${conv.id}:`,
            err
          );
          break;
        }

        const callMessages = messages.filter(
          (m) => m.messageType === "TYPE_CALL"
        );

        for (const msg of callMessages) {
          const direction = msg.type === 1 ? "inbound" : "outbound";
          const startedAt = new Date(msg.dateAdded);
          const durationSeconds =
            typeof msg.meta?.duration === "number" ? msg.meta.duration : null;

          try {
            await client
              .insert(calls)
              .values({
                callType:          "dialer",
                direction,
                contactId:         conv.contactId ?? null,
                contactName:       conv.contactName ?? null,
                repEmail:          rep.repEmail,
                repName:           rep.repName,
                startedAt,
                durationSeconds,
                ghlMessageId:      msg.id,
                ghlConversationId: conv.id,
                transcriptAvailable: false,
                recordingAvailable:  false,
              })
              .onConflictDoNothing();
            dialerCount++;
          } catch (err) {
            console.error(
              `[calls/sync] Failed upserting dialer call ${msg.id}:`,
              err
            );
          }
        }

        if (!messageCursor || messages.length < 100) break;
      }
    }
  }

  // ── Source 2: Google Meet ──────────────────────────────────────────────────

  if (!isGoogleConfigured()) {
    console.log("[calls/sync] Google not configured — skipping Meet sync");
    return { meet: meetCount, dialer: dialerCount };
  }

  for (const rep of activeReps) {
    let meet: Awaited<ReturnType<typeof meetClient>>;
    try {
      meet = await meetClient(rep.repEmail);
    } catch (err) {
      console.error(
        `[calls/sync] Failed to create Meet client for ${rep.repEmail}:`,
        err
      );
      continue;
    }

    // List conference records where this rep is the organiser
    let nextPageToken: string | undefined;

    for (let page = 0; page < 20; page++) {
      let records: MeetConferenceRecord[] = [];
      let token: string | undefined;

      try {
        const res = await (meet as any).conferenceRecords.list({
          pageSize: 100,
          ...(nextPageToken ? { pageToken: nextPageToken } : {}),
        });
        records   = (res.data?.conferenceRecords as MeetConferenceRecord[]) ?? [];
        token     = res.data?.nextPageToken ?? undefined;
      } catch (err) {
        console.error(
          `[calls/sync] Meet conferenceRecords.list failed for ${rep.repEmail}:`,
          err
        );
        break;
      }

      for (const record of records) {
        const startedAt = record.startTime
          ? new Date(record.startTime)
          : null;

        if (!startedAt) continue;

        const durationSeconds =
          record.startTime && record.endTime
            ? Math.round(
                (new Date(record.endTime).getTime() -
                  new Date(record.startTime).getTime()) /
                  1000
              )
            : null;

        // Check whether any transcripts exist and fetch the text if so
        let transcriptAvailable = false;
        let transcriptText: string | null = null;
        try {
          const txRes = await (meet as any).conferenceRecords.transcripts.list({
            parent: record.name,
            pageSize: 1,
          });
          const transcripts =
            (txRes.data?.transcripts as MeetTranscript[]) ?? [];
          transcriptAvailable = transcripts.length > 0;

          if (transcriptAvailable && transcripts[0]?.name) {
            // Fetch transcript entries and concatenate into plain text
            const entriesRes = await (meet as any).conferenceRecords.transcripts.entries.list({
              parent: transcripts[0].name,
              pageSize: 500,
            });
            const entries: Array<{ text?: string; participant?: { signedinUser?: { displayName?: string } } }> =
              entriesRes.data?.transcriptEntries ?? [];
            if (entries.length > 0) {
              transcriptText = entries
                .map((e) => {
                  const speaker = e.participant?.signedinUser?.displayName ?? "Speaker";
                  return `${speaker}: ${e.text ?? ""}`;
                })
                .join("\n");
            }
          }
        } catch {
          // Non-fatal — transcript check failure just means we mark it false
          transcriptAvailable = false;
        }

        let insertedCallId: string | null = null;
        try {
          const [inserted] = await client
            .insert(calls)
            .values({
              callType:            "meet",
              direction:           null,
              repEmail:            rep.repEmail,
              repName:             rep.repName,
              startedAt,
              durationSeconds,
              meetConferenceId:    record.name,
              meetSpaceId:         record.space ?? null,
              transcriptAvailable,
              transcriptText,
              transcriptStoredAt:  transcriptText ? new Date() : null,
              recordingAvailable:  false,
            })
            .onConflictDoNothing()
            .returning({ id: calls.id });
          insertedCallId = inserted?.id ?? null;
          meetCount++;
        } catch (err) {
          console.error(
            `[calls/sync] Failed upserting Meet record ${record.name}:`,
            err
          );
        }

        // Generate AI insights for new calls with transcripts (non-blocking)
        if (insertedCallId && transcriptText) {
          generateAndStoreInsights(insertedCallId, null, transcriptText).catch(
            (err) => console.error("[calls/sync] Insight generation failed:", err)
          );
        }
      }

      nextPageToken = token;
      if (!nextPageToken || records.length < 100) break;
    }
  }

  return { meet: meetCount, dialer: dialerCount };
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function POST() {
  try {
    const synced = await runSync();
    return NextResponse.json({ synced });
  } catch (err) {
    console.error("[POST /api/calls/sync]", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
