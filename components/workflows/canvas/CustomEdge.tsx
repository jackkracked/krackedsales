"use client";

import { useState, useCallback } from "react";
import {
  getBezierPath,
  EdgeLabelRenderer,
  BaseEdge,
  type EdgeProps,
  type Edge,
} from "@xyflow/react";
import { Trash2, Plus } from "lucide-react";
import { useWorkflowCanvasStore } from "@/store/workflow-canvas-store";
import { NODE_CATALOG } from "@/lib/workflows/node-catalog";

export function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps<Edge>) {
  const [hovered, setHovered] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  // Call store actions via getState() — no subscription, no re-renders from store changes
  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setShowPicker(false);
      useWorkflowCanvasStore.getState().deleteEdge(id);
    },
    [id]
  );

  const handleInsert = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setShowPicker((v) => !v);
    },
    []
  );

  const handlePickNode = useCallback(
    (type: string) => {
      setShowPicker(false);
      useWorkflowCanvasStore.getState().insertNodeOnEdge(id, type);
    },
    [id]
  );

  return (
    <>
      <BaseEdge
        path={edgePath}
        interactionWidth={20}
        style={{
          stroke: hovered ? "hsl(var(--primary))" : "hsl(var(--border))",
          strokeWidth: hovered ? 2 : 1.5,
          transition: "stroke 0.15s, stroke-width 0.15s",
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />

      <EdgeLabelRenderer>
        {/* Hover buttons — trash + plus — at midpoint */}
        {hovered && !showPicker && (
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
            }}
            className="flex items-center gap-1"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <button
              onClick={handleInsert}
              className="w-6 h-6 rounded-full bg-card border border-border shadow-sm flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary transition-colors"
              title="Insert node"
            >
              <Plus className="w-3 h-3" />
            </button>
            <button
              onClick={handleDelete}
              className="w-6 h-6 rounded-full bg-card border border-border shadow-sm flex items-center justify-center text-muted-foreground hover:text-red-500 hover:border-red-400 transition-colors"
              title="Delete connection"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Node type picker popover */}
        {showPicker && (
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
              zIndex: 1000,
            }}
          >
            <div
              className="fixed inset-0 z-[-1]"
              onClick={() => setShowPicker(false)}
            />
            <div className="bg-card border border-border rounded-xl shadow-xl p-2 w-56 max-h-72 overflow-y-auto">
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground px-2 py-1 mb-1">
                Insert node
              </p>
              {NODE_CATALOG.map((def) => (
                <button
                  key={def.type}
                  onClick={() => handlePickNode(def.type)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-left hover:bg-primary/10 hover:text-primary transition-colors"
                >
                  <span className="text-sm shrink-0">{def.icon}</span>
                  <span className="text-[12px] font-medium truncate">{def.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
