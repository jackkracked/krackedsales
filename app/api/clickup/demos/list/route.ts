import { NextRequest, NextResponse } from "next/server";
import { clickup, demoListId } from "@/lib/clickup/client";

export const dynamic = "force-dynamic";

interface ClickUpTask {
  id: string;
  name: string;
  date_created: string;
  date_updated: string;
  status?: { status: string };
  parent?: string;
}

interface ClickUpTasksResponse {
  tasks: ClickUpTask[];
}

export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since");
  const until = req.nextUrl.searchParams.get("until");

  try {
    const listId = demoListId();

    const sinceMs = since ? new Date(since).getTime() : null;
    const untilMs = until ? new Date(`${until}T23:59:59Z`).getTime() : null;

    function buildQuery(page: number): string {
      let q = `/list/${listId}/task?include_closed=true&subtasks=false&order_by=created&reverse=true&page=${page}`;
      if (sinceMs) q += `&date_created_gt=${sinceMs}`;
      if (untilMs) q += `&date_created_lt=${untilMs}`;
      return q;
    }

    const allTasks: ClickUpTask[] = [];
    let page = 0;
    while (true) {
      const res = await clickup.get<ClickUpTasksResponse>(buildQuery(page));
      const batch = res.tasks ?? [];
      allTasks.push(...batch);
      if (batch.length < 100) break;
      page++;
    }

    // Only top-level "Email Demo" parent tasks
    const demos = allTasks
      .filter((t) => !t.parent && t.name.toLowerCase().includes(": email demo"))
      .map((t) => {
        // "BrandName: Email Demo" → "BrandName"
        const brand = t.name.replace(/:\s*email demo$/i, "").trim();
        const createdMs = parseInt(t.date_created, 10);
        const date = new Date(createdMs).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        return {
          id: t.id,
          brand,
          status: t.status?.status ?? "unknown",
          date,
          createdMs,
        };
      })
      .sort((a, b) => b.createdMs - a.createdMs);

    return NextResponse.json({ demos });
  } catch (err) {
    console.error("[/api/clickup/demos/list]", err);
    return NextResponse.json({ demos: [] }, { status: 500 });
  }
}
