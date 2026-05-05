import { after, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { clickup, demoListId } from "@/lib/clickup/client";
import { mapStageToBucket } from "@/lib/utils/demo-stage";
import { fromClickUpTimestamp } from "@/lib/utils/date";
import { db } from "@/lib/db";
import { demoSentDates, demoCurrentStageTimes } from "@/lib/db/schema";
import { processTimeInStatusBatch } from "@/lib/clickup/time-in-status";
import type { ClickUpTask, ClickUpTasksResponse } from "@/lib/clickup/types";

export const dynamic = "force-dynamic";

export interface BackfillStatus {
  total: number;   // total parent tasks in the ClickUp list
  synced: number;  // tasks already cached in demo_current_stage_times
}

export interface EnrichedTask {
  id: string;
  name: string;
  status: string;
  bucket: ReturnType<typeof mapStageToBucket>;
  dateCreated: string;
  dateUpdated: string;
  dateSent: string | null; // from demo_sent_dates — accurate when backfilled
  assignee: string | null;
  daysInStage: number; // from demo_current_stage_times when available, else task age
  url: string;
  miroUrl: string | null;
  brandHubUrl: string | null;
}

// ─── Enrich a single ClickUp task with DB overrides ──────────────────────────

function enrichTask(
  task: ClickUpTask,
  sentAt: Date | null,
  minutesInStage: number | null
): EnrichedTask {
  const created = fromClickUpTimestamp(task.date_created);

  // Use DB-accurate stage time if available; fall back to task age
  const daysInStage =
    minutesInStage !== null
      ? Math.floor(minutesInStage / 1440)
      : Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));

  const miroField = task.custom_fields?.find(
    (f) => f.name.toLowerCase() === "psd/figma"
  );
  const miroUrl =
    typeof miroField?.value === "string" && miroField.value.trim()
      ? miroField.value.trim()
      : null;

  const brandHubField = task.custom_fields?.find(
    (f) => f.name.toLowerCase() === "brand hub"
  );
  let brandHubUrl: string | null = null;
  if (brandHubField?.value != null) {
    const v = brandHubField.value;
    if (typeof v === "string" && v.trim()) {
      brandHubUrl = v.trim();
    } else if (typeof v === "object" && v !== null) {
      const obj = v as Record<string, unknown>;
      const inner = obj.url ?? obj.value ?? obj.href;
      if (typeof inner === "string" && inner.trim()) brandHubUrl = inner.trim();
    }
  }
  // Do NOT fall back to the brand name — it's not a URL and breaks opportunity lookups.

  return {
    id: task.id,
    name: task.name,
    status: task.status.status,
    bucket: mapStageToBucket(task.status.status),
    dateCreated: created.toISOString(),
    dateUpdated: fromClickUpTimestamp(task.date_updated).toISOString(),
    // If the DB backfill hasn't run yet, fall back to date_updated for DEMO_SENT tasks.
    // date_updated is set when the status changes, so it's accurate enough to count the
    // task immediately. The backfill will replace this with the precise value next sync.
    dateSent: sentAt?.toISOString() ?? (
      mapStageToBucket(task.status.status) === "DEMO_SENT"
        ? fromClickUpTimestamp(task.date_updated).toISOString()
        : null
    ),
    assignee: task.assignees[0]?.username ?? null,
    daysInStage,
    url: task.url,
    miroUrl,
    brandHubUrl,
  };
}

// ─── Fetch a single page of ClickUp tasks ────────────────────────────────────

async function fetchPage(listId: string, page: number): Promise<ClickUpTask[]> {
  const data = await clickup.get<ClickUpTasksResponse>(
    `/list/${listId}/task?include_closed=true&subtasks=false&order_by=created&reverse=true&page=${page}`
  );
  return data.tasks ?? [];
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const listId = demoListId();

    // ── 1. Fetch all ClickUp tasks ─────────────────────────────────────────
    const page0 = await fetchPage(listId, 0);
    let allTasks: ClickUpTask[] = [...page0];

    if (page0.length >= 100) {
      const PAGE_COUNT = 20;
      const remainingPages = await Promise.all(
        Array.from({ length: PAGE_COUNT - 1 }, (_, i) =>
          fetchPage(listId, i + 1).catch(() => [] as ClickUpTask[])
        )
      );
      for (const page of remainingPages) {
        if (!page.length) break;
        allTasks.push(...page);
      }
    }

    // Filter to parent tasks only, deduplicate
    const parentTasks = allTasks
      .filter((t) => !t.parent)
      .filter((t, i, arr) => arr.findIndex((x) => x.id === t.id) === i);

    const taskIds = parentTasks.map((t) => t.id);

    // ── 2. Load DB overrides in parallel ──────────────────────────────────
    const database = db();
    const [sentRows, stageRows] = await Promise.all([
      database
        .select()
        .from(demoSentDates)
        .where(inArray(demoSentDates.clickupTaskId, taskIds)),
      database
        .select()
        .from(demoCurrentStageTimes)
        .where(inArray(demoCurrentStageTimes.clickupTaskId, taskIds)),
    ]);

    const sentMap = new Map(sentRows.map((r) => [r.clickupTaskId, r.sentAt]));
    const stageMap = new Map(
      stageRows.map((r) => [r.clickupTaskId, r.minutesInStage])
    );

    // ── 3. Enrich tasks ────────────────────────────────────────────────────
    const enriched = parentTasks.map((t) =>
      enrichTask(
        t,
        sentMap.get(t.id) ?? null,
        stageMap.has(t.id) ? stageMap.get(t.id)! : null
      )
    );

    // ── 4. Background backfill: process uncached tasks via after() ─────────
    const cachedIds = new Set([
      ...sentRows.map((r) => r.clickupTaskId),
      ...stageRows.map((r) => r.clickupTaskId),
    ]);
    const uncached = taskIds.filter((id) => !cachedIds.has(id)).slice(0, 100);

    if (uncached.length > 0) {
      after(async () => {
        console.log(`[time-in-status] backfilling ${uncached.length} tasks`);
        await processTimeInStatusBatch(uncached);
        console.log(`[time-in-status] done with batch of ${uncached.length}`);
      });
    }

    const backfill: BackfillStatus = {
      total: taskIds.length,
      synced: stageRows.length, // every processed task gets a row in demo_current_stage_times
    };

    return NextResponse.json({ tasks: enriched, backfill });
  } catch (err) {
    console.error("[GET /api/clickup/tasks]", err);
    return NextResponse.json(
      { error: "Failed to fetch ClickUp tasks" },
      { status: 500 }
    );
  }
}
