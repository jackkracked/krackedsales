import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workflows } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { executeWorkflow, type FlowNode, type FlowEdge } from "@/lib/workflows/executor";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const [workflow] = await db()
    .select()
    .from(workflows)
    .where(eq(workflows.id, id))
    .limit(1);
  if (!workflow) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const triggerData = ((body.triggerData as Record<string, unknown>) ?? {});

  const nodes = (Array.isArray(workflow.nodes) ? workflow.nodes : []) as FlowNode[];
  const edges = (Array.isArray(workflow.edges) ? workflow.edges : []) as FlowEdge[];
  const triggerNodes = nodes.filter((n) => n.type.startsWith("trigger."));
  const toExecute = triggerNodes.length > 0 ? [triggerNodes[0]] : nodes.slice(0, 1);

  if (toExecute.length === 0) {
    return NextResponse.json({ error: "workflow has no nodes" }, { status: 400 });
  }

  const runId = await executeWorkflow(
    { id: workflow.id, nodes, edges },
    toExecute,
    { ...triggerData, _manualRun: true }
  );

  return NextResponse.json({ runId });
}
