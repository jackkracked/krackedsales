import { and, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ghlAppointments } from "@/lib/db/schema";
import { ghl, GHLError, locationId } from "@/lib/ghl/client";
import { acquireJobLock, releaseJobLock } from "@/lib/jobs/lock";
import { isBookedCallCalendar } from "@/lib/booking/calendars";

/**
 * Keep `ghl_appointments` in step with every booked-call calendar, INCLUDING cancellations.
 *
 * WHY THIS AND NOT `calls`
 * `calls` skips cancelled appointments and never stores when a call was booked, so it cannot
 * show a setter "cancelled on 14 Sep, −$25" and cannot order a rebook chain. Measured
 * 2026-09-25: GoHighLevel returns cancelled events (9 of 245) with `dateAdded` on all of them.
 *
 * DELETED MEANS A 404, NEVER "NOT IN THE LIST"
 * An appointment can vanish from a calendar's list because it moved to another calendar, moved
 * outside the fetched window, or the calendar read failed. Only a per-id lookup answering 404 (or
 * `deleted: true`) marks it deleted, and only rows whose start was inside the window of a
 * calendar that was read successfully are ever probed. (Plan S8; same rule as the pipeline sweep.)
 */

const LOCK_KEY = "sync-appointments";
const LOCK_TTL_SECONDS = 600;
/** Commission is owed forever (Jack, 2026-09-25), so the first run reaches back a year. */
const BACK_DAYS = 400;
const AHEAD_DAYS = 550;
/** Probes per run. A normal day has a handful; the cap only bounds a pathological run. */
const MAX_PROBES = 60;
const DAY_MS = 86_400_000;

interface GhlEvent {
  id?: string;
  contactId?: string;
  calendarId?: string;
  assignedUserId?: string;
  dateAdded?: string;
  startTime?: string;
  appointmentStatus?: string;
  status?: string;
  deleted?: boolean;
  createdBy?: { source?: string; userId?: string | null } | string;
}

export interface AppointmentSyncResult {
  status: "ok" | "refused" | "failed";
  calendars: number;
  calendarsFailed: number;
  upserted: number;
  probed: number;
  markedDeleted: number;
  markedMoved: number;
  error?: string;
}

function toRow(ev: GhlEvent, calendarId: string, calendarName: string) {
  const start = ev.startTime ? new Date(ev.startTime) : null;
  if (!ev.id || !start || Number.isNaN(start.getTime())) return null;
  const added = ev.dateAdded ? new Date(ev.dateAdded) : null;
  const createdBy = typeof ev.createdBy === "object" && ev.createdBy ? ev.createdBy : null;
  return {
    id: ev.id,
    contactId: ev.contactId ?? null,
    // The calendar we ASKED for, never the one the payload claims (same rule as attribution).
    calendarId,
    calendarName,
    assignedUserId: ev.assignedUserId ?? null,
    createdBySource: createdBy?.source ?? (typeof ev.createdBy === "string" ? ev.createdBy : null),
    createdByUserId: createdBy?.userId ?? null,
    dateAdded: added && !Number.isNaN(added.getTime()) ? added : null,
    startTime: start,
    status: (ev.appointmentStatus ?? ev.status ?? "unknown").toLowerCase(),
    deleted: ev.deleted === true,
  };
}

export async function syncAppointments(now: Date = new Date()): Promise<AppointmentSyncResult> {
  const result: AppointmentSyncResult = {
    status: "ok", calendars: 0, calendarsFailed: 0, upserted: 0, probed: 0, markedDeleted: 0, markedMoved: 0,
  };
  if (!(await acquireJobLock(LOCK_KEY, LOCK_TTL_SECONDS))) return { ...result, status: "refused" };

  try {
    const runStart = new Date();
    const startMs = now.getTime() - BACK_DAYS * DAY_MS;
    const endMs = now.getTime() + AHEAD_DAYS * DAY_MS;

    const { calendars = [] } = await ghl.getPatient<{ calendars?: Array<{ id: string; name?: string }> }>(
      `/calendars/?locationId=${locationId()}`,
    );
    const bookedCalendars = calendars.filter((c) => isBookedCallCalendar(c.name ?? ""));
    const bookedIds = new Set(bookedCalendars.map((c) => c.id));
    result.calendars = bookedCalendars.length;

    const readOk: string[] = [];
    for (const cal of bookedCalendars) {
      let events: GhlEvent[];
      try {
        const res = await ghl.getPatient<{ events?: GhlEvent[] }>(
          `/calendars/events?locationId=${locationId()}&calendarId=${cal.id}&startTime=${startMs}&endTime=${endMs}`,
        );
        events = res.events ?? [];
      } catch (err) {
        // An unreadable calendar is skipped AND excluded from deletion probing below, so a
        // GoHighLevel hiccup can never be mistaken for fifty cancellations.
        result.calendarsFailed++;
        console.error(`[sync-appointments] calendar ${cal.id} unreadable`, err);
        continue;
      }
      readOk.push(cal.id);

      // One row per id: GoHighLevel has been seen to repeat an event in a page, and a repeated id
      // in one INSERT ... ON CONFLICT makes Postgres reject the whole chunk.
      const byId = new Map<string, NonNullable<ReturnType<typeof toRow>>>();
      for (const e of events) {
        const r = toRow(e, cal.id, cal.name ?? "");
        if (r) byId.set(r.id, r);
      }
      const rows = [...byId.values()];
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        await db().insert(ghlAppointments).values(chunk.map((r) => ({
          id: r.id, contactId: r.contactId, calendarId: r.calendarId, calendarName: r.calendarName,
          assignedUserId: r.assignedUserId, createdBySource: r.createdBySource, createdByUserId: r.createdByUserId,
          dateAdded: r.dateAdded, startTime: r.startTime, status: r.status,
          cancelledSeenAt: r.status === "cancelled" ? runStart : null,
          deletedAt: r.deleted ? runStart : null,
          lastSeenAt: runStart,
        }))).onConflictDoUpdate({
          target: ghlAppointments.id,
          set: {
            contactId: sql`excluded.contact_id`,
            calendarId: sql`excluded.calendar_id`,
            calendarName: sql`excluded.calendar_name`,
            assignedUserId: sql`excluded.assigned_user_id`,
            createdBySource: sql`excluded.created_by_source`,
            createdByUserId: sql`excluded.created_by_user_id`,
            // A booking time never changes; keep the first one we saw if GHL ever omits it.
            dateAdded: sql`coalesce(${ghlAppointments.dateAdded}, excluded.date_added)`,
            startTime: sql`excluded.start_time`,
            status: sql`excluded.status`,
            cancelledSeenAt: sql`coalesce(${ghlAppointments.cancelledSeenAt}, excluded.cancelled_seen_at)`,
            // Being in the list proves it exists, so a row back from the dead is un-deleted.
            // Only GoHighLevel's own `deleted: true` keeps it deleted.
            deletedAt: sql`CASE WHEN excluded.deleted_at IS NULL THEN NULL ELSE coalesce(${ghlAppointments.deletedAt}, excluded.deleted_at) END`,
            // Back on a booked-call calendar, so it is not "moved" any more.
            movedToCalendarId: sql`NULL`,
            lastSeenAt: sql`excluded.last_seen_at`,
          },
        });
        result.upserted += chunk.length;
      }
    }

    // Rows that were in a successfully read window but did not come back this run.
    for (const calendarId of readOk) {
      if (result.probed >= MAX_PROBES) break;
      const vanished = await db()
        .select({ id: ghlAppointments.id })
        .from(ghlAppointments)
        .where(and(
          eq(ghlAppointments.calendarId, calendarId),
          lt(ghlAppointments.lastSeenAt, runStart),
          isNull(ghlAppointments.deletedAt),
          isNull(ghlAppointments.movedToCalendarId),
          gte(ghlAppointments.startTime, new Date(startMs)),
          lte(ghlAppointments.startTime, new Date(endMs)),
        ))
        .limit(MAX_PROBES - result.probed);

      for (const { id } of vanished) {
        result.probed++;
        try {
          const res = await ghl.getPatient<{ appointment?: GhlEvent }>(`/calendars/events/appointments/${id}`);
          const a = res.appointment;
          if (!a) {
            // A 200 with no appointment is not proof of anything. Leave it for the next run.
            console.warn(`[sync-appointments] probe ${id}: 200 with no appointment body`);
            continue;
          }
          if (a.deleted === true) {
            await db().update(ghlAppointments).set({ deletedAt: new Date() }).where(eq(ghlAppointments.id, id));
            result.markedDeleted++;
          } else if (a.calendarId && !bookedIds.has(a.calendarId)) {
            await db().update(ghlAppointments)
              .set({ movedToCalendarId: a.calendarId, lastSeenAt: new Date() })
              .where(eq(ghlAppointments.id, id));
            result.markedMoved++;
          }
          else {
            // It still exists on a booked-call calendar (moved between two of them, or its time
            // moved out of the window). Mark it seen so it is not probed again every run and
            // crowding real deletions out of the probe budget.
            await db().update(ghlAppointments).set({ lastSeenAt: new Date() }).where(eq(ghlAppointments.id, id));
          }
        } catch (err) {
          if (err instanceof GHLError && err.status === 404) {
            await db().update(ghlAppointments).set({ deletedAt: new Date() }).where(eq(ghlAppointments.id, id));
            result.markedDeleted++;
          } else {
            console.error(`[sync-appointments] probe ${id} failed`, err);
          }
        }
      }
    }

    await releaseJobLock(LOCK_KEY, { status: "ok", detail: `${result.upserted} upserted`, result });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await releaseJobLock(LOCK_KEY, { status: "failed", detail: message, result }).catch(() => {});
    return { ...result, status: "failed", error: message };
  }
}
