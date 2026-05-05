"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useViewport,
  addEdge,
  type Node,
  type Edge,
  type OnConnect,
  type NodeTypes,
  MarkerType,
  getSmoothStepPath,
  BaseEdge,
  type EdgeProps,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQuery } from "@tanstack/react-query";
import { TriggerNode } from "./nodes/trigger-node";
import { MessageNode } from "./nodes/message-node";
import { ConditionNode } from "./nodes/condition-node";
import { ActionNode } from "./nodes/action-node";
import {
  RefreshCw, Layers, LayoutDashboard,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
} from "lucide-react";
import { getLayoutedNodes } from "@/lib/utils/flow-layout";
import { useFlowEditor } from "@/stores/flow-editor";

// ─── Custom edge ──────────────────────────────────────────────────────────────

function FlowEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, data, markerEnd, label,
}: EdgeProps) {
  const branchType = (data as { branchType?: string })?.branchType;

  // When handles are within 50px horizontally, draw a dead-straight vertical
  // line. 50px comfortably absorbs any remaining rendered-width mismatch after
  // column snapping, while long-range lateral edges are always 250px+ apart.
  const isVerticallyAligned = Math.abs(sourceX - targetX) < 50;

  const midY = (sourceY + targetY) / 2;
  const straightPath = `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;

  // All edges use smoothstep (right-angle routing) for a consistent look.
  const [stepPath, stepLabelX, stepLabelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
    borderRadius: 14,
  });

  const edgePath = isVerticallyAligned ? straightPath : stepPath;
  const labelX   = isVerticallyAligned ? sourceX      : stepLabelX;
  const labelY   = isVerticallyAligned ? midY         : stepLabelY;

  const color =
    branchType === "negative"  ? "#dc2626" :
    branchType === "followup"  ? "#d97706" :
    branchType === "immediate" ? "#7c3aed" :
    branchType === "positive"  ? "#16a34a" :
    "var(--muted-foreground)";

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: color,
          strokeWidth: 2,
          strokeDasharray: branchType === "followup" ? "6 3" : "none",
        }}
      />
      {label && (
        <foreignObject
          x={labelX - 40}
          y={labelY - 13}
          width={80}
          height={26}
          className="pointer-events-none overflow-visible"
        >
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%" }}>
            <span
              style={{
                background: "var(--card)",
                color,
                border: `1.5px solid ${color}`,
                padding: "2px 8px",
                borderRadius: "999px",
                fontSize: "10px",
                fontWeight: 600,
                whiteSpace: "nowrap",
                display: "inline-block",
                lineHeight: "1.4",
              }}
            >
              {label as string}
            </span>
          </div>
        </foreignObject>
      )}
    </>
  );
}

// ─── Node types ───────────────────────────────────────────────────────────────

const NODE_TYPES: NodeTypes = {
  trigger:   TriggerNode,
  message:   MessageNode,
  condition: ConditionNode,
  action:    ActionNode,
};

const EDGE_TYPES = { flowEdge: FlowEdge };

// ─── Node dimension helpers ───────────────────────────────────────────────────
// Used for both the alignment toolbar and drag-snap calculations.

const SNAP_W: Record<string, number> = { trigger: 210, message: 290, condition: 210, action: 170 };
const SNAP_H: Record<string, number> = { trigger: 50,  message: 140, condition: 110, action: 48  };

function getNodeDims(n: Node) {
  return {
    w: (n as any).measured?.width  ?? SNAP_W[n.type ?? ""] ?? 220,
    h: (n as any).measured?.height ?? SNAP_H[n.type ?? ""] ?? 100,
  };
}

// ─── Canvas ───────────────────────────────────────────────────────────────────

function Canvas({ initialNodes, initialEdges }: { initialNodes: Node[]; initialEdges: Edge[] }) {
  const { fitView, getNodes, getEdges } = useReactFlow();
  const closeEditor = useFlowEditor((s) => s.close);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // ── History (undo/redo) ──────────────────────────────────────────────────────
  const history = useRef<{ nodes: Node[]; edges: Edge[] }[]>([
    { nodes: initialNodes, edges: initialEdges },
  ]);
  const historyIdx = useRef(0);
  const suppressSave = useRef(false);

  const pushHistory = useCallback(() => {
    const ns = getNodes();
    const es = getEdges();
    history.current = history.current.slice(0, historyIdx.current + 1);
    history.current.push({ nodes: ns, edges: es });
    if (history.current.length > 50) history.current.shift();
    else historyIdx.current++;
  }, [getNodes, getEdges]);

  const undo = useCallback(() => {
    if (historyIdx.current <= 0) return;
    historyIdx.current--;
    suppressSave.current = true;
    setNodes(history.current[historyIdx.current].nodes);
    setEdges(history.current[historyIdx.current].edges);
    setTimeout(() => { suppressSave.current = false; }, 50);
  }, [setNodes, setEdges]);

  const redo = useCallback(() => {
    if (historyIdx.current >= history.current.length - 1) return;
    historyIdx.current++;
    suppressSave.current = true;
    setNodes(history.current[historyIdx.current].nodes);
    setEdges(history.current[historyIdx.current].edges);
    setTimeout(() => { suppressSave.current = false; }, 50);
  }, [setNodes, setEdges]);

  // ── Clipboard ────────────────────────────────────────────────────────────────
  const clipboard = useRef<Node[]>([]);

  // ── Auto-save positions ──────────────────────────────────────────────────────
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedSave = useCallback((updatedNodes: Node[]) => {
    if (suppressSave.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch("/api/flow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodes: updatedNodes.map((n) => ({
            id: n.id,
            type: n.type,
            positionX: Math.round(n.position.x),
            positionY: Math.round(n.position.y),
            data: n.data,
          })),
        }),
      }).catch(() => {});
    }, 800);
  }, []);

  // ── Auto-layout (Dagre) ──────────────────────────────────────────────────────
  const saveImmediate = useCallback((updatedNodes: Node[]) => {
    fetch("/api/flow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodes: updatedNodes.map((n) => ({
          id: n.id,
          type: n.type,
          positionX: Math.round(n.position.x),
          positionY: Math.round(n.position.y),
          data: n.data,
        })),
      }),
    }).catch(() => {});
  }, []);

  const handleAutoLayout = useCallback(() => {
    const currentNodes = getNodes();
    const currentEdges = getEdges();
    const layouted = getLayoutedNodes(currentNodes, currentEdges);
    setNodes(layouted);
    setTimeout(() => {
      fitView({ padding: 0.15, duration: 500 });
      pushHistory();
      saveImmediate(layouted);
    }, 50);
  }, [getNodes, getEdges, setNodes, fitView, pushHistory, saveImmediate]);

  // Run auto-layout once on mount so the flow always opens looking neat
  const didAutoLayout = useRef(false);
  useEffect(() => {
    if (didAutoLayout.current) return;
    didAutoLayout.current = true;
    // Small delay so ReactFlow has finished its initial render/measurement
    const t = setTimeout(() => handleAutoLayout(), 120);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      const cmd = e.metaKey || e.ctrlKey;

      if (cmd && !e.shiftKey && e.key === "z") { e.preventDefault(); undo(); return; }
      if (cmd && e.shiftKey  && e.key === "z") { e.preventDefault(); redo(); return; }
      if (cmd && e.key === "y")                { e.preventDefault(); redo(); return; }

      if (cmd && e.key === "a") {
        e.preventDefault();
        setNodes((nds) => nds.map((n) => ({ ...n, selected: true })));
        return;
      }

      if (cmd && e.key === "c") {
        const selected = getNodes().filter((n) => n.selected);
        if (selected.length) clipboard.current = selected;
        return;
      }

      if (cmd && e.key === "v") {
        if (!clipboard.current.length) return;
        const newNodes: Node[] = clipboard.current.map((n) => ({
          ...n,
          id: `${n.id}_copy_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          position: { x: n.position.x + 40, y: n.position.y + 40 },
          selected: true,
          data: { ...n.data },
        }));
        setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), ...newNodes]);
        clipboard.current = newNodes;
        setTimeout(() => pushHistory(), 0);
        return;
      }

      if (cmd && e.key === "d") {
        e.preventDefault();
        const selected = getNodes().filter((n) => n.selected);
        if (!selected.length) return;
        const newNodes: Node[] = selected.map((n) => ({
          ...n,
          id: `${n.id}_dup_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          position: { x: n.position.x + 40, y: n.position.y + 40 },
          selected: true,
          data: { ...n.data },
        }));
        setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), ...newNodes]);
        setTimeout(() => pushHistory(), 0);
        return;
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, pushHistory, setNodes, getNodes]);

  // ── Event handlers ───────────────────────────────────────────────────────────

  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      onNodesChange(changes);
      setNodes((nds) => { debouncedSave(nds); return nds; });
    },
    [onNodesChange, setNodes, debouncedSave]
  );

  const handleEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      onEdgesChange(changes);
      if (changes.some((c) => c.type === "remove")) setTimeout(() => pushHistory(), 0);
    },
    [onEdgesChange, pushHistory]
  );

  const onConnect: OnConnect = useCallback(
    (params) => {
      setEdges((eds) => addEdge({ ...params, type: "flowEdge" }, eds));
      setTimeout(() => pushHistory(), 0);
    },
    [setEdges, pushHistory]
  );

  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    // Build the final nodes array, applying the snapped position if there is one.
    // We do this synchronously so the fetch below captures the correct coordinates.
    let finalNodes = getNodes();
    if (pendingSnap.current && pendingSnap.current.nodeId === node.id) {
      const { nodeId, x, y } = pendingSnap.current;
      finalNodes = finalNodes.map((n) => n.id === nodeId ? { ...n, position: { x, y } } : n);
      setNodes(finalNodes);
      pendingSnap.current = null;
    }

    setSnapGuides([]);
    pushHistory();

    // Persist all positions immediately on every drop (not debounced) so
    // the layout survives a page reload without needing auto-layout on mount.
    fetch("/api/flow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodes: finalNodes.map((n) => ({
          id: n.id,
          type: n.type,
          positionX: Math.round(n.position.x),
          positionY: Math.round(n.position.y),
          data: n.data,
        })),
      }),
    }).catch(() => {});
  }, [getNodes, setNodes, pushHistory]);

  // ── Drag-snap (Miro-style) ────────────────────────────────────────────────────
  // While dragging a node, detect when any of its 6 alignment lines (left,
  // center-x, right, top, center-y, bottom) nearly aligns with the same lines
  // on any other node. Snap to the closest match and draw a guide line.

  const [snapGuides, setSnapGuides] = useState<Array<{ type: "x" | "y"; pos: number }>>([]);
  const { x: vpX, y: vpY, zoom } = useViewport();
  // Holds the last snapped position so onNodeDragStop can re-apply it and
  // override ReactFlow's mouse-derived final position (which drifts 1-2px).
  const pendingSnap = useRef<{ nodeId: string; x: number; y: number } | null>(null);

  const onNodeDrag = useCallback((_: unknown, draggedNode: Node) => {
    // 10 screen-px threshold, scaled to flow coordinates
    const threshold = 10 / zoom;
    const others = getNodes().filter((n) => n.id !== draggedNode.id);
    if (!others.length) { setSnapGuides([]); pendingSnap.current = null; return; }

    const { w: dw, h: dh } = getNodeDims(draggedNode);
    const { x: dx, y: dy } = draggedNode.position;

    // 3 snap lines per axis for the dragging node: left/center/right & top/center/bottom
    const dxPts = [dx,        dx + dw / 2, dx + dw];
    const dyPts = [dy,        dy + dh / 2, dy + dh];
    const xOff  = [0,         dw / 2,      dw];
    const yOff  = [0,         dh / 2,      dh];

    let bestX: { delta: number; guide: number; newX: number } | null = null;
    let bestY: { delta: number; guide: number; newY: number } | null = null;

    for (const other of others) {
      const { w: ow, h: oh } = getNodeDims(other);
      const ox = other.position.x, oy = other.position.y;
      const oxPts = [ox, ox + ow / 2, ox + ow];
      const oyPts = [oy, oy + oh / 2, oy + oh];

      for (let di = 0; di < 3; di++) {
        for (let oi = 0; oi < 3; oi++) {
          const xd = Math.abs(dxPts[di] - oxPts[oi]);
          if (xd < threshold && (!bestX || xd < bestX.delta))
            bestX = { delta: xd, guide: oxPts[oi], newX: oxPts[oi] - xOff[di] };

          const yd = Math.abs(dyPts[di] - oyPts[oi]);
          if (yd < threshold && (!bestY || yd < bestY.delta))
            bestY = { delta: yd, guide: oyPts[oi], newY: oyPts[oi] - yOff[di] };
        }
      }
    }

    const guides: typeof snapGuides = [];
    if (bestX) guides.push({ type: "x", pos: bestX.guide });
    if (bestY) guides.push({ type: "y", pos: bestY.guide });
    setSnapGuides(guides);

    if (bestX || bestY) {
      const snapped = { x: bestX?.newX ?? dx, y: bestY?.newY ?? dy };
      pendingSnap.current = { nodeId: draggedNode.id, ...snapped };
      setNodes((nds) =>
        nds.map((n) =>
          n.id === draggedNode.id ? { ...n, position: snapped } : n
        )
      );
    } else {
      pendingSnap.current = null;
    }
  }, [getNodes, setNodes, zoom]);

  // ── Alignment toolbar ────────────────────────────────────────────────────────

  const applyAlignment = useCallback(
    (moveFn: (sel: Node[]) => Node[]) => {
      const sel = getNodes().filter((n) => n.selected);
      if (sel.length < 2) return;
      const moved = moveFn(sel);
      const movedMap = new Map(moved.map((n) => [n.id, n]));
      setNodes((nds) => nds.map((n) => movedMap.get(n.id) ?? n));
      setTimeout(() => pushHistory(), 0);
    },
    [getNodes, setNodes, pushHistory]
  );

  const alignLeft     = useCallback(() => applyAlignment((sel) => {
    const x = Math.min(...sel.map((n) => n.position.x));
    return sel.map((n) => ({ ...n, position: { ...n.position, x } }));
  }), [applyAlignment]);

  const alignCenterH  = useCallback(() => applyAlignment((sel) => {
    const cx = sel.reduce((sum, n) => sum + n.position.x + getNodeDims(n).w / 2, 0) / sel.length;
    return sel.map((n) => ({ ...n, position: { ...n.position, x: cx - getNodeDims(n).w / 2 } }));
  }), [applyAlignment]);

  const alignRight    = useCallback(() => applyAlignment((sel) => {
    const x = Math.max(...sel.map((n) => n.position.x + getNodeDims(n).w));
    return sel.map((n) => ({ ...n, position: { ...n.position, x: x - getNodeDims(n).w } }));
  }), [applyAlignment]);

  const alignTop      = useCallback(() => applyAlignment((sel) => {
    const y = Math.min(...sel.map((n) => n.position.y));
    return sel.map((n) => ({ ...n, position: { ...n.position, y } }));
  }), [applyAlignment]);

  const alignCenterV  = useCallback(() => applyAlignment((sel) => {
    const cy = sel.reduce((sum, n) => sum + n.position.y + getNodeDims(n).h / 2, 0) / sel.length;
    return sel.map((n) => ({ ...n, position: { ...n.position, y: cy - getNodeDims(n).h / 2 } }));
  }), [applyAlignment]);

  const alignBottom   = useCallback(() => applyAlignment((sel) => {
    const y = Math.max(...sel.map((n) => n.position.y + getNodeDims(n).h));
    return sel.map((n) => ({ ...n, position: { ...n.position, y: y - getNodeDims(n).h } }));
  }), [applyAlignment]);

  const selectedCount = nodes.filter((n) => n.selected).length;

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={handleNodesChange}
      onEdgesChange={handleEdgesChange}
      onConnect={onConnect}
      onPaneClick={closeEditor}
      onNodeDrag={onNodeDrag}
      onNodeDragStop={onNodeDragStop}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      deleteKeyCode={["Backspace", "Delete"]}
      multiSelectionKeyCode={["Meta", "Control"]}
      defaultEdgeOptions={{
        type: "flowEdge",
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        animated: false,
      }}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.15}
      maxZoom={2}
      panOnScroll
      panOnScrollMode={undefined}
      zoomOnPinch
      selectionOnDrag={false}
      proOptions={{ hideAttribution: true }}
      style={{ background: "var(--background)" }}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={20}
        size={1.2}
        color="var(--border)"
        style={{ opacity: 0.6 }}
      />

      <Controls
        position="bottom-left"
        showInteractive={false}
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        }}
      />

      <MiniMap
        position="bottom-right"
        nodeColor={(n) => {
          if (n.type === "trigger") return "var(--primary)";
          if (n.type === "message") return "#3b82f6";
          if (n.type === "condition") return "#f59e0b";
          if ((n.data as { actionType?: string })?.actionType === "success") return "#16a34a";
          if ((n.data as { actionType?: string })?.actionType === "wait") return "#d97706";
          return "#94a3b8";
        }}
        maskColor="rgba(0,0,0,0.06)"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
        }}
      />

      {/* Snap guide lines — drawn in flow-space coordinates via viewport transform */}
      {snapGuides.length > 0 && (
        <svg
          className="absolute inset-0 pointer-events-none"
          style={{ width: "100%", height: "100%", zIndex: 5 }}
        >
          <g transform={`translate(${vpX}, ${vpY}) scale(${zoom})`}>
            {snapGuides.map((guide, i) =>
              guide.type === "x" ? (
                <line
                  key={i}
                  x1={guide.pos} y1={-50000}
                  x2={guide.pos} y2={50000}
                  stroke="#3b82f6"
                  strokeWidth={1 / zoom}
                  strokeDasharray={`${5 / zoom} ${4 / zoom}`}
                  opacity={0.8}
                />
              ) : (
                <line
                  key={i}
                  x1={-50000} y1={guide.pos}
                  x2={50000}  y2={guide.pos}
                  stroke="#3b82f6"
                  strokeWidth={1 / zoom}
                  strokeDasharray={`${5 / zoom} ${4 / zoom}`}
                  opacity={0.8}
                />
              )
            )}
          </g>
        </svg>
      )}

      {/* Auto-layout button */}
      <div className="absolute top-4 left-4 z-10">
        <button
          onClick={handleAutoLayout}
          className="flex items-center gap-2 px-3 py-2 text-xs font-semibold bg-card border border-border rounded-lg shadow-sm hover:bg-muted transition-colors text-foreground"
          title="Auto-arrange nodes to remove overlapping edges"
        >
          <LayoutDashboard className="w-3.5 h-3.5 text-primary" />
          Auto-layout
        </button>
      </div>

      {/* Alignment toolbar — visible only when 2+ nodes are selected */}
      {selectedCount >= 2 && (
        <Panel position="top-center">
          <div className="flex items-center gap-1 px-2 py-1.5 bg-card border border-border rounded-xl shadow-lg">
            {/* Horizontal alignment group */}
            {[
              { fn: alignLeft,    Icon: AlignStartHorizontal,  title: "Align left edges" },
              { fn: alignCenterH, Icon: AlignCenterHorizontal, title: "Center horizontally" },
              { fn: alignRight,   Icon: AlignEndHorizontal,    title: "Align right edges" },
            ].map(({ fn, Icon, title }) => (
              <button
                key={title}
                onClick={fn}
                title={title}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Icon className="w-4 h-4" />
              </button>
            ))}

            <div className="w-px h-5 bg-border mx-1" />

            {/* Vertical alignment group */}
            {[
              { fn: alignTop,     Icon: AlignStartVertical,  title: "Align top edges" },
              { fn: alignCenterV, Icon: AlignCenterVertical, title: "Center vertically" },
              { fn: alignBottom,  Icon: AlignEndVertical,    title: "Align bottom edges" },
            ].map(({ fn, Icon, title }) => (
              <button
                key={title}
                onClick={fn}
                title={title}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Icon className="w-4 h-4" />
              </button>
            ))}
          </div>
        </Panel>
      )}
    </ReactFlow>
  );
}

// ─── Wrapper with data fetching ───────────────────────────────────────────────

export function FlowCanvas() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["flow"],
    queryFn: async () => {
      const res = await fetch("/api/flow");
      if (!res.ok) throw new Error("Failed to fetch flow");
      return res.json() as Promise<{ nodes: any[]; edges: any[] }>;
    },
    staleTime: 30 * 1000,
  });

  const rfNodes: Node[] = useMemo(() =>
    (data?.nodes ?? []).map((n) => ({
      id: n.id,
      type: n.type,
      position: { x: n.positionX, y: n.positionY },
      data: { ...(n.data as object), templateId: n.templateId },
    })),
    [data?.nodes]
  );

  const rfEdges: Edge[] = useMemo(() =>
    (data?.edges ?? []).map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
      type: "flowEdge",
      label: e.label ?? undefined,
      data: { branchType: e.branchType },
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    })),
    [data?.edges]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
        <RefreshCw className="w-4 h-4 animate-spin" />
        Loading flow…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground text-sm">
        <p>Failed to load flow. Make sure your database is connected.</p>
      </div>
    );
  }

  if (rfNodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
          <Layers className="w-7 h-7 text-primary" />
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold text-foreground">Flow is empty</p>
          <p className="text-xs text-muted-foreground mt-1">Visit /api/flow/seed to load the default conversation flow</p>
        </div>
        <a
          href="/api/flow/seed"
          className="px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground rounded-[8px] hover:bg-primary/90 transition-colors"
        >
          Seed default flow
        </a>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <Canvas initialNodes={rfNodes} initialEdges={rfEdges} />
    </ReactFlowProvider>
  );
}
