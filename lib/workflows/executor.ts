import { db } from "@/lib/db";
import { workflowRuns, workflowRunLogs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { NODE_HANDLERS } from "./nodes/index";

export interface FlowNode {
  id: string;
  type: string;
  data: {
    triggerEvent?: string;
    label?: string;
    config?: Record<string, unknown>;
    condition?: string;
    [key: string]: unknown;
  };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
}

export interface WorkflowDef {
  id: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

function buildAdjacency(edges: FlowEdge[]): Map<string, FlowEdge[]> {
  const map = new Map<string, FlowEdge[]>();
  for (const edge of edges) {
    const list = map.get(edge.source) ?? [];
    list.push(edge);
    map.set(edge.source, list);
  }
  return map;
}

export async function executeWorkflow(
  workflow: WorkflowDef,
  triggerNodes: FlowNode[],
  triggerData: Record<string, unknown>,
  options?: { triggerOnly?: boolean }
): Promise<string> {
  const nodes = workflow.nodes;
  const edges = workflow.edges;
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const adjacency = buildAdjacency(edges);

  // Build deduplicated name → id map so {{nodeName.key}} resolves at runtime
  const labelCount = new Map<string, number>();
  for (const n of nodes) {
    const label = String(n.data.label ?? n.type ?? n.id);
    labelCount.set(label, (labelCount.get(label) ?? 0) + 1);
  }
  const labelSeen = new Map<string, number>();
  const nodeContextName = new Map<string, string>();
  for (const n of nodes) {
    const label = String(n.data.label ?? n.type ?? n.id);
    if ((labelCount.get(label) ?? 0) > 1) {
      const seen = (labelSeen.get(label) ?? 0) + 1;
      labelSeen.set(label, seen);
      nodeContextName.set(n.id, `${label} ${seen}`);
    } else {
      nodeContextName.set(n.id, label);
    }
  }

  const [run] = await db()
    .insert(workflowRuns)
    .values({
      workflowId: workflow.id,
      triggerEvent: triggerNodes[0]?.data?.triggerEvent ?? "unknown",
      triggerData: triggerData as Record<string, unknown>,
      status: "running",
    })
    .returning({ id: workflowRuns.id });

  const runId = run.id;
  const context: Record<string, unknown> = {
    trigger: triggerData,
    ...Object.fromEntries(triggerNodes.map((tn) => [tn.id, triggerData])),
    // Also key by display name so {{nodeName.key}} syntax works
    ...Object.fromEntries(
      triggerNodes.map((tn) => [nodeContextName.get(tn.id) ?? tn.id, triggerData])
    ),
  };

  let hasError = false;

  // Log trigger nodes
  for (const tn of triggerNodes) {
    await db().insert(workflowRunLogs).values({
      runId,
      nodeId: tn.id,
      nodeType: tn.type,
      nodeName: String(tn.data.label ?? tn.type),
      status: "success",
      inputData: triggerData as Record<string, unknown>,
      outputData: triggerData as Record<string, unknown>,
      durationMs: 0,
    });
  }

  const queue: string[] = [];
  const visited = new Set<string>();

  // In triggerOnly mode (Listen capture) — stop after logging the trigger, don't run downstream
  if (options?.triggerOnly) {
    await db()
      .update(workflowRuns)
      .set({ status: "success", completedAt: new Date() })
      .where(eq(workflowRuns.id, runId));
    return runId;
  }

  // Seed queue with nodes downstream of trigger nodes
  for (const tn of triggerNodes) {
    visited.add(tn.id);
    const outEdges = adjacency.get(tn.id) ?? [];
    queue.push(...outEdges.map((e) => e.target));
  }

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = nodeMap.get(nodeId);
    if (!node) continue;

    const handler = NODE_HANDLERS[node.type];
    if (!handler) {
      await db().insert(workflowRunLogs).values({
        runId, nodeId, nodeType: node.type,
        nodeName: String(node.data.label ?? node.type),
        status: "error",
        error: `Unknown node type: ${node.type}`,
        durationMs: 0,
      });
      hasError = true;
      continue;
    }

    const start = Date.now();
    const config: Record<string, unknown> = {
      ...(node.data.config ?? {}),
    };
    if (node.type === "control.if" && node.data.condition) {
      config.condition = node.data.condition;
    }

    const inEdges = edges.filter((e) => e.target === nodeId);
    const upstreamId = inEdges[0]?.source;
    const input =
      upstreamId && context[upstreamId]
        ? (context[upstreamId] as Record<string, unknown>)
        : {};

    try {
      const result = await handler({ config, input, context });
      const durationMs = Date.now() - start;
      context[nodeId] = result.output;
      const contextName = nodeContextName.get(nodeId);
      if (contextName) context[contextName] = result.output;

      await db().insert(workflowRunLogs).values({
        runId, nodeId, nodeType: node.type,
        nodeName: String(node.data.label ?? node.type),
        status: "success",
        inputData: input as Record<string, unknown>,
        outputData: result.output as Record<string, unknown>,
        durationMs,
      });

      const outEdges = adjacency.get(nodeId) ?? [];
      if (node.type === "control.if") {
        const branch = result.output.branch as string;
        const matching = outEdges.filter(
          (e) => e.sourceHandle === branch || e.sourceHandle == null
        );
        queue.push(...matching.map((e) => e.target));
      } else if (node.type === "control.switch") {
        const value = result.output.value as string;
        const matching = outEdges.filter(
          (e) => e.sourceHandle === value || e.sourceHandle === "default"
        );
        queue.push(...(matching.length > 0 ? matching : outEdges).map((e) => e.target));
      } else {
        queue.push(...outEdges.map((e) => e.target));
      }
    } catch (err) {
      const durationMs = Date.now() - start;
      const errorMsg = err instanceof Error ? err.message : String(err);
      hasError = true;
      await db().insert(workflowRunLogs).values({
        runId, nodeId, nodeType: node.type,
        nodeName: String(node.data.label ?? node.type),
        status: "error",
        inputData: input as Record<string, unknown>,
        error: errorMsg,
        durationMs,
      });
      console.error(`[Workflow ${workflow.id}] Node ${nodeId} (${node.type}) error:`, err);
    }
  }

  await db()
    .update(workflowRuns)
    .set({ status: hasError ? "partial" : "success", completedAt: new Date() })
    .where(eq(workflowRuns.id, runId));

  return runId;
}
