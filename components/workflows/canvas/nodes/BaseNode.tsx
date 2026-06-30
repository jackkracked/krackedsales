"use client";

import { memo, useState } from "react";
import { createPortal } from "react-dom";
import { Handle, Position } from "@xyflow/react";
import { cn } from "@/lib/utils/cn";
import { useWorkflowCanvasStore } from "@/store/workflow-canvas-store";

interface BaseNodeData {
  label?: string;
  nodeType: string;
  icon?: string;
  category?: string;
  isRunSuccess?: boolean;
  isRunError?: boolean;
  isRunning?: boolean;
  isListening?: boolean;
  lastRunOutput?: Record<string, unknown> | null;
  pinnedOutput?: Record<string, unknown>;
  // Execution view overlays (read-only history canvas)
  execViewStatus?: "success" | "error" | "partial" | "running" | "skipped";
}

interface BaseNodeProps {
  id: string;
  data: BaseNodeData;
  selected?: boolean;
  showSourceHandle?: boolean;
  showTargetHandle?: boolean;
  extraHandles?: React.ReactNode;
  children?: React.ReactNode;
}

const CATEGORY_COLORS: Record<string, string> = {
  trigger: "border-t-violet-500",
  action: "border-t-blue-500",
  control: "border-t-amber-500",
};

export const BaseNode = memo(function BaseNode({
  id,
  data,
  selected,
  showSourceHandle = true,
  showTargetHandle = true,
  extraHandles,
  children,
}: BaseNodeProps) {
  const colorClass = CATEGORY_COLORS[data.category ?? "action"] ?? "border-t-blue-500";
  const { updateNodeData } = useWorkflowCanvasStore();

  const [showMenu, setShowMenu] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuPos({ x: e.clientX, y: e.clientY });
    setShowMenu(true);
  };

  const handlePinToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    if (data.pinnedOutput) {
      updateNodeData(id, { pinnedOutput: undefined });
    } else {
      updateNodeData(id, { pinnedOutput: data.lastRunOutput ?? undefined });
    }
  };

  const handleExecuteStep = () => {
    setShowMenu(false);
    document.dispatchEvent(new CustomEvent("wf:execute-node", { detail: { nodeId: id } }));
  };

  const handleDuplicate = () => {
    setShowMenu(false);
    const store = useWorkflowCanvasStore.getState();
    store.snapshot();
    const node = store.nodes.find((n) => n.id === id);
    if (!node) return;
    const newId = `${node.type}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newNode = {
      ...node,
      id: newId,
      position: { x: node.position.x + 40, y: node.position.y + 40 },
      selected: true,
      data: { ...node.data },
    };
    store.setNodes([...store.nodes.map((n) => ({ ...n, selected: false })), newNode], false);
  };

  const handleDelete = () => {
    setShowMenu(false);
    const store = useWorkflowCanvasStore.getState();
    store.snapshot();
    store.setNodes(store.nodes.filter((n) => n.id !== id), false);
    store.setEdges(store.edges.filter((e) => e.source !== id && e.target !== id), false);
  };

  return (
    <>
      <div
        onContextMenu={handleContextMenu}
        data-r10n-wf-node=""
        data-category={data.category ?? "action"}
        data-selected={selected ? "true" : undefined}
        data-run={
          data.isRunSuccess
            ? "success"
            : data.isRunError
            ? "error"
            : data.isRunning
            ? "running"
            : data.isListening
            ? "listening"
            : undefined
        }
        data-exec={data.execViewStatus ?? undefined}
        className={cn(
          "relative bg-card rounded-xl border border-border border-t-4 shadow-sm w-56 transition-all duration-150",
          colorClass,
          selected && "ring-2 ring-primary ring-offset-1 ring-offset-background",
          data.isRunSuccess && "ring-2 ring-green-500",
          data.isRunError && "ring-2 ring-red-500",
          data.isRunning && "ring-2 ring-blue-400 animate-pulse",
          data.isListening && "ring-2 ring-amber-400 animate-pulse",
          data.execViewStatus === "skipped" && "opacity-40"
        )}
      >
        {showTargetHandle && (
          <Handle
            type="target"
            position={Position.Left}
            data-r10n-wf-handle=""
            className="!w-3 !h-3 !bg-muted-foreground/40 !border-2 !border-background hover:!bg-primary transition-colors"
          />
        )}

        {/* Execution view status overlay + badge */}
        {data.execViewStatus && data.execViewStatus !== "skipped" && (
          <>
            <div className={cn(
              "absolute inset-0 rounded-xl pointer-events-none",
              data.execViewStatus === "success" && "bg-emerald-500/20",
              data.execViewStatus === "error" && "bg-red-500/20",
              data.execViewStatus === "partial" && "bg-amber-500/20",
              data.execViewStatus === "running" && "bg-blue-500/20",
            )} />
            <div className={cn(
              "absolute -top-2 -right-2 w-5 h-5 rounded-full border-2 border-background flex items-center justify-center text-white text-[10px] font-bold pointer-events-none",
              data.execViewStatus === "success" && "bg-emerald-500",
              data.execViewStatus === "error" && "bg-red-500",
              data.execViewStatus === "partial" && "bg-amber-500",
              data.execViewStatus === "running" && "bg-blue-500",
            )}>
              {data.execViewStatus === "success" && "✓"}
              {data.execViewStatus === "error" && "✕"}
              {data.execViewStatus === "partial" && "!"}
              {data.execViewStatus === "running" && "…"}
            </div>
          </>
        )}

        <div className="px-3 py-2.5">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-base leading-none">{data.icon ?? "📦"}</span>
            <span
              data-r10n-wf-node-type=""
              data-category={data.category ?? "action"}
              className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest truncate"
            >
              {data.nodeType?.split(".").slice(1).join(" ") ?? data.nodeType}
            </span>
            {/* Pinned indicator */}
            {data.pinnedOutput && (
              <span className="ml-auto text-[10px] text-amber-500" title="Output pinned">📌</span>
            )}
          </div>
          <p className="text-[13px] font-semibold text-foreground leading-snug truncate">
            {data.label || "Untitled"}
          </p>
          {children}
        </div>

        {/* Listening indicator */}
        {data.isListening && (
          <div className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full border-2 border-background bg-amber-400 animate-pulse flex items-center justify-center">
            <span className="text-[7px] leading-none">👂</span>
          </div>
        )}

        {/* Run status indicator */}
        {(data.isRunSuccess || data.isRunError || data.isRunning) && (
          <div className={cn(
            "absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full border-2 border-background",
            data.isRunSuccess && "bg-green-500",
            data.isRunError && "bg-red-500",
            data.isRunning && "bg-blue-400 animate-pulse"
          )} />
        )}

        {extraHandles}

        {showSourceHandle && (
          <Handle
            type="source"
            position={Position.Right}
            data-r10n-wf-handle=""
            className="!w-3 !h-3 !bg-muted-foreground/40 !border-2 !border-background hover:!bg-primary transition-colors"
          />
        )}
      </div>

      {/* Pinned output badge — rendered outside main div so it doesn't clip */}
      {data.pinnedOutput && (
        <div className="absolute left-0 right-0 translate-y-1 pt-1 pointer-events-none" style={{ top: "100%" }}>
          <div data-r10n-wf-pinned="" className="bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
            <p data-r10n-wf-pinned-label="" className="text-[9px] font-bold text-amber-600 uppercase tracking-widest mb-1 flex items-center gap-1">
              <span>📌</span> Pinned Output
            </p>
            <pre data-r10n-wf-pinned-pre="" className="text-[9px] font-mono text-amber-700 max-h-16 overflow-hidden">
              {JSON.stringify(data.pinnedOutput, null, 1).slice(0, 200)}
            </pre>
          </div>
        </div>
      )}

      {/* Context menu — portalled to body to escape ReactFlow's CSS transform stacking context */}
      {showMenu && createPortal(
        <>
          <div className="fixed inset-0 z-[999]" onClick={() => setShowMenu(false)} />
          <div
            data-r10n-wf-menu=""
            className="fixed z-[1000] bg-card border border-border rounded-lg shadow-xl py-1 min-w-[160px]"
            style={{ left: menuPos.x, top: menuPos.y }}
          >
            <button
              className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-left hover:bg-border/50 transition-colors"
              onClick={handleExecuteStep}
            >
              ▶ Execute step
            </button>
            <button
              className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-left hover:bg-border/50 transition-colors"
              onClick={handlePinToggle}
            >
              {data.pinnedOutput ? "📌 Unpin output" : "📌 Pin output"}
            </button>
            <div className="my-1 border-t border-border" />
            <button
              className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-left hover:bg-border/50 transition-colors"
              onClick={handleDuplicate}
            >
              Duplicate
            </button>
            <button
              data-r10n-wf-menu-delete=""
              className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-left hover:bg-border/50 text-red-500 transition-colors"
              onClick={handleDelete}
            >
              Delete
            </button>
          </div>
        </>,
        document.body
      )}
    </>
  );
});
