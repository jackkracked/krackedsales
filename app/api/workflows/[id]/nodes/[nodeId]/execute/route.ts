import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workflows, workflowRuns, workflowRunLogs } from "@/lib/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { NODE_HANDLERS } from "@/lib/workflows/nodes/index";
import type { FlowNode, FlowEdge } from "@/lib/workflows/executor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; nodeId: string }> }
) {
  const { id, nodeId } = await params;

  const [workflow] = await db()
    .select()
    .from(workflows)
    .where(eq(workflows.id, id))
    .limit(1);
  if (!workflow) return NextResponse.json({ error: "not found" }, { status: 404 });

  const nodes = (Array.isArray(workflow.nodes) ? workflow.nodes : []) as FlowNode[];
  const edges = (Array.isArray(workflow.edges) ? workflow.edges : []) as FlowEdge[];

  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return NextResponse.json({ error: "node not found" }, { status: 404 });

  // Trigger nodes use client-side listen mode
  if (node.type.startsWith("trigger.")) {
    return NextResponse.json({ isTrigger: true });
  }

  const handler = NODE_HANDLERS[node.type];
  if (!handler) {
    return NextResponse.json({ error: `Unknown node type: ${node.type}` }, { status: 400 });
  }

  // Resolve upstream node
  const inEdge = edges.find((e) => e.target === nodeId);
  const upstreamNodeId = inEdge?.source ?? null;

  if (!upstreamNodeId) {
    return NextResponse.json({ noUpstreamData: true, upstreamNodeLabel: null });
  }

  const upstreamNode = nodes.find((n) => n.id === upstreamNodeId);
  const upstreamNodeLabel = upstreamNode
    ? String((upstreamNode.data?.label as string | undefined) ?? upstreamNode.type)
    : "upstream node";

  // Get the most recent output for the upstream node in this workflow
  const [latestLog] = await db()
    .select({ outputData: workflowRunLogs.outputData })
    .from(workflowRunLogs)
    .innerJoin(workflowRuns, eq(workflowRunLogs.runId, workflowRuns.id))
    .where(
      and(
        eq(workflowRunLogs.nodeId, upstreamNodeId),
        eq(workflowRuns.workflowId, id)
      )
    )
    .orderBy(desc(workflowRunLogs.executedAt))
    .limit(1);

  if (!latestLog?.outputData) {
    return NextResponse.json({ noUpstreamData: true, upstreamNodeLabel });
  }

  const inputData = latestLog.outputData as Record<string, unknown>;
  const config: Record<string, unknown> = { ...(node.data.config ?? {}) };
  const context: Record<string, unknown> = {
    trigger: inputData,
    [upstreamNodeId]: inputData,
  };

  const start = Date.now();
  try {
    const result = await handler({ config, input: inputData, context });
    const durationMs = Date.now() - start;
    return NextResponse.json({ output: result.output, durationMs, upstreamNodeLabel });
  } catch (err) {
    const durationMs = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error, durationMs, upstreamNodeLabel });
  }
}
