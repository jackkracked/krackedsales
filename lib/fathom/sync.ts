/**
 * Fathom → Kracked Sales sync logic.
 * Pulls meetings from Fathom, matches invitees to GHL contacts,
 * inserts call records, and triggers AI insight generation.
 */

import { db } from "@/lib/db";
import { calls, users, localContacts } from "@/lib/db/schema";
import { and, eq, isNull, isNotNull, or, ilike } from "drizzle-orm";
import { ghl, locationId } from "@/lib/ghl/client";
import { generateAndStoreInsights } from "@/lib/ai/call-insights";
import {
  listMeetings,
  type FathomInvitee,
  type FathomMeeting,
  type FathomTranscriptItem,
} from "./client";

// ─── Contact matching ────────────────────────────────────────────────────────

interface MatchedContact {
  contactId: string;
  contactName: string;
}

interface GHLSearchResult {
  contacts: Array<{
    id: string;
    firstName?: string;
    lastName?: string;
    fullName?: string;
    email?: string;
  }>;
}

/**
 * Try to match Fathom external invitees to a GHL contact.
 * Searches local DB first, then falls back to GHL API.
 */
export async function matchFathomContact(
  invitees: FathomInvitee[],
  repEmail: string,
): Promise<MatchedContact | null> {
  const external = invitees.filter((i) => i.is_external);
  if (external.length === 0) return null;

  const client = db();

  for (const invitee of external) {
    // 1. Search local contacts by email
    if (invitee.email) {
      const localByEmail = await client
        .select({
          id: localContacts.id,
          fullName: localContacts.fullName,
          firstName: localContacts.firstName,
          lastName: localContacts.lastName,
        })
        .from(localContacts)
        .where(ilike(localContacts.email, invitee.email))
        .limit(1);

      if (localByEmail.length > 0) {
        const c = localByEmail[0];
        return {
          contactId: c.id,
          contactName:
            (c.fullName ??
            [c.firstName, c.lastName].filter(Boolean).join(" ")) ||
            invitee.name,
        };
      }
    }

    // 2. Search local contacts by name
    if (invitee.name) {
      const pattern = `%${invitee.name}%`;
      const localByName = await client
        .select({
          id: localContacts.id,
          fullName: localContacts.fullName,
          firstName: localContacts.firstName,
          lastName: localContacts.lastName,
        })
        .from(localContacts)
        .where(
          or(
            ilike(localContacts.fullName, pattern),
            ilike(localContacts.companyName, pattern),
          ),
        )
        .limit(1);

      if (localByName.length > 0) {
        const c = localByName[0];
        return {
          contactId: c.id,
          contactName:
            (c.fullName ??
            [c.firstName, c.lastName].filter(Boolean).join(" ")) ||
            invitee.name,
        };
      }
    }

    // 3. Fall back to GHL API search by email
    if (invitee.email) {
      try {
        const data = await ghl.get<GHLSearchResult>(
          `/contacts/?locationId=${locationId()}&query=${encodeURIComponent(invitee.email)}&limit=1`,
        );
        if (data.contacts?.length > 0) {
          const c = data.contacts[0];
          return {
            contactId: c.id,
            contactName:
              (c.fullName ??
              [c.firstName, c.lastName].filter(Boolean).join(" ")) ||
              invitee.name,
          };
        }
      } catch {
        // GHL search failed — continue to next invitee
      }
    }

    // 4. Fall back to GHL API search by name
    if (invitee.name) {
      try {
        const data = await ghl.get<GHLSearchResult>(
          `/contacts/?locationId=${locationId()}&query=${encodeURIComponent(invitee.name)}&limit=1`,
        );
        if (data.contacts?.length > 0) {
          const c = data.contacts[0];
          return {
            contactId: c.id,
            contactName:
              (c.fullName ??
              [c.firstName, c.lastName].filter(Boolean).join(" ")) ||
              invitee.name,
          };
        }
      } catch {
        // GHL search failed — continue to next invitee
      }
    }
  }

  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build plain-text transcript from Fathom transcript items: "Speaker: text\n" */
function buildPlainText(items: FathomTranscriptItem[]): string {
  return items.map((t) => `${t.speaker.display_name}: ${t.text}`).join("\n");
}

/** Calculate duration in seconds between two ISO 8601 timestamps. */
function calcDurationSeconds(start: string, end: string): number {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Math.max(0, Math.round(ms / 1000));
}

// ─── Core sync ───────────────────────────────────────────────────────────────

/**
 * Sync recent Fathom meetings for a single user.
 * Returns the number of new calls inserted.
 */
export async function syncFathomForUser(
  userId: string,
  apiKey: string,
  sinceDays = 1,
): Promise<number> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  return syncMeetings(userId, apiKey, since);
}

/**
 * Backfill 30 days of Fathom meetings for a single user.
 * Same logic as syncFathomForUser but with a wider time window.
 */
export async function backfillFathom(
  userId: string,
  apiKey: string,
): Promise<number> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return syncMeetings(userId, apiKey, since);
}

/**
 * Sync Fathom meetings for ALL users that have a Fathom API key configured.
 * Errors for individual users are caught and logged — one user's failure
 * does not block others.
 */
export async function syncFathomForAllUsers(sinceDays = 1): Promise<number> {
  const client = db();
  const fathomUsers = await client
    .select({ id: users.id, fathomApiKey: users.fathomApiKey })
    .from(users)
    .where(isNotNull(users.fathomApiKey));

  let total = 0;

  for (const user of fathomUsers) {
    try {
      const count = await syncFathomForUser(user.id, user.fathomApiKey!, sinceDays);
      total += count;
    } catch (err) {
      console.error(
        `[fathom-sync] Failed for user ${user.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return total;
}

// ─── Internal ────────────────────────────────────────────────────────────────

async function syncMeetings(
  userId: string,
  apiKey: string,
  createdAfter: string,
): Promise<number> {
  const meetings = await listMeetings(apiKey, {
    createdAfter,
    includeTranscript: true,
    includeSummary: true,
  });

  const client = db();
  let synced = 0;

  for (const meeting of meetings) {
    try {
      // Already attached/synced this recording? (dedup by fathomRecordingId)
      const already = await client
        .select({ id: calls.id })
        .from(calls)
        .where(eq(calls.fathomRecordingId, meeting.recording_id))
        .limit(1);
      if (already.length > 0) continue;

      // Match external invitees to a GHL contact (best-effort, improves display)
      const matched = await matchFathomContact(
        meeting.calendar_invitees ?? [],
        meeting.recorded_by.email,
      );

      // Build transcript data
      const transcriptItems = meeting.transcript ?? [];
      const hasTranscript = transcriptItems.length > 0;
      const plainText = hasTranscript ? buildPlainText(transcriptItems) : null;

      const fathomFields = {
        transcriptAvailable: hasTranscript,
        transcriptText: hasTranscript ? JSON.stringify(transcriptItems) : null,
        recordingAvailable: true,
        fathomRecordingId: meeting.recording_id,
        fathomSummary: meeting.default_summary?.markdown_formatted ?? null,
        fathomSyncedAt: new Date(),
        fathomShareUrl: meeting.share_url ?? null,
      };

      // ── Attach to the existing booked call when we can match it ──────────────
      // The Meet link (meeting_url) equals the GHL event address we store on the
      // call, so it's a deterministic match. This puts the recording + transcript
      // on the SAME call row the rest of the app already shows.
      let attachedId: string | null = null;
      let attachedContactId: string | null = matched?.contactId ?? null;
      if (meeting.meeting_url) {
        // Only attach to a call not already linked to a recording — so recurring
        // meetings (which reuse a Meet link) each grab a distinct un-attached call
        // instead of overwriting one another.
        const [match] = await client
          .select({ id: calls.id, contactId: calls.contactId, repEmail: calls.repEmail })
          .from(calls)
          .where(and(
            eq(calls.meetingUrl, meeting.meeting_url),
            eq(calls.callType, "meet"),
            isNull(calls.fathomRecordingId),
          ))
          .orderBy(calls.startedAt)
          .limit(1);
        if (match) {
          await client
            .update(calls)
            .set({
              ...fathomFields,
              // Prefer a real matched contact over a generic event title.
              contactId: matched?.contactId ?? match.contactId ?? null,
              ...(matched?.contactName ? { contactName: matched.contactName } : {}),
              // Fill the rep from who recorded the call when it's missing.
              ...(!match.repEmail ? { repEmail: meeting.recorded_by.email, repName: meeting.recorded_by.name } : {}),
            })
            .where(eq(calls.id, match.id));
          attachedId = match.id;
          attachedContactId = matched?.contactId ?? match.contactId ?? null;
        }
      }

      // ── No existing call to attach to → insert a standalone Fathom call ──────
      if (!attachedId) {
        const [inserted] = await client
          .insert(calls)
          .values({
            callType: "meet",
            status: "completed",
            contactId: matched?.contactId ?? null,
            contactName: matched?.contactName ?? meeting.title ?? null,
            meetingUrl: meeting.meeting_url ?? null,
            repEmail: meeting.recorded_by.email,
            repName: meeting.recorded_by.name,
            startedAt: new Date(meeting.recording_start_time),
            durationSeconds: calcDurationSeconds(
              meeting.recording_start_time,
              meeting.recording_end_time,
            ),
            ...fathomFields,
          })
          .returning({ id: calls.id });
        attachedId = inserted?.id ?? null;
      }

      // Generate AI insights from the transcript (non-fatal)
      if (attachedId && plainText) {
        await generateAndStoreInsights(attachedId, attachedContactId, plainText).catch(
          (err) => console.error("[fathom-sync] insight generation failed:", err),
        );
      }

      synced++;
    } catch (err) {
      console.error(
        `[fathom-sync] Failed to sync meeting ${meeting.recording_id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return synced;
}
