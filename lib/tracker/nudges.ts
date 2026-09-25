import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { can } from "@/lib/auth/permissions";
import { sendSlackDm } from "@/lib/slack/dm";
import { claimNotification } from "@/lib/notifications/claim";
import { getSetterMonth } from "@/lib/tracker/setter";
import { getCloserMonth } from "@/lib/tracker/closer";
import { nextMonthToClose } from "@/lib/tracker/actions";
import { currentNyMonth } from "@/lib/tracker/months";

/**
 * One Slack DM a day per person, listing only what THEY can settle on the pay tracker.
 *
 * WHY THIS EXISTS: "100% accurate" here means never guessing, which means some rows wait for a
 * person. A gap nobody hears about is a gap that sits until payday. This makes each gap land with
 * the one person who can close it, once a day, and never twice (claimNotification is keyed on the
 * person and the New York date).
 */
export async function sendTrackerNudges(now: Date = new Date()): Promise<{ sent: number; skipped: number }> {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
  const month = currentNyMonth(now);
  // Same fallback as every other reminder in the app (app/api/cron/rep-reminders).
  const base = (process.env.NEXT_PUBLIC_APP_URL || "https://kracked-sales.vercel.app").replace(/\/$/, "");
  const link = `<${base}/tracker?needs=1|Open your pay tracker>`;
  const people = await db().select({ id: users.id, name: users.name, role: users.role, slackUserId: users.slackUserId })
    .from(users).where(and(eq(users.isActive, true), isNotNull(users.slackUserId)));
  const due = await nextMonthToClose(now);

  let sent = 0, skipped = 0;
  for (const p of people) {
    try {
      if (p.role !== "admin" && !(await can(p.id, p.role, "view_tracker"))) { skipped++; continue; }
      const lines: string[] = [];
      if (p.role === "setter") {
        const m = await getSetterMonth(p.id, month, now);
        const other = m.needsElsewhere.reduce((t, n) => t + n.count, 0);
        if (m.needsYou.confirm) lines.push(`• ${m.needsYou.confirm} ${m.needsYou.confirm === 1 ? "booking looks" : "bookings look"} like yours. Confirm and they count toward your pay.`);
        if (m.needsYou.clash) lines.push(`• ${m.needsYou.clash} ${m.needsYou.clash === 1 ? "booking is" : "bookings are"} also claimed by someone else. An admin will settle it.`);
        if (other) lines.push(`• ${other} more from ${m.needsElsewhere.map((n) => n.month).join(", ")}.`);
      } else {
        const c = await getCloserMonth(p.id, month, now);
        const n = c?.awaitingOutcome.length ?? 0;
        if (n) lines.push(`• ${n} ${n === 1 ? "call you ran needs" : "calls you ran need"} an outcome: did they show? A setter's pay waits on it.`);
      }
      if (p.role === "admin" && due) lines.push(`• ${due} is over and not closed yet. Closing freezes everyone's pay for it.`);
      if (lines.length === 0) { skipped++; continue; }
      if (!(await claimNotification(p.id, "tracker-nudge", day))) { skipped++; continue; }
      const ok = await sendSlackDm({ slackUserId: p.slackUserId!, text: `Pay tracker, ${lines.length === 1 ? "one thing" : "a few things"} only you can do:\n${lines.join("\n")}\n${link}` });
      if (ok) sent++; else skipped++;
    } catch (err) {
      // One person's failure never stops everyone else's nudge.
      skipped++;
      console.error(`[tracker-nudges] ${p.name}`, err);
    }
  }
  return { sent, skipped };
}
