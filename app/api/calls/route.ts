import { NextRequest, NextResponse } from "next/server";
import { and, avg, count, desc, eq, gte, ilike, inArray, isNotNull, lte, sum, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { calls, users, callDispositions, localContacts } from "@/lib/db/schema";
import { ghl, locationId } from "@/lib/ghl/client";
import type { GHLCalendarEvent } from "@/lib/ghl/types";

export const dynamic = "force-dynamic";

// ─── Unified call shape returned to the frontend ─────────────────────────────

interface UnifiedCall {
  id: string;
  callType: "meet" | "dialer" | "scheduled";
  direction: "inbound" | "outbound" | null;
  contactId: string | null;
  contactName: string | null;
  repEmail: string | null;
  repName: string | null;
  startedAt: string; // ISO date
  durationSeconds: number | null;
  meetingUrl: string | null; // Google Meet/Zoom link
  status: string | null; // "booked" | "confirmed" | "showed" | "noshow" | "cancelled" | "completed"
  transcriptAvailable: boolean;
  recordingAvailable: boolean;
  meetConferenceId?: string;
  smartNotesUrl?: string;
  fathomRecordingId?: number | null;
  fathomShareUrl?: string | null;
  recordingUrl?: string | null; // Twilio/dialer recording (Blob) — plays in the modal
  // Dialer-only: the dialed number, and whether the name resolved to a real contact.
  dialedNumber?: string | null;
  contactMatched?: boolean;
}

// ─── GHL calendar event fetching (mirrors dashboard/calls logic) ─────────────

interface GHLCalendarResponse {
  events?: GHLCalendarEvent[];
}

async function fetchGHLEventsForUser(
  ghlUserId: string,
  startMs: number,
  endMs: number,
  repEmail: string,
  repName: string
): Promise<UnifiedCall[]> {
  try {
    const data = await ghl.get<GHLCalendarResponse>(
      `/calendars/events?locationId=${locationId()}&userId=${ghlUserId}&startTime=${startMs}&endTime=${endMs}`
    );
    return (data.events ?? []).map((e) => {
      const start = new Date(e.startTime);
      const end = new Date(e.endTime);
      const durationSeconds = Math.round((end.getTime() - start.getTime()) / 1000);

      return {
        id: `ghl-event-${e.id}`,
        callType: "scheduled" as const,
        direction: null,
        contactId: e.contactId ?? null,
        contactName: e.title || e.contactName || null,
        repEmail,
        repName,
        startedAt: e.startTime,
        durationSeconds: durationSeconds > 0 ? durationSeconds : null,
        meetingUrl: e.address ?? null,
        status: start.getTime() > Date.now() ? "upcoming" : "completed",
        transcriptAvailable: false,
        recordingAvailable: false,
      };
    });
  } catch (err) {
    console.error("[fetchGHLEventsForUser]", err);
    return [];
  }
}

/**
 * GET /api/calls
 *
 * Query params:
 *   type   — "meet" | "dialer" | "scheduled" | "all" (default: "all")
 *   rep    — rep email (exact match)
 *   reps   — comma-separated rep emails
 *   since  — ISO date string, inclusive lower bound on startedAt
 *   until  — ISO date string, inclusive upper bound on startedAt
 *   search — partial match on contactName (case-insensitive)
 *
 * Returns:
 *   { calls: UnifiedCall[], total: number, metrics: { ... } }
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const type   = sp.get("type")   ?? "all";
  const rep    = sp.get("rep")    ?? "";
  const reps   = sp.get("reps")   ?? "";
  const since  = sp.get("since")  ?? "";
  const until  = sp.get("until")  ?? "";
  const search = sp.get("search") ?? "";

  try {
    const client = db();

    // ── 1. Fetch DB calls (existing behaviour) ──────────────────────────

    const conditions = [];

    if (type === "meet" || type === "dialer") {
      conditions.push(eq(calls.callType, type));
    }
    // When type=scheduled we skip DB query entirely (no scheduled rows in DB)
    // When type=all we fetch all DB rows

    if (rep) {
      conditions.push(eq(calls.repEmail, rep));
    }

    if (since) {
      conditions.push(gte(calls.startedAt, new Date(since)));
    }

    if (until) {
      conditions.push(lte(calls.startedAt, new Date(until)));
    }

    if (search) {
      conditions.push(ilike(calls.contactName, `%${search}%`));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // Only query the DB when the type filter includes DB call types
    let dbRows: UnifiedCall[] = [];
    if (type !== "scheduled") {
      const rawRows = await client
        .select()
        .from(calls)
        .where(where)
        .orderBy(desc(calls.startedAt));

      // ── Enrich dialer rows: resolve rep name (from repEmail) + contact name
      //    (from contactId, else the dialed number matched against our contact
      //    mirror). Every lookup is resilient — a failure just leaves the number. ──
      const last10 = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-10);
      const dialerRaw = rawRows.filter((r) => r.callType === "dialer");
      const repEmails = [...new Set(dialerRaw.map((r) => r.repEmail).filter((e): e is string => !!e))];
      const contactIds = [...new Set(dialerRaw.map((r) => r.contactId).filter((c): c is string => !!c))];
      const numberDigits = [...new Set(dialerRaw.map((r) => last10(r.toNumber)).filter((d) => d.length >= 7))];

      const [repRows, contactByIdRows, contactByPhoneRows] = await Promise.all([
        repEmails.length
          ? client.select({ email: users.email, name: users.name }).from(users).where(inArray(users.email, repEmails)).catch(() => [])
          : Promise.resolve([] as { email: string; name: string }[]),
        contactIds.length
          ? client.select({ id: localContacts.id, fullName: localContacts.fullName }).from(localContacts).where(inArray(localContacts.id, contactIds)).catch(() => [])
          : Promise.resolve([] as { id: string; fullName: string | null }[]),
        numberDigits.length
          ? client.select({ fullName: localContacts.fullName, phone: localContacts.phone }).from(localContacts)
              .where(sql`right(regexp_replace(coalesce(${localContacts.phone}, ''), '[^0-9]', '', 'g'), 10) = ANY(${numberDigits}::text[])`).catch(() => [])
          : Promise.resolve([] as { fullName: string | null; phone: string | null }[]),
      ]);
      const repNameByEmail = new Map(repRows.map((r) => [r.email, r.name]));
      const nameByContactId = new Map(contactByIdRows.map((r) => [r.id, r.fullName]));
      const nameByPhone = new Map(contactByPhoneRows.map((r) => [last10(r.phone), r.fullName]));

      // Real outcome for scheduled calls lives in dispositions (the rep's set
      // outcome), keyed by the GHL appointment id = meetConferenceId minus the
      // "ghlappt_" prefix. Use it to show no-show / completed instead of a flat
      // "confirmed".
      const apptIds = rawRows
        .map((r) => r.meetConferenceId)
        .filter((m): m is string => !!m && m.startsWith("ghlappt_"))
        .map((m) => m.slice("ghlappt_".length));
      const dispoMap = new Map<string, string>();
      if (apptIds.length > 0) {
        const dispos = await client
          .select({ calendarEventId: callDispositions.calendarEventId, outcome: callDispositions.outcome })
          .from(callDispositions)
          .where(inArray(callDispositions.calendarEventId, apptIds));
        for (const d of dispos) if (d.calendarEventId) dispoMap.set(d.calendarEventId, d.outcome);
      }
      const nowMs = Date.now();

      function meetStatus(r: typeof rawRows[number]): string {
        if (r.startedAt.getTime() > nowMs) return "upcoming";
        const apptId = r.meetConferenceId?.startsWith("ghlappt_") ? r.meetConferenceId.slice(8) : null;
        const outcome = apptId ? dispoMap.get(apptId) : undefined;
        if (outcome === "no_show") return "noshow";
        if (outcome) return "completed";
        return "completed"; // past, held — no outcome logged yet
      }

      dbRows = rawRows.map((r) => {
        const isDialer = r.callType === "dialer";
        const dialedNumber = isDialer ? (r.toNumber ?? null) : null;
        let contactName = r.contactName;
        let contactMatched = !!r.contactName;
        // Only resolve names for dialer rows that DON'T already have one (the Twilio
        // in-app dialer calls). GHL-synced dialer calls keep their existing name.
        if (isDialer && !r.contactName) {
          const matched =
            (r.contactId ? nameByContactId.get(r.contactId) : null) ??
            (r.toNumber ? nameByPhone.get(last10(r.toNumber)) : null) ??
            null;
          if (matched) { contactName = matched; contactMatched = true; }
          else { contactName = dialedNumber; contactMatched = false; }
        }
        const repName = r.repName ?? (r.repEmail ? repNameByEmail.get(r.repEmail) ?? null : null);
        return {
          id: r.id,
          callType: r.callType as "meet" | "dialer",
          direction: r.direction as "inbound" | "outbound" | null,
          contactId: r.contactId,
          contactName,
          repEmail: r.repEmail,
          repName,
          startedAt: r.startedAt.toISOString(),
          durationSeconds: r.durationSeconds,
          meetingUrl: r.meetingUrl,
          status: r.callType === "meet" ? meetStatus(r) : (r.status ?? "completed"),
          transcriptAvailable: r.transcriptAvailable,
          recordingAvailable: r.recordingAvailable,
          meetConferenceId: r.meetConferenceId ?? undefined,
          smartNotesUrl: r.smartNotesUrl ?? undefined,
          fathomRecordingId: r.fathomRecordingId,
          fathomShareUrl: r.fathomShareUrl ?? undefined,
          recordingUrl: r.recordingUrl ?? null,
          dialedNumber,
          contactMatched,
        };
      });
    }

    // ── 2. Fetch GHL calendar events ────────────────────────────────────

    let ghlEvents: UnifiedCall[] = [];

    if (type === "all" || type === "scheduled") {
      // Determine date range for GHL query (ms timestamps)
      const sinceDate = since ? new Date(since) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const untilDate = until ? new Date(until) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const startMs = sinceDate.getTime();
      const endMs = untilDate.getTime();

      // Get all users with GHL IDs to fetch their calendar events
      const allUsers = await client
        .select({ id: users.id, name: users.name, email: users.email, ghlUserId: users.ghlUserId })
        .from(users)
        .where(isNotNull(users.ghlUserId));

      // Filter to specific reps if requested
      const repEmails = reps ? reps.split(",").map((e) => e.trim()).filter(Boolean) : [];
      let targetUsers = allUsers.filter((u) => u.ghlUserId);

      if (rep) {
        targetUsers = targetUsers.filter((u) => u.email === rep);
      } else if (repEmails.length > 0) {
        targetUsers = targetUsers.filter((u) => repEmails.includes(u.email));
      }

      // Fetch GHL events for all target users in parallel
      const eventArrays = await Promise.all(
        targetUsers.map((u) =>
          fetchGHLEventsForUser(u.ghlUserId!, startMs, endMs, u.email, u.name)
        )
      );
      const rawGhlEvents = eventArrays.flat();

      // Deduplicate GHL events across reps (same event can appear for multiple attendees)
      const deduped = new Map<string, UnifiedCall>();
      for (const event of rawGhlEvents) {
        // Key on startTime + contactName to catch cross-rep duplicates
        const key = `${event.startedAt}::${(event.contactName ?? "").toLowerCase().trim()}`;
        if (deduped.has(key)) {
          const existing = deduped.get(key)!;
          // Append rep name if different
          if (event.repName && existing.repName && !existing.repName.includes(event.repName.split(" ")[0])) {
            existing.repName = `${existing.repName}, ${event.repName.split(" ")[0]}`;
          }
        } else {
          deduped.set(key, event);
        }
      }
      ghlEvents = Array.from(deduped.values());

      // Apply search filter to GHL events (DB calls already filtered by SQL)
      if (search) {
        const lowerSearch = search.toLowerCase();
        ghlEvents = ghlEvents.filter(
          (e) => e.contactName?.toLowerCase().includes(lowerSearch)
        );
      }
    }

    // ── 3. Merge and deduplicate ────────────────────────────────────────

    // Remove GHL events that match an existing DB call (same time within 5 min window)
    const dbTimestamps = new Set(
      dbRows.map((r) => Math.round(new Date(r.startedAt).getTime() / 300_000)) // 5-min buckets
    );
    const uniqueGhlEvents = ghlEvents.filter((e) => {
      const bucket = Math.round(new Date(e.startedAt).getTime() / 300_000);
      return !dbTimestamps.has(bucket);
    });

    const merged = [...dbRows, ...uniqueGhlEvents].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );

    // ── 4. Compute metrics (DB calls only — scheduled calls are future) ─

    let metricsResult = { totalCalls: 0, totalTalkSeconds: 0, avgDurationSeconds: 0, meetingsHeld: 0 };

    if (type !== "scheduled") {
      const [rawMetrics] = await client
        .select({
          totalCalls:         count(),
          totalTalkSeconds:   sum(calls.durationSeconds),
          avgDurationSeconds: avg(calls.durationSeconds),
        })
        .from(calls)
        .where(where);

      const meetConditions = [...conditions, eq(calls.callType, "meet")];
      const [meetRow] = await client
        .select({ meetingsHeld: count() })
        .from(calls)
        .where(and(...meetConditions));

      metricsResult = {
        totalCalls:         Number(rawMetrics.totalCalls),
        totalTalkSeconds:   rawMetrics.totalTalkSeconds ? Number(rawMetrics.totalTalkSeconds) : 0,
        avgDurationSeconds: rawMetrics.avgDurationSeconds ? Number(rawMetrics.avgDurationSeconds) : 0,
        meetingsHeld:       Number(meetRow?.meetingsHeld ?? 0),
      };
    }

    // Add scheduled count to total so the count label reflects all visible rows
    const scheduledCount = uniqueGhlEvents.length;
    const totalVisible = metricsResult.totalCalls + scheduledCount;

    return NextResponse.json({
      calls: merged,
      total: totalVisible,
      metrics: {
        ...metricsResult,
        totalCalls: totalVisible,
        scheduledCalls: scheduledCount,
      },
    });
  } catch (err) {
    console.error("[GET /api/calls]", err);
    return NextResponse.json({ error: "Failed to fetch calls" }, { status: 500 });
  }
}
