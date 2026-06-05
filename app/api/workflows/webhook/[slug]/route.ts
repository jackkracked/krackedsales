import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workflowWebhooks, workflows } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { executeWorkflow, type FlowNode, type FlowEdge } from "@/lib/workflows/executor";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const [webhook] = await db()
    .select()
    .from(workflowWebhooks)
    .where(eq(workflowWebhooks.slug, slug))
    .limit(1);
  if (!webhook) return NextResponse.json({ error: "webhook not found" }, { status: 404 });

  const [workflow] = await db()
    .select()
    .from(workflows)
    .where(eq(workflows.id, webhook.workflowId))
    .limit(1);
  if (!workflow?.enabled)
    return NextResponse.json({ error: "workflow not found or disabled" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const nodes = (Array.isArray(workflow.nodes) ? workflow.nodes : []) as FlowNode[];
  const edges = (Array.isArray(workflow.edges) ? workflow.edges : []) as FlowEdge[];
  const triggerNode = nodes.find((n) => n.id === webhook.nodeId);
  if (!triggerNode)
    return NextResponse.json({ error: "trigger node not found" }, { status: 404 });

  const runId = await executeWorkflow(
    { id: workflow.id, nodes, edges },
    [triggerNode],
    { ...body, _webhookSlug: slug }
  );
  return NextResponse.json({ ok: true, runId });
}
