import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { trackerMonthCloses, trackerSettledRows } from "@/lib/db/schema";
import type { SettledLine } from "@/lib/tracker/settlement";

/** Months that have been closed, with who closed them. */
export async function loadCloses(): Promise<Map<string, { closedBy: string; closedAt: Date }>> {
  const rows = await db().select().from(trackerMonthCloses);
  return new Map(rows.map((r) => [r.month, { closedBy: r.closedBy, closedAt: r.closedAt }]));
}

/** Every amount already settled for one person. Bonus and commission share one key space. */
export async function loadSettled(userId: string): Promise<SettledLine[]> {
  const rows = await db().select().from(trackerSettledRows).where(eq(trackerSettledRows.userId, userId));
  return rows.map((r) => ({ key: r.rowKey, rowKey: r.rowRef, settledInMonth: r.settledInMonth, cents: r.bonusCents + r.commissionCents }));
}
