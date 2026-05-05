import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";

const NODE_DIMS: Record<string, { width: number; height: number }> = {
  trigger:   { width: 210, height:  50 },
  message:   { width: 290, height: 140 },
  condition: { width: 210, height: 110 },
  action:    { width: 170, height:  48 },
};

const DEFAULT_DIMS = { width: 220, height: 100 };

function nodeWidth(node: Node): number {
  return (NODE_DIMS[node.type ?? ""] ?? DEFAULT_DIMS).width;
}

function centerX(node: Node): number {
  return node.position.x + nodeWidth(node) / 2;
}

// ─── Column snapping ──────────────────────────────────────────────────────────
// After Dagre runs, nodes in the same vertical chain are often placed at
// slightly different x-coordinates. This uses union-find to group nodes that
// are connected AND nearly x-aligned, then snaps each group to the same center x.

function snapToColumns(nodes: Node[], edges: Edge[]): Node[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Union-Find
  const parent = new Map<string, string>(nodes.map((n) => [n.id, n.id]));

  function find(id: string): string {
    if (parent.get(id) !== id) parent.set(id, find(parent.get(id)!));
    return parent.get(id)!;
  }

  function union(a: string, b: string) {
    parent.set(find(a), find(b));
  }

  // Only snap nodes that are connected by a DOWNWARD edge (source.y < target.y).
  // This excludes cross-column return edges (e.g. follow-up reply → main spine)
  // which go upward in rank and are the root cause of same-rank stacking.
  // Within a true vertical chain, Dagre drift is at most ~80px, so 80px is safe.
  const THRESHOLD = 80;
  edges.forEach((edge) => {
    const src = nodeMap.get(edge.source);
    const tgt = nodeMap.get(edge.target);
    if (!src || !tgt) return;
    // Skip edges that go upward — those are cross-column return paths
    if (tgt.position.y <= src.position.y) return;
    if (Math.abs(centerX(src) - centerX(tgt)) < THRESHOLD) {
      union(edge.source, edge.target);
    }
  });

  // Collect groups
  const groups = new Map<string, Node[]>();
  nodes.forEach((n) => {
    const root = find(n.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(n);
  });

  // Snap each group to its median center x
  const result: Node[] = nodes.map((n) => ({ ...n, position: { ...n.position } }));
  const resultMap = new Map(result.map((n) => [n.id, n]));

  groups.forEach((group) => {
    const xs = group.map(centerX).sort((a, b) => a - b);
    const median = xs[Math.floor(xs.length / 2)];
    group.forEach((n) => {
      const w = nodeWidth(n);
      resultMap.get(n.id)!.position.x = median - w / 2;
    });
  });

  return result;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function getLayoutedNodes(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();

  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "TB",
    ranksep: 110,   // vertical gap between ranks
    nodesep: 130,   // horizontal gap between sibling nodes — wider prevents branch overlap
    edgesep: 50,
    marginx: 80,
    marginy: 80,
  });

  nodes.forEach((node) => {
    const dims = NODE_DIMS[node.type ?? ""] ?? DEFAULT_DIMS;
    g.setNode(node.id, { width: dims.width, height: dims.height });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const layouted: Node[] = nodes.map((node) => {
    const pos = g.node(node.id);
    const dims = NODE_DIMS[node.type ?? ""] ?? DEFAULT_DIMS;
    return {
      ...node,
      position: {
        x: pos.x - dims.width / 2,
        y: pos.y - dims.height / 2,
      },
    };
  });

  // Snap nodes in the same vertical chain to the exact same x
  return snapToColumns(layouted, edges);
}
