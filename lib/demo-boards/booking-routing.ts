import { db } from "@/lib/db";
import { demoBoards, users, userCalendars } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export type ResolvedCalendar = {
  ghlCalendarId: string;
  repName: string;
  repEmail: string;
  color: string;
};

/**
 * Intelligent routing: a booked call should land on the OWNING rep's calendar.
 * Resolve the board's rep (board.repId → users.email) to their configured
 * `userCalendars` row. Falls back to the first active calendar so a board with no
 * assigned rep can still be booked rather than dead-ending.
 */
export async function resolveBoardCalendar(boardId: string): Promise<ResolvedCalendar | null> {
  const [board] = await db()
    .select({ repId: demoBoards.repId })
    .from(demoBoards)
    .where(eq(demoBoards.id, boardId))
    .limit(1);

  // 1) The owning rep's calendar.
  if (board?.repId) {
    const [rep] = await db()
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, board.repId))
      .limit(1);
    if (rep?.email) {
      const [cal] = await db()
        .select()
        .from(userCalendars)
        .where(and(eq(userCalendars.repEmail, rep.email), eq(userCalendars.isActive, true)))
        .limit(1);
      if (cal?.ghlCalendarId) {
        return { ghlCalendarId: cal.ghlCalendarId, repName: cal.repName || rep.name, repEmail: cal.repEmail, color: cal.color };
      }
    }
  }

  // 2) Fallback — the first active calendar, so booking always works.
  const [fallback] = await db()
    .select()
    .from(userCalendars)
    .where(eq(userCalendars.isActive, true))
    .limit(1);
  if (fallback?.ghlCalendarId) {
    return { ghlCalendarId: fallback.ghlCalendarId, repName: fallback.repName, repEmail: fallback.repEmail, color: fallback.color };
  }

  return null;
}
