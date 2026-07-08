/**
 * Read/seed/validate for notification_rules. Seeding is idempotent (ON CONFLICT DO
 * NOTHING) and runs on read, so a newly-added rule type in rules.ts backfills itself.
 */
import { db } from "@/lib/db";
import { notificationRules } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { NOTIF_RULES, getRuleDef } from "@/lib/notifications/rules";

type RuleRow = typeof notificationRules.$inferSelect;

const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Tokens used in `text` that aren't in this rule's variable catalog. */
export function unknownRuleTokens(key: string, text: string): string[] {
  const def = getRuleDef(key);
  const valid = new Set((def?.variables ?? []).map((v) => v.token));
  const bad = new Set<string>();
  for (const m of text.matchAll(TOKEN_RE)) if (!valid.has(m[1])) bad.add(m[1]);
  return [...bad];
}

export async function seedNotificationRules(): Promise<void> {
  const now = new Date();
  for (const r of NOTIF_RULES) {
    await db()
      .insert(notificationRules)
      .values({
        key: r.key,
        name: r.name,
        description: r.description,
        recipients: r.defaultRecipients,
        messageTemplate: r.defaultTemplate,
        enabled: r.defaultEnabled,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: notificationRules.key });
  }
}

export async function getAllRules(): Promise<RuleRow[]> {
  await seedNotificationRules();
  const rows = await db().select().from(notificationRules);
  const order = NOTIF_RULES.map((r) => r.key);
  return rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

export async function getRule(key: string): Promise<RuleRow | null> {
  const [row] = await db().select().from(notificationRules).where(eq(notificationRules.key, key)).limit(1);
  return row ?? null;
}
