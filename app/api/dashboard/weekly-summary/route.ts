import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { weeklySummaries } from "@/lib/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { getSessionUserId } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/weekly-summary
 *
 * Returns the most recent weekly summary for the logged-in user.
 */
export async function GET() {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      console.warn("[weekly-summary] No session userId");
      return NextResponse.json({ summary: null });
    }

    const rows = await db()
      .select({
        content: weeklySummaries.content,
        weekStart: weeklySummaries.weekStart,
        generatedAt: weeklySummaries.generatedAt,
      })
      .from(weeklySummaries)
      .where(eq(weeklySummaries.userId, userId))
      .orderBy(desc(weeklySummaries.weekStart))
      .limit(1);

    const row = rows[0] ?? null;

    return NextResponse.json({
      summary: row
        ? {
            content: row.content,
            weekStart: row.weekStart.toISOString(),
            generatedAt: row.generatedAt.toISOString(),
          }
        : null,
    });
  } catch (err) {
    console.error("[weekly-summary] Error:", err);
    return NextResponse.json({ summary: null });
  }
}
