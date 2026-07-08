import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, tasks, callDispositions } from "@/lib/db/schema";
import { and, eq, isNotNull, lt, inArray } from "drizzle-orm";
import { ghl, locationId } from "@/lib/ghl/client";
import type { GHLCalendarEvent } from "@/lib/ghl/types";
import { getRule } from "@/lib/notifications/store";
import { dispatchNotification } from "@/lib/notifications/dispatch";
import { claimNotification } from "@/lib/notifications/claim";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://kracked-sales.vercel.app";
const TZ = "America/Los_Angeles";

function whenPhrase(d: Date, now: Date): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const time = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(d);
  const dayOf = day.format(d), today = day.format(now);
  const y = new Date(now.getTime() - 86_400_000);
  if (dayOf === today) return `today at ${time}`;
  if (dayOf === day.format(y)) return `yesterday at ${time}`;
  return `${new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" }).format(d)} at ${time}`;
}
function ymd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * Rep Slack reminders: call-outcome-not-set, call-coming-up, and task-due. Each is
 * gated by its notification rule (Settings > Notifications) and deduped so it pings once.
 * Runs a couple of times a day. Vercel Cron auth via Bearer CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const summary = { outcome: 0, upcoming: 0, task: 0 };

  try {
    const outcomeRule = await getRule("call_outcome_missing");
    const upcomingRule = await getRule("call_upcoming");
    const taskRule = await getRule("task_due");

    // ── Calls (outcome-missing + upcoming), from GHL calendar events per rep ─────
    if (outcomeRule?.enabled || upcomingRule?.enabled) {
      const reps = await db()
        .select({ name: users.name, email: users.email, ghlUserId: users.ghlUserId })
        .from(users)
        .where(isNotNull(users.ghlUserId));

      const startMs = now.getTime() - 3 * 86_400_000;
      const endMs = now.getTime() + 2 * 86_400_000;

      const arrays = await Promise.all(
        reps.map(async (u) => {
          try {
            const data = await ghl.get<{ events?: GHLCalendarEvent[] }>(
              `/calendars/events?locationId=${locationId()}&userId=${u.ghlUserId}&startTime=${startMs}&endTime=${endMs}`,
            );
            return (data.events ?? []).map((e) => ({ ...e, repName: u.name, repEmail: u.email }));
          } catch { return []; }
        }),
      );

      // Dedupe the same call across reps (both attendees) by start+title.
      const deduped = new Map<string, GHLCalendarEvent & { repName: string; repEmail: string }>();
      for (const e of arrays.flat()) {
        const key = `${e.startTime}::${(e.title ?? "").toLowerCase().trim()}`;
        if (!deduped.has(key)) deduped.set(key, e);
      }
      const events = [...deduped.values()].filter((e) => e.id);

      const eventIds = events.map((e) => e.id);
      const dispositioned = eventIds.length
        ? new Set((await db().select({ id: callDispositions.calendarEventId }).from(callDispositions).where(inArray(callDispositions.calendarEventId, eventIds))).map((d) => d.id))
        : new Set<string>();

      const endOfToday = new Date(`${ymd(now)}T23:59:59`);

      for (const e of events) {
        const start = new Date(e.startTime);
        const status = (e.status ?? "").toLowerCase();
        if (status === "cancelled" || status === "noshow" || status === "invalid") continue;
        const rep = { name: e.repName, email: e.repEmail };
        const contact = e.contactName || e.title || "your contact";

        // Outcome not set: the call is >2h in the past and has no disposition.
        if (outcomeRule?.enabled && start.getTime() < now.getTime() - 2 * 3_600_000 && !dispositioned.has(e.id)) {
          if (await claimNotification(e.id, "call_outcome_missing", "once")) {
            await dispatchNotification("call_outcome_missing", { rep, values: {
              "contact.name": contact, "rep.name": e.repName, "call.when": whenPhrase(start, now), "call.link": `${APP_URL}/calls`,
            } });
            summary.outcome++;
          }
        }

        // Coming up: a future call happening today.
        if (upcomingRule?.enabled && start.getTime() > now.getTime() && start.getTime() <= endOfToday.getTime()) {
          if (await claimNotification(e.id, "call_upcoming", "once")) {
            await dispatchNotification("call_upcoming", { rep, values: {
              "contact.name": contact, "rep.name": e.repName, "call.when": whenPhrase(start, now), "call.link": `${APP_URL}/calls`,
            } });
            summary.upcoming++;
          }
        }
      }
    }

    // ── Tasks due today or overdue ───────────────────────────────────────────────
    if (taskRule?.enabled) {
      const endOfToday = new Date(`${ymd(now)}T23:59:59.999Z`);
      const startOfToday = new Date(`${ymd(now)}T00:00:00.000Z`);
      const due = await db().select().from(tasks).where(and(
        eq(tasks.completed, false), isNotNull(tasks.userId), isNotNull(tasks.dueDate), lt(tasks.dueDate, endOfToday),
      ));
      const userRows = await db().select({ id: users.id, name: users.name, email: users.email }).from(users);
      const userById = new Map(userRows.map((u) => [u.id, u] as const));
      const bucket = ymd(now); // at most once per day per task

      for (const t of due) {
        if (!t.userId || !t.dueDate) continue;
        const u = userById.get(t.userId);
        const overdue = t.dueDate.getTime() < startOfToday.getTime();
        if (await claimNotification(t.id, "task_due", bucket)) {
          await dispatchNotification("task_due", {
            rep: { name: t.userName ?? u?.name ?? null, email: u?.email ?? null },
            values: {
              "task.title": t.title, "rep.name": t.userName ?? u?.name ?? "",
              "task.due": overdue ? "overdue" : "today", "task.state": overdue ? "is overdue" : "due today",
              "task.link": `${APP_URL}/tasks`,
            },
          });
          summary.task++;
        }
      }
    }

    console.log("[cron/rep-reminders]", JSON.stringify(summary));
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[cron/rep-reminders] failed:", err);
    return NextResponse.json({ error: "rep-reminders failed" }, { status: 500 });
  }
}
