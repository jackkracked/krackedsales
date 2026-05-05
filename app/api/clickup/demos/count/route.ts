import { NextRequest, NextResponse } from "next/server";
import { clickup, demoListId } from "@/lib/clickup/client";

export const dynamic = "force-dynamic";

interface ClickUpTask {
  id: string;
  name: string;
  date_updated: string;
  parent?: string;
}

interface ClickUpTasksResponse {
  tasks: ClickUpTask[];
}

export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since"); // YYYY-MM-DD
  const until = req.nextUrl.searchParams.get("until"); // YYYY-MM-DD

  try {
    const listId = demoListId();

    // Convert to ms timestamps for ClickUp API
    const sinceMs = since ? new Date(since).getTime() : null;
    // until is end-of-day
    const untilMs = until ? new Date(`${until}T23:59:59Z`).getTime() : null;

    // Filter by creation date — tasks are created when they enter the demo workflow.
    // We count ALL tasks created in the period (regardless of current status) so demos
    // that have since progressed past Copy (Design, Review, Live, etc.) are still counted.
    function buildQuery(page: number): string {
      let q = `/list/${listId}/task?include_closed=true&subtasks=false&order_by=created&reverse=true&page=${page}`;
      if (sinceMs) q += `&date_created_gt=${sinceMs}`;
      if (untilMs) q += `&date_created_lt=${untilMs}`;
      return q;
    }

    // Paginate until empty
    const allTasks: ClickUpTask[] = [];
    let page = 0;
    while (true) {
      const res = await clickup.get<ClickUpTasksResponse>(buildQuery(page));
      const batch = res.tasks ?? [];
      allTasks.push(...batch);
      if (batch.length < 100) break;
      page++;
    }

    // Count only top-level "Email Demo" parent tasks — one per unique client demo
    const count = allTasks.filter(
      (t) => !t.parent && t.name.toLowerCase().includes(": email demo")
    ).length;

    return NextResponse.json({ count });
  } catch (err) {
    console.error("[/api/clickup/demos/count]", err);
    return NextResponse.json({ count: 0 }, { status: 500 });
  }
}
