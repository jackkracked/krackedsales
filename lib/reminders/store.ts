/**
 * Read/seed/save for the editable client-email templates.
 *
 * Seeding is idempotent: the four defaults are inserted once (ON CONFLICT DO NOTHING),
 * each with `activeFrom = now` so the reminder engine's floor prevents a first run from
 * retro-blasting historical proposals/invoices (see the engine + tasks/todo.md).
 */
import { db } from "@/lib/db";
import { emailTemplates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { DEFAULT_TEMPLATES } from "@/lib/reminders/defaults";
import { VAR_CATALOG } from "@/lib/reminders/variables";

type TemplateRow = typeof emailTemplates.$inferSelect;

const VALID_TOKENS = new Set(VAR_CATALOG.map((v) => v.token));
const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Every {{token}} used across the given strings that is NOT in the variable catalog. */
export function unknownTokens(...strings: string[]): string[] {
  const found = new Set<string>();
  for (const s of strings) {
    for (const m of s.matchAll(TOKEN_RE)) {
      if (!VALID_TOKENS.has(m[1])) found.add(m[1]);
    }
  }
  return [...found];
}

/** Insert the four default templates if they don't exist yet. Safe to call repeatedly. */
export async function seedDefaultTemplates(): Promise<void> {
  const now = new Date();
  for (const t of DEFAULT_TEMPLATES) {
    await db()
      .insert(emailTemplates)
      .values({
        key: t.key,
        name: t.name,
        kind: t.kind,
        subject: t.subject,
        bodyTemplate: t.bodyTemplate,
        ctaLabel: t.ctaLabel,
        schedule: t.schedule,
        notifyRep: t.notifyRep,
        enabled: t.enabled,
        activeFrom: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: emailTemplates.key });
  }
}

/** All templates (seeding any missing defaults first), ordered reminders then transactional. */
export async function getAllTemplates(): Promise<TemplateRow[]> {
  // Idempotent (ON CONFLICT DO NOTHING): backfills any template key that doesn't exist yet.
  await seedDefaultTemplates();
  const rows = await db().select().from(emailTemplates);
  const order = DEFAULT_TEMPLATES.map((t) => t.key);
  return rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

export async function getTemplate(key: string): Promise<TemplateRow | null> {
  const [row] = await db().select().from(emailTemplates).where(eq(emailTemplates.key, key)).limit(1);
  return row ?? null;
}
