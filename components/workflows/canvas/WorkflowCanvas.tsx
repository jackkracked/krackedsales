"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  BackgroundVariant,
  PanOnScrollMode,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { useWorkflowCanvasStore } from "@/store/workflow-canvas-store";
import { NODE_CATALOG } from "@/lib/workflows/node-catalog";
import { TriggerNode } from "./nodes/TriggerNode";
import { ActionNode } from "./nodes/ActionNode";
import { IfNode } from "./nodes/IfNode";
const NODE_TYPES = {
  "trigger.proposal.paid": TriggerNode,
  "trigger.proposal.signed": TriggerNode,
  "trigger.proposal.sent": TriggerNode,
  "trigger.proposal.created": TriggerNode,
  "trigger.opportunity.created": TriggerNode,
  "trigger.opportunity.stage_changed": TriggerNode,
  "trigger.opportunity.won": TriggerNode,
  "trigger.webhook": TriggerNode,
  "trigger.schedule": TriggerNode,
  "action.send_email": ActionNode,
  "action.send_sms": ActionNode,
  "action.slack_message": ActionNode,
  "action.slack_create_channel": ActionNode,
  "action.http_request": ActionNode,
  "action.create_task": ActionNode,
  "action.set": ActionNode,
  "action.wait": ActionNode,
  "action.code": ActionNode,
  "action.ghl_update_opportunity": ActionNode,
  "action.ghl_add_note": ActionNode,
  "action.http_response": ActionNode,
  "control.if": IfNode,
  "control.switch": ActionNode,
} as const;

interface WorkflowCanvasProps {
  onNodeSelect: (id: string | null) => void;
  onOpenLibrary?: () => void;
}

export function WorkflowCanvas({ onNodeSelect, onOpenLibrary }: WorkflowCanvasProps) {
  const { nodes, edges, setNodes, setEdges, setViewport, undo, redo, snapshot } =
    useWorkflowCanvasStore();
  const { fitView, screenToFlowPosition } = useReactFlow();
  const clipboard = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const navigationTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Copy / Paste ─────────────────────────────────────────────────────────

  const handleCopy = useCallback(() => {
    const selected = nodes.filter((n) => n.selected);
    const selectedIds = new Set(selected.map((n) => n.id));
    const selectedEdges = edges.filter(
      (e) => selectedIds.has(e.source) && selectedIds.has(e.target)
    );
    if (selected.length > 0) {
      clipboard.current = { nodes: selected, edges: selectedEdges };
    }
  }, [nodes, edges]);

  const handlePaste = useCallback(() => {
    if (!clipboard.current) return;
    snapshot();
    const offset = 40;
    const idMap = new Map<string, string>();
    const newNodes: Node[] = clipboard.current.nodes.map((n) => {
      const newId = `${n.type}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      idMap.set(n.id, newId);
      return {
        ...n,
        id: newId,
        position: { x: n.position.x + offset, y: n.position.y + offset },
        selected: true,
        data: { ...n.data },
      };
    });
    const newEdges: Edge[] = clipboard.current.edges.map((e) => ({
      ...e,
      id: `e_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      source: idMap.get(e.source) ?? e.source,
      target: idMap.get(e.target) ?? e.target,
    }));
    setNodes([...nodes.map((n) => ({ ...n, selected: false })), ...newNodes], false);
    setEdges([...edges, ...newEdges], false);
  }, [nodes, edges, snapshot, setNodes, setEdges]);

  // ─── Keyboard shortcuts ───────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if (isMeta && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (isMeta && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
        return;
      }
      if (isMeta && e.key === "c" && !isInput) {
        handleCopy();
        return;
      }
      if (isMeta && e.key === "v" && !isInput) {
        e.preventDefault();
        handlePaste();
        return;
      }
      if (isMeta && e.key === "d" && !isInput) {
        e.preventDefault();
        handleCopy();
        handlePaste();
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo, handleCopy, handlePaste]);

  // ─── Graph handlers ───────────────────────────────────────────────────────

  const onConnect = useCallback(
    (connection: Connection) => {
      // Single atomic Zustand update — avoids intermediate re-render with stale edges
      // that could cause ReactFlow to abort the in-flight connection
      useWorkflowCanvasStore.setState((state) => ({
        edges: addEdge({ ...connection, animated: false }, state.edges),
        isDirty: true,
        past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
        future: [],
      }));
    },
    []
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const currentNodes = useWorkflowCanvasStore.getState().nodes;
      const hasDeletion = changes.some((c) => c.type === "remove");
      if (hasDeletion) snapshot();
      setNodes(applyNodeChanges(changes, currentNodes) as Node[], false);
    },
    [setNodes, snapshot]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      // Always read fresh state to avoid overwriting concurrent onConnect updates
      const currentEdges = useWorkflowCanvasStore.getState().edges;
      const hasDeletion = changes.some((c) => c.type === "remove");
      if (hasDeletion) snapshot();
      setEdges(applyEdgeChanges(changes, currentEdges), false);
    },
    [setEdges, snapshot]
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => onNodeSelect(node.id),
    [onNodeSelect]
  );

  const onPaneClick = useCallback(() => onNodeSelect(null), [onNodeSelect]);

  // ─── Auto-layout ──────────────────────────────────────────────────────────

  const autoLayout = useCallback(() => {
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: "LR", ranksep: 80, nodesep: 40 });
    nodes.forEach((n) => g.setNode(n.id, { width: 224, height: 80 }));
    edges.forEach((e) => g.setEdge(e.source, e.target));
    dagre.layout(g);
    const laid = nodes.map((n) => {
      const pos = g.node(n.id);
      return { ...n, position: { x: pos.x - 112, y: pos.y - 40 } };
    });
    snapshot();
    setNodes(laid, false);
    setTimeout(() => fitView({ padding: 0.1 }), 50);
  }, [nodes, edges, setNodes, fitView, snapshot]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const nodeType = e.dataTransfer.getData("application/nodeType");
      if (!nodeType) return;
      const def = NODE_CATALOG.find((d) => d.type === nodeType);
      if (!def) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const newNode: Node = {
        id: `${nodeType}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: nodeType,
        position,
        data: {
          label: def.label,
          nodeType,
          icon: def.icon,
          category: def.category,
          config: {},
        },
      };
      snapshot();
      setNodes([...useWorkflowCanvasStore.getState().nodes, newNode], false);
    },
    [screenToFlowPosition, snapshot, setNodes]
  );

  return (
    <div className="w-full h-full relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onMoveStart={() => {
          if (navigationTimeout.current) clearTimeout(navigationTimeout.current);
          setIsNavigating(true);
        }}
        onMoveEnd={(_, vp) => {
          setViewport(vp);
          navigationTimeout.current = setTimeout(() => setIsNavigating(false), 1000);
        }}
        fitView
        fitViewOptions={{ padding: 0.1 }}
        connectionRadius={50}
        deleteKeyCode={["Delete", "Backspace"]}
        multiSelectionKeyCode="Shift"
        panOnScroll
        panOnScrollMode={PanOnScrollMode.Free}
        zoomOnPinch
        zoomOnScroll={false}
        panOnDrag
        minZoom={0.1}
        maxZoom={3}
        className="bg-background"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="var(--border)"
        />
        <Controls
          className="!bg-card !border-border [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground"
        />
        {isNavigating && (
          <MiniMap
            className="!bg-card !border-border"
            nodeColor="var(--muted)"
            maskColor="rgba(0,0,0,0.1)"
          />
        )}


        {/* Auto-layout button */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
          <button
            onClick={autoLayout}
            className="px-3 py-1.5 bg-card border border-border rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors shadow-sm"
          >
            Auto-layout
          </button>
        </div>
      </ReactFlow>

      {/* Empty canvas state — absolutely centred over the full canvas area */}
      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
          <div className="flex flex-col items-center gap-4">
            <button
              onClick={onOpenLibrary}
              className="w-20 h-20 rounded-2xl bg-muted/50 border-2 border-dashed border-border flex items-center justify-center hover:bg-primary/10 hover:border-primary transition-colors pointer-events-auto"
              title="Add a node"
            >
              <span className="text-4xl">⚡</span>
            </button>
            <div className="text-center">
              <p className="text-base font-bold text-foreground">Add your first node</p>
              <p className="text-sm text-muted-foreground mt-1">
                Click the lightning bolt or press <span className="font-semibold">+</span> to add a trigger
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
