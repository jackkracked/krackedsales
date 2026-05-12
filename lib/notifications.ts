import { db } from "@/lib/db";
import { notifications, users } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { pusherTrigger } from "@/lib/pusher/server";

export type NotificationType =
  | "new_lead"
  | "call_soon"
  | "deal_cold"
  | "followup_overdue"
  | "ab_winner";

/**
 * Create a notification for a user and push it via Pusher.
 * If entityId is provided, deduplicates: skips if an unread notification
 * with the same type + entityId already exists.
 */
export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  body?: string,
  href?: string,
  entityId?: string
): Promise<void> {
  try {
    // Dedup: skip if an unread notification with the same type + entityId exists
    if (entityId) {
      const existing = await db()
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            eq(notifications.type, type),
            eq(notifications.entityId, entityId),
            isNull(notifications.readAt)
          )
        )
        .limit(1);
      if (existing.length > 0) return;
    }

    const [row] = await db()
      .insert(notifications)
      .values({ userId, type, title, body, href, entityId })
      .returning();

    // Push real-time update to the user's notification channel
    await pusherTrigger(`notifications-${userId}`, "notification", {
      id: row.id,
      type,
      title,
      body,
      href,
      createdAt: row.createdAt,
    });
  } catch (err) {
    // Non-fatal — notifications are best-effort
    console.error("[notifications] createNotification failed:", err);
  }
}

/**
 * Create a notification for all admin users.
 * Used for A/B test winners and other system-wide events.
 */
export async function notifyAdmins(
  type: NotificationType,
  title: string,
  body?: string,
  href?: string,
  entityId?: string
): Promise<void> {
  const admins = await db()
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.isActive, true)));

  await Promise.allSettled(
    admins.map((a) => createNotification(a.id, type, title, body, href, entityId))
  );
}
