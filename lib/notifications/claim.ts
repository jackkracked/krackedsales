/**
 * Claim a one-time notification slot so a daily cron never double-pings. Reuses the
 * reminder ledger's unique index (entity_id, template_key, step_key). Returns true the
 * first time a given (entity, rule, bucket) is seen, false on every later run.
 *   - bucket "once"  → nudge exactly once per entity ever (e.g. a specific call).
 *   - bucket a date  → nudge at most once per day (e.g. an overdue task, daily).
 */
import { db } from "@/lib/db";
import { sentReminders } from "@/lib/db/schema";

export async function claimNotification(entityId: string, ruleKey: string, bucket: string): Promise<boolean> {
  const claimed = await db()
    .insert(sentReminders)
    .values({ entityId, templateKey: `notif:${ruleKey}`, stepKey: bucket, stepNumber: 0, status: "sent", sentAt: new Date() })
    .onConflictDoNothing({ target: [sentReminders.entityId, sentReminders.templateKey, sentReminders.stepKey] })
    .returning({ id: sentReminders.id });
  return claimed.length > 0;
}
