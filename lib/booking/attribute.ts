import { and, desc, eq, gt, isNotNull, isNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookingLinks } from "@/lib/db/schema";
import { ghl, locationId } from "@/lib/ghl/client";
import { acquireJobLock, releaseJobLock } from "@/lib/jobs/lock";

/**
 * Credit a booked call back to the tracked link that caused it.
 *
 * THE PROBLEM THIS SOLVES
 * Most appointments at this location are created by GoHighLevel's `booking_widget`, meaning the
 * PROSPECT booked themselves. GoHighLevel records no user against those, so nothing in it can
 * answer "whose work produced this booking". Kelsey is paid $25 per booked call, so "we cannot
 * tell" is not an acceptable answer. A link minted here per send closes the gap: we know who
 * generated it and for whom, and this job joins that to the appointment.
 *
 * WHY IT READS GOHIGHLEVEL RATHER THAN OUR OWN `calls` MIRROR
 * `calls` has the appointments, but `sync-calls` runs once a day. Matching locally would mean
 * "a row appeared after the link was sent", which with a daily sync wrongly credits a booking
 * made hours BEFORE the link went out. `/calendars/events` returns `dateAdded`, the moment the
 * appointment was actually created, which makes the match a fact rather than a guess.
 *
 * THE BIAS, STATED ONCE: this pays people. A credit given to the wrong person is invisible,
 * because the row looks perfect on its own. A credit not given is visible, because someone asks
 * where their money is. So every rule below is deliberately built to under-credit rather than
 * over-credit, and anything uncertain is left uncredited.
 *
 * COST: one call per CALENDAR that has an open link, typically one or two, however many links
 * are outstanding. Matching is then done in memory.
 */

/** A link older than this did not cause today's booking. */
const WINDOW_DAYS = 30;
/**
 * The scan reaches further back than the match rule, so a booking made in the last hours of a
 * link's eligibility is not missed simply because the cron fires after the window shuts.
 * The strict `WINDOW_DAYS` test below still decides every credit.
 */
const SCAN_DAYS = 33;
/** Prospects book months out. Matches the 550 used by the booked-calls KPI for the same reason. */
const LOOKAHEAD_DAYS = 550;
/** A slot can be booked into the past by hand, so the fetch floor sits before the oldest link. */
const BACKSTOP_DAYS = 2;
const DAY_MS = 86_400_000;
const LOCK_KEY = "attribute-bookings";
/** Must stay above the route's maxDuration, so a killed run cannot hold the lease. */
const LOCK_TTL_SECONDS = 600;
/**
 * Measured 2026-09-23: the busiest calendar returns 102 events across a 640-day span, so
 * nothing is near a cap today. If one ever appears, a silently truncated page would drop the
 * furthest-out bookings, which is exactly what LOOKAHEAD_DAYS exists to catch. Loud beats quiet.
 */
const SUSPICIOUS_EVENT_COUNT = 500;

interface ApptEvent {
  id?: string;
  contactId?: string;
  calendarId?: string;
  /** When the appointment was CREATED. The whole design rests on this field. */
  dateAdded?: string;
  appointmentStatus?: string;
  status?: string;
  /** `{source, userId}` when booked inside GoHighLevel; absent userId on self-service. */
  createdBy?: { source?: string; userId?: string } | string;
  deleted?: boolean;
}

/** An event, with the things this job actually decides on already resolved. */
interface Candidate {
  id: string;
  contactId: string;
  calendarId: string;
  bookedMs: number;
}

export interface AttributionResult {
  status: "ok" | "refused" | "failed";
  pending: number;
  calendars: number;
  /** Calendars whose events could not be read. Non-zero means this run saw an incomplete picture. */
  calendarsFailed: number;
  credited: number;
  /** Matched an appointment another link had already claimed. Expected, not an error. */
  alreadyClaimed: number;
  /** Another runner credited the link between our read and our write. */
  lostRace: number;
  error?: string;
}

/**
 * Did this write lose to the "one appointment pays one link" index?
 *
 * Drizzle wraps the driver error, so `String(err)` is only the failed SQL: the constraint name
 * and the Postgres code live on `err.cause`. Matching the wrapper text silently classifies a
 * working guard as an unknown failure, which is exactly what it did the first time.
 */
function isAlreadyClaimed(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 5; depth++) {
    const c = e as { code?: string; constraint?: string; cause?: unknown };
    if (c.code === "23505" || c.constraint === "booking_links_appointment_uniq") return true;
    e = c.cause;
  }
  return false;
}

/**
 * Did the PROSPECT book this themselves, off a link?
 *
 * An allow-list of one, not a deny-list, and deliberately so. Measured across the live location
 * on 2026-09-23: 124 of 194 appointments are `booking_widget` (the prospect, off a link), 50 are
 * `google_calendar` (synced in from someone's own calendar) and 20 are `contactdetails_page` (a
 * GHL user booking by hand, who is already credited through `calls.booked_by_ghl_user_id`).
 *
 * Only the first kind can have been caused by a link we sent. Crediting the other two would pay
 * a setter for a call a colleague booked by hand, which is the exact failure this job exists to
 * prevent. If GoHighLevel ever adds a new self-service source, this under-credits until the name
 * is added here, and someone asking where their $25 went is a far better outcome than someone
 * quietly being paid for a colleague's work.
 */
function isSelfBooked(ev: ApptEvent): boolean {
  if (typeof ev.createdBy !== "object" || ev.createdBy === null) return false;
  // A user id means a human booked it inside GoHighLevel. Not ours to credit.
  if (ev.createdBy.userId) return false;
  return ev.createdBy.source === "booking_widget";
}

export async function attributeBookings(): Promise<AttributionResult> {
  const empty: AttributionResult = {
    status: "ok", pending: 0, calendars: 0, calendarsFailed: 0,
    credited: 0, alreadyClaimed: 0, lostRace: 0,
  };

  // One runner at a time. Two concurrent passes could each read the same link as pending and
  // both try to credit it; the unique index would stop the double-pay, but the lock stops the
  // wasted GoHighLevel calls and the confusing log.
  if (!(await acquireJobLock(LOCK_KEY, LOCK_TTL_SECONDS))) {
    return { ...empty, status: "refused" };
  }

  try {
    // Links still waiting to convert. `delivery = 'booked'` is excluded because a direct
    // booking was credited the moment the rep made it; there is nothing left to match.
    //
    // A link must have been CLICKED to be eligible. GoHighLevel sends its own booking links
    // from automations, so a prospect who ignored ours and booked from one of those produced a
    // `booking_widget` appointment that our link had no part in. Without this clause that
    // booking would pay whoever happened to have an unclicked link open.
    const pending = await db()
      .select({
        id: bookingLinks.id,
        contactId: bookingLinks.ghlContactId,
        calendarId: bookingLinks.calendarId,
        createdAt: bookingLinks.createdAt,
        firstClickedAt: bookingLinks.firstClickedAt,
      })
      .from(bookingLinks)
      .where(and(
        isNull(bookingLinks.bookedAt),
        ne(bookingLinks.delivery, "booked"),
        isNotNull(bookingLinks.firstClickedAt),
        gt(bookingLinks.createdAt, new Date(Date.now() - SCAN_DAYS * DAY_MS)),
      ))
      // Deterministic, so the last-touch tie-break below cannot depend on which plan Postgres
      // happened to choose.
      .orderBy(desc(bookingLinks.createdAt), desc(bookingLinks.id));

    if (pending.length === 0) {
      await releaseJobLock(LOCK_KEY, { status: "ok", detail: "no pending links", result: empty });
      return empty;
    }

    // Appointments that already pay someone. Without this, a link that lost on last touch
    // retries the same rejected write every three hours until it ages out of the window.
    const claimedRows = await db()
      .select({ id: bookingLinks.ghlAppointmentId })
      .from(bookingLinks)
      .where(isNotNull(bookingLinks.ghlAppointmentId));
    const claimed = new Set(claimedRows.map((r) => r.id!));

    const calendarIds = [...new Set(pending.map((p) => p.calendarId))];
    const earliest = Math.min(...pending.map((p) => p.createdAt.getTime()));
    const startMs = earliest - BACKSTOP_DAYS * DAY_MS;
    const endMs = Date.now() + LOOKAHEAD_DAYS * DAY_MS;

    const usable: Candidate[] = [];
    let calendarsFailed = 0;

    for (const calendarId of calendarIds) {
      try {
        // `getPatient`, not `get`: this is a background job with nothing waiting on it, and the
        // default policy gives up after ~2s. A rate-limit here would skip the calendar for three
        // hours, and a link near the end of its window would lose its credit permanently.
        const res = await ghl.getPatient<{ events?: ApptEvent[] }>(
          `/calendars/events?locationId=${locationId()}&calendarId=${calendarId}` +
          `&startTime=${startMs}&endTime=${endMs}`,
        );
        const events = res.events ?? [];
        if (events.length >= SUSPICIOUS_EVENT_COUNT) {
          console.warn(
            `[attribute-bookings] calendar ${calendarId} returned ${events.length} events; ` +
            `this may be a truncated page and far-future bookings could be missing`,
          );
        }

        for (const ev of events) {
          if (!ev.id || !ev.contactId || ev.deleted === true) continue;
          if (claimed.has(ev.id)) continue;
          // A cancelled appointment is not a booked call. The booked-calls KPI excludes these,
          // and a pay sheet that disagreed with the KPI would be argued about every month.
          if ((ev.appointmentStatus ?? ev.status ?? "").toLowerCase() === "cancelled") continue;
          if (!isSelfBooked(ev)) continue;

          const bookedMs = ev.dateAdded ? Date.parse(ev.dateAdded) : NaN;
          if (!Number.isFinite(bookedMs)) {
            // Dropping it silently would also corrupt the sort below, because a NaN comparator
            // makes the whole ordering implementation-defined, not just this one entry.
            console.warn(`[attribute-bookings] appointment ${ev.id} has unusable dateAdded: ${ev.dateAdded}`);
            continue;
          }

          usable.push({
            id: ev.id,
            contactId: ev.contactId,
            // The calendar we ASKED for, never the one the payload claims. A missing
            // `calendarId` must not be allowed to turn the strictest rule here into a no-op.
            calendarId,
            bookedMs,
          });
        }
      } catch (err) {
        // One unreadable calendar must not stop the others from being credited. The links on
        // it stay pending and the next run picks them up.
        calendarsFailed++;
        console.error(`[attribute-bookings] calendar ${calendarId} unreadable`, err);
      }
    }

    // Earliest booking first, so when one link could match two appointments the FIRST one
    // claims it. A link represents one send, and one send earns one booked call.
    usable.sort((a, b) => a.bookedMs - b.bookedMs);

    const spent = new Set<string>();
    let credited = 0;
    let alreadyClaimed = 0;
    let lostRace = 0;

    for (const ev of usable) {
      const candidates = pending.filter((p) =>
        !spent.has(p.id) &&
        p.contactId === ev.contactId &&
        p.calendarId === ev.calendarId &&
        // The causal chain, in order: sent, then clicked, then booked.
        ev.bookedMs > p.createdAt.getTime() &&
        ev.bookedMs >= (p.firstClickedAt?.getTime() ?? Infinity) &&
        // Not so long after the send that the link is still a plausible cause.
        ev.bookedMs <= p.createdAt.getTime() + WINDOW_DAYS * DAY_MS
      );
      if (candidates.length === 0) continue;

      // LAST TOUCH. If two people sent this prospect a link, the booking belongs to whoever
      // sent the one they most recently received. `id` breaks an exact timestamp tie so the
      // outcome is reproducible rather than merely unlikely to differ.
      const winner = candidates.reduce((a, b) => {
        if (b.createdAt.getTime() !== a.createdAt.getTime()) return b.createdAt > a.createdAt ? b : a;
        return b.id > a.id ? b : a;
      });

      try {
        const updated = await db()
          .update(bookingLinks)
          .set({ bookedAt: new Date(ev.bookedMs), ghlAppointmentId: ev.id })
          // `isNull` again, not just the id: another runner may have credited it between the
          // read above and this write. An existing credit is never overwritten.
          .where(and(eq(bookingLinks.id, winner.id), isNull(bookingLinks.bookedAt)))
          .returning({ id: bookingLinks.id });

        if (updated.length > 0) {
          spent.add(winner.id);
          claimed.add(ev.id);
          credited++;
        } else {
          lostRace++;
        }
      } catch (err) {
        // The unique index rejected it: this appointment already pays someone else. That is
        // the guard working, not a failure, so the run continues.
        if (isAlreadyClaimed(err)) {
          claimed.add(ev.id);
          alreadyClaimed++;
          continue;
        }
        console.error(`[attribute-bookings] could not credit link ${winner.id}`, err);
      }
    }

    const result: AttributionResult = {
      status: "ok",
      pending: pending.length,
      calendars: calendarIds.length,
      calendarsFailed,
      credited,
      alreadyClaimed,
      lostRace,
    };
    // A run that could read nothing is not a quiet run, and must never be recorded as one.
    const blind = calendarsFailed > 0 && calendarsFailed === calendarIds.length;
    await releaseJobLock(LOCK_KEY, {
      status: blind ? "failed" : "ok",
      detail: blind
        ? `all ${calendarsFailed} calendar(s) unreadable; credited nothing`
        : `credited ${credited} of ${pending.length} pending` +
          (calendarsFailed ? `, ${calendarsFailed} calendar(s) unreadable` : ""),
      result,
    });
    return blind ? { ...result, status: "failed", error: "all calendars unreadable" } : result;
  } catch (err) {
    // NEVER THROWS. This runs on a cron; a thrown error would show as a failed job and tell
    // nobody anything useful. The links stay pending and the next run retries them.
    const message = err instanceof Error ? err.message : String(err);
    console.error("[attribute-bookings] failed", err);
    await releaseJobLock(LOCK_KEY, { status: "failed", detail: message }).catch(() => {});
    return { ...empty, status: "failed", error: message };
  }
}
