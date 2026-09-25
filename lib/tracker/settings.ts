import { asc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { trackerMonthSettings, users } from "@/lib/db/schema";
import { addMonths, currentNyMonth } from "@/lib/tracker/months";

/**
 * The three numbers at the top of each month: base pay, booking bonus, commission rate.
 *
 * HOW A MONTH GETS ITS VALUES (plan S6)
 * Rows mean "from this month on". Month M uses the latest row with month <= M. Migration 0063
 * seeded a 2000-01 baseline for everyone, so every month always resolves to a real row and no
 * later change to `users` defaults can rewrite a past month.
 *
 * WHY AN EDIT ALSO PINS THE NEXT MONTH
 * Kelsey's workbook has one tab per month, and changing September's rate changes September only
 * (Jack, 2026-09-25). With "from this month on" rows, editing August would silently carry into
 * September. So an edit to M first freezes M+1 at its current values, if M+1 has started and has
 * no row of its own. A new month still starts with the previous month's values, as the sheet does.
 */

export type SettingsField = "basePayCents" | "bookingBonusCents" | "commissionPct";

export interface MonthSettings {
  month: string;
  /** null = never set. The screen says "Not set", never "$0". */
  basePayCents: number | null;
  bookingBonusCents: number;
  commissionPct: number;
  /** Which of the three were typed by a person for this month, and by whom. */
  editedFields: string[];
  editedBy: string | null;
  editedAt: Date | null;
}

export interface SettingsRow extends MonthSettings { userId: string }

/** Pure: the values in force for `month`. Rows must belong to one user. */
export function resolveSettings(rows: SettingsRow[], month: string): MonthSettings {
  let best: SettingsRow | undefined;
  for (const r of rows) if (r.month <= month && (!best || r.month > best.month)) best = r;
  if (!best) return { month, basePayCents: null, bookingBonusCents: 0, commissionPct: 0, editedFields: [], editedBy: null, editedAt: null };
  // Edit markers belong to the month they were made in, not every month that inherits them.
  const own = best.month === month;
  return {
    month,
    basePayCents: best.basePayCents,
    bookingBonusCents: best.bookingBonusCents,
    commissionPct: best.commissionPct,
    editedFields: own ? best.editedFields : [],
    editedBy: own ? best.editedBy : null,
    editedAt: own ? best.editedAt : null,
  };
}

export async function loadSettingsRows(userIds: string[]): Promise<SettingsRow[]> {
  if (userIds.length === 0) return [];
  const rows = await db()
    .select()
    .from(trackerMonthSettings)
    .where(inArray(trackerMonthSettings.userId, userIds))
    .orderBy(asc(trackerMonthSettings.month));
  const out: SettingsRow[] = rows.map((r) => ({
    userId: r.userId, month: r.month, basePayCents: r.basePayCents, bookingBonusCents: r.bookingBonusCents,
    commissionPct: r.commissionPct, editedFields: r.editedFields, editedBy: r.editedBy, editedAt: r.editedAt,
  }));
  // Someone created after migration 0063 has no baseline row. Give them one from their team
  // settings, exactly as the migration did for everyone else, so they never read as $0/0%.
  const missing = userIds.filter((id) => !out.some((r) => r.userId === id));
  if (missing.length) {
    const people = await db().select({ id: users.id, role: users.role, base: users.basePayCents, pct: users.commissionPct })
      .from(users).where(inArray(users.id, missing));
    for (const p of people) {
      out.unshift({
        userId: p.id, month: "2000-01", basePayCents: p.base || null,
        bookingBonusCents: p.role === "setter" ? 2500 : 0, commissionPct: p.pct,
        editedFields: [], editedBy: null, editedAt: null,
      });
    }
  }
  return out;
}

/**
 * Change one value for one month. Atomic: the pin on M+1 and the edit to M are one batch.
 * Callers enforce WHO may do this; this function only guarantees the arithmetic.
 */
export async function editMonthSetting(opts: {
  userId: string;
  month: string;
  field: SettingsField;
  value: number | null;
  actorId: string;
  now?: Date;
}): Promise<MonthSettings> {
  const { userId, month, field, value, actorId } = opts;
  const now = opts.now ?? new Date();
  const rows = await loadSettingsRows([userId]);
  const current = resolveSettings(rows, month);
  const next = addMonths(month, 1);
  const nextValues = resolveSettings(rows, next);
  const nextHasOwnRow = rows.some((r) => r.month === next);
  const nextHasStarted = next <= currentNyMonth(now);

  const updated: MonthSettings = {
    ...current,
    [field]: value,
    editedFields: [...new Set([...(rows.find((r) => r.month === month)?.editedFields ?? []), field])],
    editedBy: actorId,
    editedAt: now,
  };

  const database = db();
  const statements = [];
  if (!nextHasOwnRow && nextHasStarted) {
    statements.push(
      database.insert(trackerMonthSettings).values({
        userId, month: next,
        basePayCents: nextValues.basePayCents,
        bookingBonusCents: nextValues.bookingBonusCents,
        commissionPct: nextValues.commissionPct,
      }).onConflictDoNothing(),
    );
  }
  statements.push(
    database.insert(trackerMonthSettings).values({
      userId, month,
      basePayCents: updated.basePayCents,
      bookingBonusCents: updated.bookingBonusCents,
      commissionPct: updated.commissionPct,
      editedFields: updated.editedFields,
      editedBy: actorId,
      editedAt: now,
    }).onConflictDoUpdate({
      target: [trackerMonthSettings.userId, trackerMonthSettings.month],
      set: {
        [field]: value,
        editedFields: updated.editedFields,
        editedBy: actorId,
        editedAt: now,
      },
    }),
  );
  await database.batch(statements as [typeof statements[0], ...typeof statements]);
  return updated;
}

/** For team settings: record a new default as "from the current month on". */
export async function recordDefaultChange(opts: {
  userId: string;
  basePayCents?: number | null;
  commissionPct?: number;
  actorId: string;
}): Promise<void> {
  const month = currentNyMonth();
  if (opts.basePayCents !== undefined) {
    await editMonthSetting({ userId: opts.userId, month, field: "basePayCents", value: opts.basePayCents, actorId: opts.actorId });
  }
  if (opts.commissionPct !== undefined) {
    await editMonthSetting({ userId: opts.userId, month, field: "commissionPct", value: opts.commissionPct, actorId: opts.actorId });
  }
}

export async function getMonthSettings(userId: string, month: string): Promise<MonthSettings> {
  return resolveSettings(await loadSettingsRows([userId]), month);
}
