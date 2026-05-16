import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tasks, notifications } from "@/lib/db/schema";
import { eq, and, isNotNull, gte, lt, isNull } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron: task reminders
 * Runs twice daily via Vercel Cron:
 *   - 5pm UTC (0 17 * * *) — notify about tasks due tomorrow
 *   - 9am UTC (0 9 * * *)  — notify about tasks due today
 *
 * Checks the hour to determine which notification to fire.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const hour = now.getUTCHours();

  // 9am UTC → due today notifications
  // 17 (5pm) UTC → due tomorrow notifications
  const isDueToday = hour >= 8 && hour < 12;
  const isDueTomorrow = hour >= 16 && hour < 20;

  if (!isDueToday && !isDueTomorrow) {
    return NextResponse.json({ skipped: true, reason: "Not a notification window" });
  }

  // Build the date range to check
  const targetStart = new Date(now);
  const targetEnd = new Date(now);

  if (isDueTomorrow) {
    // Tasks due tomorrow
    targetStart.setUTCDate(targetStart.getUTCDate() + 1);
    targetStart.setUTCHours(0, 0, 0, 0);
    targetEnd.setUTCDate(targetEnd.getUTCDate() + 1);
    targetEnd.setUTCHours(23, 59, 59, 999);
  } else {
    // Tasks due today
    targetStart.setUTCHours(0, 0, 0, 0);
    targetEnd.setUTCHours(23, 59, 59, 999);
  }

  const type = isDueTomorrow ? "task_due_soon" : "task_due_today";
  const entityPrefix = isDueTomorrow ? "tomorrow" : "today";

  try {
    // Find all incomplete tasks due in the target window that have a userId
    const dueTasks = await db()
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.completed, false),
          isNotNull(tasks.userId),
          gte(tasks.dueDate, targetStart),
          lt(tasks.dueDate, targetEnd)
        )
      );

    if (dueTasks.length === 0) {
      return NextResponse.json({ sent: 0, type });
    }

    // Insert one notification per task (skip if already notified today for this task)
    const toInsert = dueTasks.map((t) => ({
      userId: t.userId!,
      type,
      title: isDueTomorrow
        ? `Task due tomorrow: ${t.title}`
        : `Task due today: ${t.title}`,
      body: t.contactName ? `Related to ${t.contactName}` : null,
      href: "/dashboard",
      entityId: `${entityPrefix}::${t.id}`,
    }));

    // Use INSERT ... ON CONFLICT DO NOTHING to avoid duplicates
    // entityId acts as dedup key per user (same type + entityId = same notification)
    for (const n of toInsert) {
      try {
        // Check if already sent
        const existing = await db()
          .select({ id: notifications.id })
          .from(notifications)
          .where(
            and(
              eq(notifications.userId, n.userId),
              eq(notifications.type, n.type),
              eq(notifications.entityId, n.entityId)
            )
          )
          .limit(1);

        if (existing.length === 0) {
          await db().insert(notifications).values(n);
        }
      } catch {
        // Skip individual failures — don't block the whole batch
      }
    }

    return NextResponse.json({ sent: toInsert.length, type });
  } catch (err) {
    console.error("[GET /api/cron/task-reminders]", err);
    return NextResponse.json({ error: "Failed to send task reminders" }, { status: 500 });
  }
}
