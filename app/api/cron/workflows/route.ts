import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workflows } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { executeWorkflow, type FlowNode, type FlowEdge } from "@/lib/workflows/executor";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const cronSecret =
    req.headers.get("x-cron-secret") ??
    req.nextUrl.searchParams.get("secret");
  if (cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const all = await db()
    .select()
    .from(workflows)
    .where(eq(workflows.enabled, true));

  const now = new Date();
  let dispatched = 0;

  for (const workflow of all) {
    const nodes = (Array.isArray(workflow.nodes) ? workflow.nodes : []) as Array<
      FlowNode & { data: { nextRunAt?: string } }
    >;
    const edges = (Array.isArray(workflow.edges) ? workflow.edges : []) as FlowEdge[];
    const scheduleTriggers = nodes.filter((n) => n.type === "trigger.schedule");

    for (const trigger of scheduleTriggers) {
      const nextRunAt = trigger.data.nextRunAt ? new Date(trigger.data.nextRunAt) : null;
      if (!nextRunAt || nextRunAt > now) continue;
      executeWorkflow({ id: workflow.id, nodes, edges }, [trigger], {
        runAt: now.toISOString(),
        scheduledTrigger: true,
      }).catch(console.error);
      dispatched++;
    }
  }

  return NextResponse.json({ ok: true, dispatched, checkedAt: now.toISOString() });
}
