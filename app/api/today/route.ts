import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, isNull, lt, lte, or, sql } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  proposals, proposalInstalments, tasks, calls, todayItems, localStripeSubscriptions,
} from "@/lib/db/schema";
import {
  isChaseable, needsDecision, rankAndCap, type TodayItem, type ProposalChaseInput,
} from "@/lib/today/rules";
import { getSetterMonth } from "@/lib/tracker/setter";
import { can } from "@/lib/auth/permissions";
import { getCloserMonth } from "@/lib/tracker/closer";
import { nextMonthToClose } from "@/lib/tracker/actions";
import { currentNyMonth } from "@/lib/tracker/months";
import { closerSql } from "@/lib/proposals/credit";

const monthName = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
};

export const dynamic = "force-dynamic";

/**
 * The rep's Today list.
 *
 * RECOMPUTED ON EVERY CALL, deliberately. Jack, 2026-08-27: "make sure they're refreshed...
 * you might go in another day, and there might be a higher priority task for him." Nothing about
 * the list is stored, so it cannot go stale and a newly-urgent item always displaces a lower one.
 * The only persisted state is the rep's own Done / Snooze decisions in `today_items`.
 *
 * It replaces an LLM-written paragraph that ended "1,549 open leads requiring attention" and told
 * Gage to chase six clients who had already signed and paid. Nothing here is generated prose and
 * no number appears that the rep cannot act on.
 */

/** Each section reports its own health, so one dead source cannot masquerade as an empty list. */
interface SectionError { source: string; message: string }

export interface TodayResponse {
  items: TodayItem[];
  /** The single daily "this is neither alive nor actionable, decide" row. */
  decide: { sourceKey: string; personName: string; proposalId: string; sentDaysAgo: number } | null;
  /** True when every source succeeded AND produced nothing: a real clear day. */
  clear: boolean;
  snoozedCount: number;
  /** Non-empty means part of the list could not be built. Never silently swallowed. */
  errors: SectionError[];
  generatedAt: string;
}

export async function GET(_req: NextRequest) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const database = db();
  const errors: SectionError[] = [];
  const items: TodayItem[] = [];
  let decide: TodayResponse["decide"] = null;

  // ── The rep's own decisions. Anything done, or snoozed into the future, is suppressed. ──────
  let suppressed = new Set<string>();
  let snoozedCount = 0;
  try {
    const decisions = await database
      .select({
        sourceKey: todayItems.sourceKey,
        completedAt: todayItems.completedAt,
        snoozedUntil: todayItems.snoozedUntil,
      })
      .from(todayItems)
      .where(eq(todayItems.userId, user.id));
    suppressed = new Set(
      decisions
        .filter((d) => d.completedAt || (d.snoozedUntil && d.snoozedUntil > now))
        .map((d) => d.sourceKey),
    );
    snoozedCount = decisions.filter((d) => !d.completedAt && d.snoozedUntil && d.snoozedUntil > now).length;
  } catch (e) {
    errors.push({ source: "decisions", message: e instanceof Error ? e.message : "failed" });
  }

  // ── 1. Meetings today. Time-bound, cannot be moved, so they rank first. ─────────────────────
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
  try {
    const rows = await database
      .select({
        id: calls.id, contactId: calls.contactId, contactName: calls.contactName,
        startedAt: calls.startedAt, status: calls.status,
      })
      .from(calls)
      .where(and(
        eq(calls.callType, "meet"),
        gte(calls.startedAt, dayStart),
        lt(calls.startedAt, dayEnd),
        eq(calls.repEmail, user.email),
      ));
    for (const r of rows) {
      // A call already marked a no-show or completed is history, not a thing to do.
      if (r.status === "noshow" || r.status === "completed") continue;
      const when = new Date(r.startedAt);
      items.push({
        sourceKey: `call:${r.id}`,
        reason: "meeting",
        personName: r.contactName ?? "Unknown",
        contactId: r.contactId,
        // The time is NOT formatted here: this runs in UTC on Vercel, so a rep in another
        // timezone was being told a confidently wrong hour. The client formats `atISO`.
        action: "Call",
        because: "Booked for today",
        sortAt: when,
        atISO: when.toISOString(),
        href: r.contactId ? `/contacts?contact=${r.contactId}` : null,
      });
    }
  } catch (e) {
    errors.push({ source: "meetings", message: e instanceof Error ? e.message : "failed" });
  }

  // ── 2. Proposals awaiting a decision ────────────────────────────────────────────────────────
  // The Cheeky guard lives in lib/today/rules.ts, not here, and it is deliberately about MONEY
  // ARRIVING rather than proposal status, because status is the thing that goes stale.
  try {
    const rows = await database
      .select({
        id: proposals.id, contactName: proposals.contactName, ghlContactId: proposals.ghlContactId,
        status: proposals.status, sentAt: proposals.sentAt, signedAt: proposals.signedAt,
        paidAt: proposals.paidAt, lostAt: proposals.lostAt,
        depositsPaidTotal: proposals.depositsPaidTotal,
        stripeSubscriptionId: proposals.stripeSubscriptionId,
        paidInstalments: sql<number>`(
          SELECT count(*)::int FROM ${proposalInstalments} pi
          WHERE pi.proposal_id = ${proposals.id}
            AND (pi.status = 'paid' OR pi.paid_at IS NOT NULL)
        )`,
        liveSub: sql<number>`(
          SELECT count(*)::int FROM ${localStripeSubscriptions} s
          WHERE s.id = ${proposals.stripeSubscriptionId}
            AND s.status IN ('active','trialing','past_due')
        )`,
      })
      .from(proposals)
      // The deal's CLOSER chases it (the admin's choice, else whoever created it).
      .where(sql`${closerSql} = ${user.id}`);

    const oldest: Array<{ id: string; name: string; sentAt: Date; days: number }> = [];
    for (const r of rows) {
      const input: ProposalChaseInput = {
        status: r.status,
        sentAt: r.sentAt,
        signedAt: r.signedAt,
        paidAt: r.paidAt,
        lostAt: r.lostAt,
        depositsPaidTotal: r.depositsPaidTotal,
        hasPaidInstalment: Number(r.paidInstalments ?? 0) > 0,
        hasLiveSubscription: Number(r.liveSub ?? 0) > 0,
      };
      // Both predicates already require a real sentAt; this narrows it for the compiler and
      // makes the dependency explicit rather than implied.
      const sent = r.sentAt ? new Date(r.sentAt) : null;
      if (sent && isChaseable(input, now)) {
        const days = Math.floor((now.getTime() - sent.getTime()) / 86_400_000);
        items.push({
          sourceKey: `proposal:${r.id}:chase`,
          reason: "money",
          personName: r.contactName,
          contactId: r.ghlContactId,
          action: "Chase for a decision",
          because: days <= 0 ? "Proposal sent today" : `Proposal sent ${days} ${days === 1 ? "day" : "days"} ago`,
          sortAt: sent,
          href: `/proposals?id=${r.id}`,
        });
      } else if (sent && needsDecision(input, now)) {
        oldest.push({
          id: r.id, name: r.contactName, sentAt: sent,
          days: Math.floor((now.getTime() - sent.getTime()) / 86_400_000),
        });
      }
    }

    // ── The Decide row: exactly ONE per day, the single oldest. This is the only place a rep
    // ever meets the backlog, and it shows one name, never a total.
    oldest.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
    const pick = oldest.find((o) => !suppressed.has(`proposal:${o.id}:decide`));
    if (pick) {
      decide = {
        sourceKey: `proposal:${pick.id}:decide`,
        personName: pick.name,
        proposalId: pick.id,
        sentDaysAgo: pick.days,
      };
    }
  } catch (e) {
    errors.push({ source: "proposals", message: e instanceof Error ? e.message : "failed" });
  }

  // ── 3. The rep's own tasks, due or overdue ──────────────────────────────────────────────────
  try {
    const rows = await database
      .select({
        id: tasks.id, title: tasks.title, dueDate: tasks.dueDate,
        contactId: tasks.contactId, contactName: tasks.contactName,
      })
      .from(tasks)
      .where(and(
        eq(tasks.userId, user.id),
        eq(tasks.completed, false),
        or(isNull(tasks.dueDate), lte(tasks.dueDate, dayEnd)),
      ));
    for (const r of rows) {
      const due = r.dueDate ? new Date(r.dueDate) : now;
      const overdueDays = Math.floor((dayStart.getTime() - due.getTime()) / 86_400_000);
      items.push({
        sourceKey: `task:${r.id}`,
        reason: "task",
        // Never the title in both slots: an unlinked task used to render its title as the
        // heading AND the action, twice, both truncated.
        personName: r.contactName ?? "Task",
        contactId: r.contactId,
        action: r.title,
        because: overdueDays > 0 ? `${overdueDays} ${overdueDays === 1 ? "day" : "days"} overdue` : "Due today",
        sortAt: due,
        href: "/tasks",
      });
    }
  } catch (e) {
    errors.push({ source: "tasks", message: e instanceof Error ? e.message : "failed" });
  }

  // ── 4. The pay tracker: what only this person can settle ──────────────────────────────────
  // One row per KIND of gap, not one per call: a count the rep can clear in one visit to
  // /tracker, rather than twelve near-identical rows pushing real work off the list. Source keys
  // carry the count, so clearing some and then gaining more brings the row back.
  try {
    const month = currentNyMonth(now);
    if (user.role === "admin") {
      const due = await nextMonthToClose(now);
      if (due) {
        items.push({
          sourceKey: `pay:close:${due}`,
          reason: "pay",
          personName: "Team pay",
          action: `Close ${monthName(due)} pay`,
          because: "The month is over. Closing freezes everyone's pay for it.",
          sortAt: now,
          href: `/tracker?month=${due}`,
        });
      }
    }
    // Never point someone at a page they cannot open (setters stay off until go-live).
    const canSeeTracker = user.role === "admin" || (await can(user.id, user.role, "view_tracker"));
    if (user.role === "setter" && canSeeTracker) {
      const m = await getSetterMonth(user.id, month, now);
      const here = m.needsYou.confirm + m.needsYou.clash + m.needsYou.awaitingOutcome;
      const total = here + m.needsElsewhere.reduce((t, n) => t + n.count, 0);
      if (total > 0) {
        // Land on the earliest month with something waiting, so the filter is never empty.
        const target = m.needsElsewhere.find((n) => n.month < month)?.month ?? (here > 0 ? month : m.needsElsewhere[0].month);
        items.push({
          sourceKey: `pay:setter:${total}`,
          reason: "pay",
          personName: "Your pay",
          action: `Settle ${total} ${total === 1 ? "row" : "rows"} on your pay sheet`,
          because: m.needsYou.confirm > 0 ? "Bookings that look like yours count once you confirm them" : "They count toward your pay once settled",
          sortAt: now,
          href: `/tracker?month=${target}&needs=1`,
        });
      }
    } else if (user.role !== "setter" && canSeeTracker) {
      const c = await getCloserMonth(user.id, month, now);
      const n = c?.awaitingOutcome.length ?? 0;
      if (n > 0) {
        items.push({
          sourceKey: `pay:outcomes:${n}`,
          reason: "pay",
          personName: n === 1 ? (c!.awaitingOutcome[0].contactName ?? "A call you ran") : `${n} calls you ran`,
          action: n === 1 ? "Did they show?" : "Record who showed",
          because: "A setter is paid on these once you say",
          sortAt: now,
          href: "/tracker?needs=1",
        });
      }
    }
  } catch (e) {
    errors.push({ source: "pay", message: e instanceof Error ? e.message : "failed" });
  }

  const visible = items.filter((i) => !suppressed.has(i.sourceKey));
  const ranked = rankAndCap(visible);

  return NextResponse.json({
    items: ranked,
    decide,
    // "Clear" means genuinely nothing to do. A source that FAILED must never read as clear,
    // which is the mistake the old briefing made in a different form.
    clear: ranked.length === 0 && !decide && errors.length === 0,
    snoozedCount,
    errors,
    generatedAt: now.toISOString(),
  } satisfies TodayResponse);
}
