import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audits } from "@/lib/db/schema";
import { clickup } from "@/lib/clickup/client";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ClickUpTask {
  id: string;
  status?: { status?: string; type?: string };
}

/**
 * A ClickUp task counts as a delivered audit when it is closed/done, or when its
 * custom status name reads as finished. We store the raw status name so this can
 * be hardened to the exact "Delivered" status once confirmed.
 */
function isDelivered(task: ClickUpTask): boolean {
  const type = task.status?.type?.toLowerCase() ?? "";
  if (type === "closed" || type === "done") return true;
  const name = task.status?.status?.toLowerCase() ?? "";
  return /deliver|complete|sent|done/.test(name);
}

/**
 * Daily cron — polls ClickUp for every audit still marked "requested" and flips
 * it to "delivered" once the ClickUp task is finished. Powers the contacts
 * "Audit delivered" filter + KPIs.
 *
 * Authorization: Bearer <CRON_SECRET>
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const database = db();
  const pending = await database
    .select({ clickupTaskId: audits.clickupTaskId })
    .from(audits)
    .where(eq(audits.status, "requested"));

  let delivered = 0;
  let checked = 0;
  let missing = 0;

  for (const row of pending) {
    let task: ClickUpTask;
    try {
      task = await clickup.get<ClickUpTask>(`/task/${row.clickupTaskId}`);
    } catch (err) {
      // 404 = task deleted in ClickUp; skip but keep the row for visibility.
      missing++;
      console.error(`[sync-audits] could not fetch task ${row.clickupTaskId}:`, err);
      continue;
    }
    checked++;

    const statusName = task.status?.status ?? null;
    if (isDelivered(task)) {
      await database
        .update(audits)
        .set({ status: "delivered", clickupStatus: statusName, deliveredAt: new Date(), checkedAt: new Date() })
        .where(eq(audits.clickupTaskId, row.clickupTaskId));
      delivered++;
    } else {
      await database
        .update(audits)
        .set({ clickupStatus: statusName, checkedAt: new Date() })
        .where(eq(audits.clickupTaskId, row.clickupTaskId));
    }
  }

  console.log(`[sync-audits] pending=${pending.length} checked=${checked} delivered=${delivered} missing=${missing}`);
  return NextResponse.json({ pending: pending.length, checked, delivered, missing });
}
