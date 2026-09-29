import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, calls, proposals, activityEvents, callDispositions } from "@/lib/db/schema";
import { and, eq, gte, lte, count, sum, isNotNull, or, sql, inArray } from "drizzle-orm";
import { ghl, locationId } from "@/lib/ghl/client";
import { getOpenCountsByRepFromMirror } from "@/lib/rep-metrics/mirror-source";
import {
  startOfDay, endOfDay,
  startOfWeek, endOfWeek,
  startOfMonth, endOfMonth,
  subDays,
} from "date-fns";
import { getSessionUser } from "@/lib/auth/session";
import { closerSql, dealsSetBy } from "@/lib/proposals/credit";
import { getPayoutTiming, getRepCommissionEvents } from "@/lib/kpi/rep-proposal-commission";
import { loadSettingsRows, resolveSettings } from "@/lib/tracker/settings";
import { nyMonth } from "@/lib/tracker/months";

export const dynamic = "force-dynamic";

type TimeRange = "today" | "week" | "month" | "30d" | "90d" | "all";

function getRange(range: TimeRange): { start: Date | null; end: Date } {
  const now = new Date();
  const end = endOfDay(now);
  switch (range) {
    case "today":  return { start: startOfDay(now), end };
    case "week":   return { start: startOfWeek(now, { weekStartsOn: 1 }), end };
    case "month":  return { start: startOfMonth(now), end };
    case "30d":    return { start: subDays(now, 30), end };
    case "90d":    return { start: subDays(now, 90), end };
    case "all":    return { start: null, end };
  }
}

/**
 * GET /api/dashboard/rep-performance?range=week
 * GET /api/dashboard/rep-performance?start=2025-01-01&end=2025-02-01
 *
 * Returns per-rep leaderboard data: calls, demos created, proposals sent,
 * deals closed, and open leads.
 * Accepts either a `range` preset or explicit `start`/`end` (YYYY-MM-DD, end exclusive).
 */
export async function GET(req: NextRequest) {
  // Team-wide performance incl. closed-deal $ — admins only.
  const actor = await getSessionUser().catch(() => null);
  if (actor?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const startParam = req.nextUrl.searchParams.get("start");
  const endParam = req.nextUrl.searchParams.get("end");

  let start: Date | null;
  let end: Date;

  if (startParam && endParam) {
    // Explicit date range — `end` is exclusive (start of next day)
    start = new Date(startParam + "T00:00:00");
    end = new Date(endParam + "T00:00:00");
  } else {
    const range = (req.nextUrl.searchParams.get("range") ?? "week") as TimeRange;
    ({ start, end } = getRange(range));
  }

  // Fetch all active users
  const allUsers = await db()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      ghlUserId: users.ghlUserId,
      commissionPct: users.commissionPct,
    })
    .from(users)
    .where(eq(users.isActive, true));

  const locId = locationId();

  // Open-count source: default reads the local mirror in ONE SQL GROUP BY (vs one live GHL
  // call per rep). `?feed=live` restores the per-rep GHL scrape as a rollback lever.
  const oppsFeed = req.nextUrl.searchParams.get("feed") === "live" ? "live" : "mirror";
  const openMap = oppsFeed === "mirror" ? await getOpenCountsByRepFromMirror() : null;

  // Reliable open-opportunity count for a rep: ask GHL for the filtered total
  // directly (assigned_to + status=open) and read meta.total. Fetching ALL opps
  // and filtering client-side was unreliable — GHL's page-based pagination over
  // 3000+ opps returned inconsistent partial sets, so the number flickered.
  async function openCountFor(ghlUserId: string): Promise<number> {
    try {
      const res = await ghl.get<{ meta?: { total?: number } }>(
        `/opportunities/search?location_id=${locId}&assigned_to=${ghlUserId}&status=open&limit=1`
      );
      return res.meta?.total ?? 0;
    } catch (err) {
      console.error("[rep-performance] open count failed:", err);
      return 0;
    }
  }

  // Deals each setter is firmly credited with (lib/proposals/credit.ts), computed once.
  const setDeals = await dealsSetBy(start ?? null, end);

  // Build per-rep metrics
  const reps = await Promise.all(
    allUsers.map(async (user) => {
      // Calls — count from the DB calls table only (synced meet + dialer calls).
      // We deliberately do NOT also add live calendar events: booked calls are
      // already in the DB as "meet", so adding them double-counted the tally.
      const callWhere = start
        ? and(eq(calls.repEmail, user.email), gte(calls.startedAt, start), lte(calls.startedAt, end))
        : eq(calls.repEmail, user.email);
      const [callRow] = await db().select({ c: count() }).from(calls).where(callWhere);
      const totalCalls = Number(callRow?.c ?? 0);

      // Proposals sent (sentAt within range) by the deal's CLOSER. Jack, 2026-09-29: sent, closed
      // and close rate belong to one person, the closer, even when someone else clicked send.
      const isCloser = sql`${closerSql} = ${user.id}`;
      const propSentWhere = start
        ? and(isCloser, isNotNull(proposals.sentAt), gte(proposals.sentAt, start), lte(proposals.sentAt, end))
        : and(isCloser, isNotNull(proposals.sentAt));
      const [propRow] = await db().select({ c: count() }).from(proposals).where(propSentWhere);

      // Deals closed — proposals THIS REP sent that got paid in the period.
      // Count and $ value come from the same set, so they always agree (and match
      // the commission dashboard). GHL won-opps are intentionally excluded.
      const dealsWhere = start
        ? and(isCloser, isNotNull(proposals.paidAt), gte(proposals.paidAt, start), lte(proposals.paidAt, end))
        : and(isCloser, isNotNull(proposals.paidAt));
      const [dealRow] = await db()
        .select({ c: count(), v: sum(proposals.totalAmount) })
        .from(proposals)
        .where(dealsWhere);
      const totalClosed = Number(dealRow?.c ?? 0);
      const closedValue = Number(dealRow?.v ?? 0);

      // Demos CREATED by this rep (Jack, 2026-08-07: created, not delivered).
      // Counted from the activity trail rather than demo_boards: board creation is a
      // deliberately non-fatal side effect of the demo webhook, so a board that failed to
      // build would silently cost the rep their credit. The event is the fact; the board is
      // an artefact. Only demos submitted after 2026-08-07 carry attribution — nothing before
      // that recorded who pressed the button, and inventing history would be worse than a
      // short series.
      const demoWhere = start
        ? and(eq(activityEvents.userId, user.id), eq(activityEvents.action, "demo.created"),
              gte(activityEvents.createdAt, start), lte(activityEvents.createdAt, end))
        : and(eq(activityEvents.userId, user.id), eq(activityEvents.action, "demo.created"));
      const [demoRow] = await db().select({ c: count() }).from(activityEvents).where(demoWhere);

      // Open leads — from the mirror (one shared GROUP BY) by default; live per-rep GHL when ?feed=live.
      const openLeads = !user.ghlUserId
        ? 0
        : oppsFeed === "mirror"
          ? openMap!.get(user.ghlUserId)?.openCount ?? 0
          : await openCountFor(user.ghlUserId);

      // ── SETTER METRIC: calls this rep BOOKED ───────────────────────────────────────────
      // `calls.repEmail` is who ATTENDED. A setter books for closers, so counting attendance
      // credits the closer and leaves the setter on zero. `bookedByGhlUserId` is populated by
      // the calls sync (createdBy.userId) and by scripts/attribute-booked-calls.mjs, which also
      // credits a rep who SENT the booking link the prospect used, and falls back to the
      // contact's owner. Cold ad-bookings stay unattributed on purpose — nobody set them.
      const bookedWhere = !user.ghlUserId
        ? null
        : start
          ? and(eq(calls.bookedByGhlUserId, user.ghlUserId), gte(calls.startedAt, start), lte(calls.startedAt, end))
          : eq(calls.bookedByGhlUserId, user.ghlUserId);
      const callsBooked = bookedWhere
        ? Number((await db().select({ c: count() }).from(calls).where(bookedWhere))[0]?.c ?? 0)
        : 0;

      // Of the calls they booked, how many were actually attended?
      //
      // The outcome comes from OUR OWN dispositions (set on the dashboard), not from GHL's
      // appointment status. GHL's status only ever reads `confirmed` or `completed` here — the
      // team marks outcomes in this app instead — so keying on it produced a permanent 0%.
      // `call_dispositions` carries the real answer: no_show (27) vs sent_proposal,
      // preparing_proposal, budget_objection, not_interested, needs_time, rebooked, demo_booked.
      //
      // Joined on the appointment id, which is how the calls sync builds meetConferenceId.
      // Only calls with a disposition count toward the rate, so an un-dispositioned call is
      // "unknown", never silently a no-show.
      let callsShowed = 0;
      let callsResolved = 0;
      if (user.ghlUserId) {
        // The appointments this rep booked, as GHL event ids. meetConferenceId is stored as
        // `ghlappt_<eventId>` by the calls sync, and call_dispositions keys on that same event id.
        const bookedRows = await db()
          .select({ meetConferenceId: calls.meetConferenceId })
          .from(calls)
          .where(
            start
              ? and(eq(calls.bookedByGhlUserId, user.ghlUserId), gte(calls.startedAt, start), lte(calls.startedAt, end))
              : eq(calls.bookedByGhlUserId, user.ghlUserId),
          );
        const eventIds = bookedRows
          .map((r) => r.meetConferenceId)
          .filter((v): v is string => !!v && v.startsWith("ghlappt_"))
          .map((v) => v.slice("ghlappt_".length));

        if (eventIds.length > 0) {
          const disp = await db()
            .select({ outcome: callDispositions.outcome })
            .from(callDispositions)
            .where(inArray(callDispositions.calendarEventId, eventIds));
          // `no_answer` is a dialer outcome, not a meeting result — excluded from both sides so
          // it cannot drag a setter's show rate down for something that was never a meeting.
          const meeting = disp.filter((d) => d.outcome !== "no_answer");
          callsResolved = meeting.length;
          callsShowed = meeting.filter((d) => d.outcome !== "no_show").length;
        }
      }

      // ── CLOSER METRICS, respecting the attribution override ────────────────────────────────
      // A deal counts for whoever CLOSED it. `closedBy` is normally null, meaning "same as
      // createdBy" — it exists for the case where one rep sends the proposal on another's
      // behalf (Tofu Go: Gage sent it, Alice closed it).
      // The same closer expression every pay and KPI surface uses (lib/proposals/credit.ts).
      const closedByThisRep = isCloser;
      // A deal is CLOSED when it is SIGNED, not when the last instalment clears.
      //
      // This previously keyed on `paidAt`, which the system only sets once a proposal is FULLY
      // collected. Alice had 4 signed deals worth $20,750 and read 0 / $0 / 0% / — across every
      // closer column, because only 2 were fully paid and both fell outside the month. A closer's
      // job ends at signature; collection is the billing engine's problem, and a 90-day spread
      // would otherwise credit the close three months late.
      //
      // It also matches the agreed commission rule — commission on signature — so the leaderboard
      // and the payout basis describe the same event.
      const attributedWhere = start
        ? and(closedByThisRep, isNotNull(proposals.signedAt), gte(proposals.signedAt, start), lte(proposals.signedAt, end))
        : and(closedByThisRep, isNotNull(proposals.signedAt));
      const [attributedRow] = await db()
        .select({ c: count(), v: sum(proposals.totalAmount) })
        .from(proposals)
        .where(attributedWhere);
      const attributedClosed = Number(attributedRow?.c ?? 0);
      const attributedValue = Number(attributedRow?.v ?? 0);

      const proposalsSent = Number(propRow?.c ?? 0);
      const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

      // ── CLOSE RATE IS COHORT-BASED ────────────────────────────────────────────────────────
      // "Of the proposals I SENT this period, how many have signed."
      //
      // It previously divided deals closed in the period by proposals sent in the period, which
      // compares two DIFFERENT cohorts: a deal sent in July and signed in August inflated
      // August's rate, and with a longer cycle the figure can exceed 100% entirely. Gage read
      // 75% off 4 sent / 3 closed while one of those closes belonged to July's cohort.
      //
      // Measured on real data: median time to close is 0.2 days, 74% sign the same day and 100%
      // within 14 days, with only 2 proposals ever crossing a month boundary. That short cycle is
      // why no maturity window is needed — "has it signed yet" is already a settled answer, so a
      // recent cohort is not unfairly penalised.
      //
      // Both sides key on the CLOSER, so this answers "how well do my deals convert", with the
      // same person on top and bottom of the fraction.
      const cohortWhere = start
        ? and(isCloser, isNotNull(proposals.sentAt), isNotNull(proposals.signedAt), gte(proposals.sentAt, start), lte(proposals.sentAt, end))
        : and(isCloser, isNotNull(proposals.sentAt), isNotNull(proposals.signedAt));
      const cohortClosed = Number((await db().select({ c: count() }).from(proposals).where(cohortWhere))[0]?.c ?? 0);

      return {
        id: user.id,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
        calls: totalCalls,
        demos: Number(demoRow?.c ?? 0),
        proposalsSent,
        // Kept for anything still reading the old field names.
        dealsClosed: totalClosed,
        closedValue,
        openLeads,

        // Setter.
        // Show rate is measured against calls with a DEFINITIVE outcome, not against everything
        // booked. The team does not mark no-shows in GHL — every past call stays `confirmed` —
        // so dividing by all booked calls reported a flat 0%, which reads as "nobody turns up"
        // when the truth is "we do not record it". Returning null renders an em dash instead,
        // and the number becomes meaningful the moment outcomes start being marked.
        callsBooked,
        callsShowed,
        // Signed deals they are credited as SETTER on (an admin's assignment or a proven booking).
        dealsSet: setDeals.get(user.id)?.length ?? 0,
        valueSet: (setDeals.get(user.id) ?? []).reduce((t, d) => t + d.totalAmount, 0),
        showRate: pct(callsShowed, callsResolved),

        // Closer — attributed by closedBy, so an override moves the credit with the deal.
        dealsClosedAttributed: attributedClosed,
        closedValueAttributed: attributedValue,
        // Cohort: of what they sent this period, how much signed. Cannot exceed 100%.
        closeRate: pct(cohortClosed, proposalsSent),
        cohortClosed,
        avgDealSize: attributedClosed > 0 ? Math.round(attributedValue / attributedClosed) : null,

        // Commission is what the Pay Tracker pays: the commission ENGINE (recognised when paid, per
        // the payout-timing setting), at the rate in force in the month each payment lands.
        // It used to be signed value × today's rate, which disagreed with people's actual pay.
        commissionPct: user.commissionPct ?? 0,
        commissionEarned: await commissionForRange(user.id, start, end),
      };
    })
  );

  return NextResponse.json({ reps });
}

/** The commission a person is PAID for [start, end], exactly as the Pay Tracker computes it. */
async function commissionForRange(userId: string, start: Date | null, end: Date): Promise<number> {
  const payoutTiming = await getPayoutTiming();
  const [events, rows] = await Promise.all([
    getRepCommissionEvents({ userId, commissionPct: 100, payoutTiming }),
    loadSettingsRows([userId]),
  ]);
  let cents = 0;
  for (const e of events) {
    if ((start && e.date < start) || e.date > end) continue;
    cents += Math.round(e.commission * resolveSettings(rows, nyMonth(e.date)).commissionPct);
  }
  return cents / 100;
}
