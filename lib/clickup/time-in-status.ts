/**
 * ClickUp time_in_status processor
 *
 * For each task ID, fetches GET /task/{id}/time_in_status and stores:
 *  - demo_sent_dates:       exact timestamp when task entered "scheduled/live"
 *  - demo_current_stage_times: minutes the task has been in its CURRENT stage
 *  - demo_stage_totals:    cumulative minutes per historical stage
 *
 * Called in the background via after() — never blocks the HTTP response.
 */

import { clickup } from "./client";
import { db } from "@/lib/db";
import {
  demoSentDates,
  demoCurrentStageTimes,
  demoStageTotals,
} from "@/lib/db/schema";

// ─── ClickUp API shape ───────────────────────────────────────────────────────

interface TimeInStatusEntry {
  status: string;
  total_time: {
    by_minute: number;
    since: string; // ms timestamp as string
  };
}

interface TimeInStatusResponse {
  current_status: TimeInStatusEntry;
  status_history: TimeInStatusEntry[];
}

// ─── Process one task ────────────────────────────────────────────────────────

async function processTask(taskId: string): Promise<void> {
  let data: TimeInStatusResponse;
  try {
    data = await clickup.get<TimeInStatusResponse>(
      `/task/${taskId}/time_in_status`
    );
  } catch (err) {
    console.warn(`[time-in-status] skip ${taskId}:`, err);
    return;
  }

  const database = db();
  const now = new Date();

  // ── 1. Current stage time ──────────────────────────────────────────────────
  const minutesInStage = data.current_status.total_time.by_minute ?? 0;
  const currentStageName = data.current_status.status.toLowerCase().trim();

  await database
    .insert(demoCurrentStageTimes)
    .values({
      clickupTaskId: taskId,
      stageName: currentStageName,
      minutesInStage,
      fetchedAt: now,
    })
    .onConflictDoUpdate({
      target: demoCurrentStageTimes.clickupTaskId,
      set: {
        stageName: currentStageName,
        minutesInStage,
        fetchedAt: now,
      },
    });

  // ── 2. sentAt: when the task entered "scheduled/live" ─────────────────────
  //    Could be in current_status OR in status_history.
  const allEntries: TimeInStatusEntry[] = [
    data.current_status,
    ...(data.status_history ?? []),
  ];

  const sentEntry = allEntries.find((e) => {
    const s = e.status.toLowerCase().trim();
    return s === "scheduled/live" || s === "scheduled" || s === "live";
  });

  if (sentEntry?.total_time.since) {
    const sentAt = new Date(Number(sentEntry.total_time.since));
    if (!isNaN(sentAt.getTime())) {
      await database
        .insert(demoSentDates)
        .values({ clickupTaskId: taskId, sentAt, fetchedAt: now })
        .onConflictDoUpdate({
          target: demoSentDates.clickupTaskId,
          set: { sentAt, fetchedAt: now },
        });
    }
  }

  // ── 3. Historical stage totals ─────────────────────────────────────────────
  const history = data.status_history ?? [];
  if (history.length === 0) return;

  const rows = history
    .filter((e) => (e.total_time.by_minute ?? 0) > 0)
    .map((e) => ({
      taskStageKey: `${taskId}::${e.status.toLowerCase().trim()}`,
      clickupTaskId: taskId,
      stageName: e.status.toLowerCase().trim(),
      minutesTotal: e.total_time.by_minute,
      fetchedAt: now,
    }));

  if (rows.length === 0) return;

  // Upsert each row — update minutesTotal on re-fetch
  for (const row of rows) {
    await database
      .insert(demoStageTotals)
      .values(row)
      .onConflictDoUpdate({
        target: demoStageTotals.taskStageKey,
        set: {
          minutesTotal: row.minutesTotal,
          fetchedAt: row.fetchedAt,
        },
      });
  }
}

// ─── Public: process a batch of task IDs ────────────────────────────────────

export async function processTimeInStatusBatch(taskIds: string[]): Promise<void> {
  // Sequential to avoid hammering the ClickUp rate limit
  for (const id of taskIds) {
    await processTask(id);
  }
}
