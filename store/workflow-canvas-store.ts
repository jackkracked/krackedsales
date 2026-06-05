import { create } from "zustand";
import type { Node, Edge, Viewport } from "@xyflow/react";
import { NODE_CATALOG } from "@/lib/workflows/node-catalog";

interface HistoryEntry {
  nodes: Node[];
  edges: Edge[];
}

export interface WorkflowCanvasState {
  nodes: Node[];
  edges: Edge[];
  viewport: Viewport;
  selectedNodeId: string | null;
  isDirty: boolean;
  isRunning: boolean;
  lastRunId: string | null;
  // Undo/redo history
  past: HistoryEntry[];
  future: HistoryEntry[];

  setNodes: (nodes: Node[], recordHistory?: boolean) => void;
  setEdges: (edges: Edge[], recordHistory?: boolean) => void;
  setViewport: (viewport: Viewport) => void;
  setSelectedNodeId: (id: string | null) => void;
  setIsDirty: (dirty: boolean) => void;
  setIsRunning: (running: boolean) => void;
  setLastRunId: (id: string | null) => void;
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  insertNodeOnEdge: (edgeId: string, nodeType: string) => void;
  deleteEdge: (edgeId: string) => void;
  undo: () => void;
  redo: () => void;
  snapshot: () => void;
}

export const useWorkflowCanvasStore = create<WorkflowCanvasState>((set, get) => ({
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  selectedNodeId: null,
  isDirty: false,
  isRunning: false,
  lastRunId: null,
  past: [],
  future: [],

  snapshot: () => {
    const { nodes, edges, past } = get();
    set({ past: [...past.slice(-49), { nodes, edges }], future: [] });
  },

  setNodes: (nodes, recordHistory = true) =>
    set((state) => ({
      nodes,
      isDirty: true,
      past: recordHistory ? [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }] : state.past,
      future: recordHistory ? [] : state.future,
    })),

  setEdges: (edges, recordHistory = true) =>
    set((state) => ({
      edges,
      isDirty: true,
      past: recordHistory ? [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }] : state.past,
      future: recordHistory ? [] : state.future,
    })),

  setViewport: (viewport) => set({ viewport }),
  setSelectedNodeId: (selectedNodeId) => set({ selectedNodeId }),
  setIsDirty: (isDirty) => set({ isDirty }),
  setIsRunning: (isRunning) => set({ isRunning }),
  setLastRunId: (lastRunId) => set({ lastRunId }),

  updateNodeData: (nodeId, data) =>
    set((state) => ({
      isDirty: true,
      past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
      future: [],
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
      ),
    })),

  deleteEdge: (edgeId) =>
    set((state) => ({
      edges: state.edges.filter((e) => e.id !== edgeId),
      isDirty: true,
      past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
      future: [],
    })),

  insertNodeOnEdge: (edgeId, nodeType) => {
    const { nodes, edges } = get();
    const edge = edges.find((e) => e.id === edgeId);
    if (!edge) return;
    const sourceNode = nodes.find((n) => n.id === edge.source);
    const targetNode = nodes.find((n) => n.id === edge.target);
    if (!sourceNode || !targetNode) return;

    const def = NODE_CATALOG.find((d) => d.type === nodeType);
    const newNodeId = `${nodeType}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newNode: Node = {
      id: newNodeId,
      type: nodeType,
      position: {
        x: (sourceNode.position.x + targetNode.position.x) / 2,
        y: (sourceNode.position.y + targetNode.position.y) / 2,
      },
      data: {
        label: def?.label ?? nodeType,
        nodeType,
        icon: def?.icon ?? "📦",
        category: def?.category ?? "action",
        config: {},
      },
    };
    const edgeToSource: Edge = {
      id: `e_${edge.source}_${newNodeId}`,
      source: edge.source,
      target: newNodeId,
      type: "customEdge",
      animated: false,
    };
    const edgeToTarget: Edge = {
      id: `e_${newNodeId}_${edge.target}`,
      source: newNodeId,
      target: edge.target,
      type: "customEdge",
      animated: false,
    };

    set((state) => ({
      nodes: [...state.nodes, newNode],
      edges: [...state.edges.filter((e) => e.id !== edgeId), edgeToSource, edgeToTarget],
      isDirty: true,
      past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
      future: [],
    }));
  },

  undo: () => {
    const { past, nodes, edges, future } = get();
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    set({
      nodes: previous.nodes,
      edges: previous.edges,
      past: past.slice(0, -1),
      future: [{ nodes, edges }, ...future.slice(0, 49)],
      isDirty: true,
    });
  },

  redo: () => {
    const { past, nodes, edges, future } = get();
    if (future.length === 0) return;
    const next = future[0];
    set({
      nodes: next.nodes,
      edges: next.edges,
      past: [...past.slice(-49), { nodes, edges }],
      future: future.slice(1),
      isDirty: true,
    });
  },
}));
