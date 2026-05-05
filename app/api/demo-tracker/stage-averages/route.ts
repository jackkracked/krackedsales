/**
 * GET /api/demo-tracker/stage-averages?range=month
 *
 * Computes average time per stage, scoped to tasks that were SENT (entered
 * "Scheduled/Live") within the selected time range. If range=all, uses all tasks.
 *
 * Returns: { stages: { stageName, avgDays, taskCount }[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { demoStageTotals, demoSentDates } from "@/lib/db/schema";
import { getTimeRangeStart, type TimeRange } from "@/lib/utils/time-range";

export const dynamic = "force-dynamic";

const PIPELINE_STAGES = new Set([
  "copy",
  "design",
  "copy revision needed",
  "design revision needed",
  "internal qa",
  "internal qa review",
]);

export interface StageAverage {
  stageName: string;
  avgDays: number;
  taskCount: number;
}

export async function GET(req: NextRequest) {
  try {
    const range = (req.nextUrl.searchParams.get("range") ?? "all") as TimeRange;
    const rangeStart = getTimeRangeStart(range);

    // ── 1. Resolve which task IDs fall within the selected range ──────────────
    let taskIds: string[] | null = null; // null = no filter (all time)

    if (rangeStart) {
      const sentRows = await db()
        .select({ clickupTaskId: demoSentDates.clickupTaskId })
        .from(demoSentDates)
        .where(gte(demoSentDates.sentAt, rangeStart));

      taskIds = sentRows.map((r) => r.clickupTaskId);

      // No tasks sent in this range yet — return empty
      if (taskIds.length === 0) {
        return NextResponse.json({ stages: [] });
      }
    }

    // ── 2. Fetch stage totals for the resolved task set ───────────────────────
    const rows = taskIds
      ? await db()
          .select()
          .from(demoStageTotals)
          .where(inArray(demoStageTotals.clickupTaskId, taskIds))
      : await db().select().from(demoStageTotals);

    // ── 3. Aggregate by stage ─────────────────────────────────────────────────
    const byStage = new Map<string, number[]>();
    for (const row of rows) {
      const stage = row.stageName.toLowerCase().trim();
      if (!PIPELINE_STAGES.has(stage)) continue;
      if (!byStage.has(stage)) byStage.set(stage, []);
      byStage.get(stage)!.push(row.minutesTotal);
    }

    const result: StageAverage[] = [];
    for (const [stageName, minutes] of byStage.entries()) {
      const avgMinutes = minutes.reduce((s, m) => s + m, 0) / minutes.length;
      result.push({
        stageName,
        avgDays: avgMinutes / 1440,
        taskCount: minutes.length,
      });
    }

    return NextResponse.json({ stages: result });
  } catch (err) {
    console.error("[GET /api/demo-tracker/stage-averages]", err);
    return NextResponse.json(
      { error: "Failed to compute stage averages" },
      { status: 500 }
    );
  }
}
