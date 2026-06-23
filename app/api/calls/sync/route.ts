import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { calls, userCalendars, users } from "@/lib/db/schema";
import { ghl, locationId } from "@/lib/ghl/client";
import { isGoogleConfigured, meetClient, driveClient } from "@/lib/google/client";
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

// ─── Gemini notes search ───────────────────────────────────────────────────────

/**
 * Search the organiser's Drive for a Gemini-generated meeting notes doc.
 * Google Meet saves these as Google Docs named "Notes from [meeting]" shortly
 * after the call ends. We search within a 3-hour window after the call started.
 */
async function findGeminiNotesUrl(repEmail: string, startedAt: Date): Promise<string | null> {
  try {
    const drive = await driveClient(repEmail);

    // Search window: from meeting start → 3 hours later
    const windowStart = startedAt.toISOString();
    const windowEnd   = new Date(startedAt.getTime() + 3 * 60 * 60 * 1000).toISOString();

    const q = [
      "mimeType='application/vnd.google-apps.document'",
      `createdTime >= '${windowStart}'`,
      `createdTime <= '${windowEnd}'`,
      "(name contains 'Notes from' or name contains 'Gemini Notes' or name contains 'Meeting notes')",
    ].join(" and ");

    const res = await (drive as any).files.list({
      q,
      fields: "files(id,name,webViewLink,createdTime)",
      pageSize: 10,
      orderBy: "createdTime asc",
    });

    const files: Array<{ id: string; name: string; webViewLink: string }> =
      res.data?.files ?? [];

    return files[0]?.webViewLink ?? null;
  } catch (err) {
    console.warn("[calls/sync] Gemini notes search failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ─── GHL calendar bookings (the booked Google Meet calls) ────────────────────

interface GHLApptEvent {
  id?: string;
  contactId?: string;
  title?: string;
  appointmentStatus?: string; // "confirmed" | "showed" | "noshow" | "cancelled"
  status?: string;            // older payloads
  startTime?: string;
  endTime?: string;
  contactName?: string;
  assignedUserId?: string;
  users?: string[];           // attendee GHL user ids (rep fallback)
  calendarId?: string;
  address?: string;           // the Google Meet/Zoom link
}

/**
 * Resolve a clean contact name from a calendar event. GHL's calendar list omits
 * contactName, but the booking title is "{Contact} x Kracked Retention[: …]", so
 * we take the part before " x ". Falls back to contactName when present.
 */
export function contactNameFromEvent(ev: { title?: string; contactName?: string }): string | null {
  if (ev.contactName?.trim()) return ev.contactName.trim();
  const title = (ev.title ?? "").trim();
  if (!title) return null;
  const name = title.split(/\s+x\s+/i)[0].split(/\s*[:|]\s*/)[0].trim();
  return name || null;
}

/** Normalise GHL appointmentStatus into our stored vocabulary. */
export function normalizeApptStatus(raw?: string): string {
  const v = (raw ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (v.includes("noshow")) return "noshow";
  if (v.includes("showed") || v.includes("show")) return "showed";
  if (v.includes("complete")) return "completed";
  if (v.includes("confirm")) return "confirmed";
  if (v.includes("invalid")) return "cancelled";
  return v || "booked";
}

interface GHLCalendarMeta {
  id: string;
  name: string;
  teamMembers?: Array<{ userId?: string; isPrimary?: boolean; selected?: boolean }>;
}

async function fetchAllCalendars(loc: string): Promise<GHLCalendarMeta[]> {
  try {
    const data = await ghl.get<{ calendars?: GHLCalendarMeta[] }>(
      `/calendars/?locationId=${loc}`
    );
    return (data.calendars ?? []).filter((c) => c.id);
  } catch (err) {
    console.error("[calls/sync] calendar list failed:", err);
    return [];
  }
}

/** The team member who owns a calendar (primary, else first selected) — the rep
 * fallback for Google-synced events that carry no assignedUserId. */
function calendarPrimaryUserId(cal: GHLCalendarMeta): string | undefined {
  const members = cal.teamMembers ?? [];
  return (members.find((m) => m.isPrimary && m.userId) ?? members.find((m) => m.userId))?.userId;
}

/** The GHL user who owns a contact (assignedTo) — final rep fallback for events
 * that carry no rep info at all (e.g. the intro-call calendar). */
async function fetchContactOwner(contactId: string): Promise<string | undefined> {
  try {
    const d = await ghl.get<{ contact?: { assignedTo?: string }; assignedTo?: string }>(`/contacts/${contactId}`);
    return d.contact?.assignedTo ?? d.assignedTo ?? undefined;
  } catch {
    return undefined;
  }
}

/** Map of every GHL location user id → { email, name } (all 7 team members, not
 * just the app's own users). */
async function fetchGhlUserMap(loc: string): Promise<Map<string, { email: string; name: string }>> {
  try {
    const data = await ghl.get<{ users?: Array<{ id: string; name?: string; email?: string }> }>(
      `/users/?locationId=${loc}`
    );
    const map = new Map<string, { email: string; name: string }>();
    for (const u of data.users ?? []) {
      if (u.id) map.set(u.id, { email: u.email ?? "", name: u.name ?? u.email ?? "Rep" });
    }
    return map;
  } catch (err) {
    console.error("[calls/sync] user list failed:", err);
    return new Map();
  }
}

async function fetchCalendarEvents(loc: string, calId: string, startMs: number, endMs: number): Promise<GHLApptEvent[]> {
  try {
    const data = await ghl.get<{ events?: GHLApptEvent[] }>(
      `/calendars/events?locationId=${loc}&calendarId=${calId}&startTime=${startMs}&endTime=${endMs}`
    );
    return data.events ?? [];
  } catch (err) {
    console.error(`[calls/sync] events fetch failed for ${calId}:`, err);
    return [];
  }
}

// ─── Sync logic (shared between POST and cron GET) ────────────────────────────

export async function runSync(): Promise<{ meet: number; dialer: number; calendar: number }> {
  const client = db();
  const loc    = locationId();

  // Load all active users with a GHL user ID — used for dialer sync
  const activeUsers = await client.select({
    email: users.email,
    name: users.name,
    ghlUserId: users.ghlUserId,
  }).from(users).where(eq(users.isActive, true));

  // Load all active rep calendars — used for Google Meet sync
  const activeReps = await client
    .select()
    .from(userCalendars)
    .where(eq(userCalendars.isActive, true));

  let dialerCount   = 0;
  let meetCount     = 0;
  let calendarCount = 0;

  // ── Source 1: GHL Dialer calls ─────────────────────────────────────────────

  const ghlUsers = activeUsers.filter((u) => u.ghlUserId);

  for (const user of ghlUsers) {
    const ghlUserId = user.ghlUserId!;

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
          `[calls/sync] Failed fetching conversations for ${user.email}:`,
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
                repEmail:          user.email,
                repName:           user.name,
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

  // ── Source 2: GHL calendar bookings (each booking = a booked Google Meet call) ─
  // Every GHL calendar booking carries a Google Meet link, so these ARE the meet
  // calls. Stored as callType "meet", deduped on the appointment id.
  {
    // Map against ALL GHL team members (7), not just the app's own users.
    const userByGhlId = await fetchGhlUserMap(loc);
    const now = Date.now();
    const startMs = now - 90 * 24 * 60 * 60 * 1000; // last 90 days
    const endMs   = now + 30 * 24 * 60 * 60 * 1000; // + next 30 days
    const calendars = await fetchAllCalendars(loc);
    // calendarId → owning team member (rep fallback for Google-synced events).
    const calOwner = new Map(calendars.map((c) => [c.id, calendarPrimaryUserId(c)]));
    const contactOwnerCache = new Map<string, string | undefined>();

    for (const cal of calendars) {
      const events = await fetchCalendarEvents(loc, cal.id, startMs, endMs);
      for (const ev of events) {
        if (!ev.id || !ev.startTime) continue;
        const statusVal = (ev.appointmentStatus ?? ev.status ?? "").toLowerCase();
        if (statusVal === "cancelled") continue; // booked = confirmed/showed/noshow
        const startedAt = new Date(ev.startTime);
        if (Number.isNaN(startedAt.getTime())) continue;
        const durationSeconds = ev.endTime
          ? Math.max(0, Math.round((new Date(ev.endTime).getTime() - startedAt.getTime()) / 1000))
          : null;
        // Rep: assigned user → attendee → calendar owner → the contact's owner.
        let repId = ev.assignedUserId
          ?? ev.users?.find((u) => userByGhlId.has(u))
          ?? (ev.calendarId ? calOwner.get(ev.calendarId) : undefined)
          ?? calOwner.get(cal.id);
        if (!repId && ev.contactId) {
          if (!contactOwnerCache.has(ev.contactId)) {
            contactOwnerCache.set(ev.contactId, await fetchContactOwner(ev.contactId));
          }
          repId = contactOwnerCache.get(ev.contactId);
        }
        const rep = repId ? userByGhlId.get(repId) : undefined;
        const contactName = contactNameFromEvent(ev);
        const status = normalizeApptStatus(ev.appointmentStatus ?? ev.status);
        try {
          await client
            .insert(calls)
            .values({
              callType:            "meet",
              direction:           null,
              status,
              contactId:           ev.contactId ?? null,
              contactName,
              meetingUrl:          ev.address ?? null,
              repEmail:            rep?.email ?? null,
              repName:             rep?.name ?? null,
              startedAt,
              durationSeconds,
              meetConferenceId:    `ghlappt_${ev.id}`, // dedup key (unique column)
              transcriptAvailable: false,
              recordingAvailable:  false,
            })
            // Re-sync should heal earlier rows that were stored without a name/
            // status/rep, and keep status fresh (showed/noshow set after the call).
            .onConflictDoUpdate({
              target: calls.meetConferenceId,
              // Never wipe a good value with null; always refresh status.
              set: {
                status,
                contactId:   sql`coalesce(${ev.contactId ?? null}::text, ${calls.contactId})`,
                contactName: sql`coalesce(${contactName}::text, ${calls.contactName})`,
                meetingUrl:  sql`coalesce(${ev.address ?? null}::text, ${calls.meetingUrl})`,
                repEmail:    sql`coalesce(${rep?.email ?? null}::text, ${calls.repEmail})`,
                repName:     sql`coalesce(${rep?.name ?? null}::text, ${calls.repName})`,
              },
            });
          calendarCount++;
        } catch (err) {
          console.error(`[calls/sync] Failed upserting calendar call ${ev.id}:`, err);
        }
      }
    }
  }

  // ── Source 3: Google Meet API (only if a Workspace service account is wired) ──

  if (!isGoogleConfigured()) {
    console.log("[calls/sync] Google not configured — skipping Meet API sync");
    return { meet: meetCount, dialer: dialerCount, calendar: calendarCount };
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

        // Search the organiser's Drive for a Gemini notes doc (best-effort)
        const smartNotesUrl = await findGeminiNotesUrl(rep.repEmail, startedAt);

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
              smartNotesUrl,
            })
            .onConflictDoUpdate({
              // On re-sync, update notes URL if we found one and the record didn't have one yet
              target: calls.meetConferenceId,
              set: { smartNotesUrl },
            })
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

  return { meet: meetCount, dialer: dialerCount, calendar: calendarCount };
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
