"use client";

import { Handle, Position, NodeToolbar, useReactFlow } from "@xyflow/react";
import { useState, useEffect, useRef } from "react";
import { MessageSquare, X, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useFlowEditor } from "@/stores/flow-editor";

interface MessageNodeData {
  label: string;
  body?: string;
  templateId?: string;
  immediate?: boolean;
  sends?: number;
  responseRate?: number;
}

function responseColor(rate?: number) {
  if (rate === undefined || rate === null) return "var(--r10n-flow-rate-none, #94a3b8)";
  if (rate >= 0.4) return "var(--r10n-flow-rate-high, #16a34a)";
  if (rate >= 0.2) return "var(--r10n-flow-rate-mid, #d97706)";
  return "var(--r10n-flow-rate-low, #dc2626)";
}

export function MessageNode({
  id,
  data,
  selected,
}: {
  id: string;
  data: MessageNodeData;
  selected: boolean;
}) {
  const { activeNodeId, open, close } = useFlowEditor();
  const editing = activeNodeId === id;
  const { updateNodeData } = useReactFlow();

  const [body, setBody] = useState(data.body ?? "");
  const [saved, setSaved] = useState(false);

  // Keep a ref so the auto-save effect always reads the latest body value
  const bodyRef = useRef(body);
  useEffect(() => { bodyRef.current = body; }, [body]);

  // Auto-save when the panel closes (editing transitions true → false).
  // Also updates the node's data immediately so the card preview doesn't revert.
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editing) {
      const newBody = bodyRef.current;
      // Patch the node's data in ReactFlow state so the card shows the new text
      // instantly — without waiting for a query refetch.
      updateNodeData(id, { body: newBody });
      if (data.templateId) {
        fetch(`/api/templates/${data.templateId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: newBody }),
        })
          .then(() => { setSaved(true); setTimeout(() => setSaved(false), 1500); })
          .catch(() => {});
      }
    }
    wasEditing.current = editing;
  }, [editing, id, data.templateId, updateNodeData]);

  const barColor = responseColor(data.responseRate);
  const hasSends = (data.sends ?? 0) > 0;

  function handleToggle() {
    editing ? close() : open(id);
  }

  return (
    <>
      {/* Floating edit panel */}
      <NodeToolbar isVisible={editing} position={Position.Right} offset={14}>
        <div
          className="bg-card border border-border rounded-xl shadow-2xl p-4 space-y-3"
          style={{ width: 320 }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground uppercase tracking-wide">{data.label}</span>
            <button onClick={close} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={7}
            // Stop wheel/scroll events reaching ReactFlow's pan handler
            onWheelCapture={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="w-full text-xs px-3 py-2 border border-border rounded-lg bg-background text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 leading-relaxed"
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">{body.length} chars</span>
            {saved && (
              <span className="flex items-center gap-1 text-[11px] text-green-600 font-medium">
                <CheckCircle2 className="w-3 h-3" /> Saved
              </span>
            )}
          </div>
        </div>
      </NodeToolbar>

      {/* Node card */}
      <div
        onClick={handleToggle}
        data-r10n-flow-node="message"
        data-selected={selected ? "true" : undefined}
        className={cn(
          "bg-card cursor-pointer transition-all duration-150 overflow-hidden rounded-xl",
          selected ? "shadow-lg ring-2 ring-primary" : "shadow-md hover:shadow-lg hover:ring-1 hover:ring-primary/30",
        )}
        style={{
          width: 290,
          border: `1px solid var(--border)`,
          borderLeftWidth: 4,
          borderLeftColor: barColor,
        }}
      >
        <Handle
          type="target"
          position={Position.Top}
          id="in"
          style={{ background: "var(--primary)", border: "2px solid var(--card)", width: 10, height: 10 }}
        />

        <div className="p-4">
          {/* Header */}
          <div className="flex items-center gap-2 mb-2.5">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
              style={{ background: "var(--primary)" }}
            >
              <MessageSquare className="w-3 h-3 text-white" />
            </div>
            <span data-r10n-flow-node-eyebrow className="text-xs font-bold text-muted-foreground uppercase tracking-wide truncate flex-1">
              {data.label}
            </span>
            {data.immediate && (
              <span data-r10n-flow-immediate className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full shrink-0">
                IMMEDIATE
              </span>
            )}
          </div>

          {/* Message preview — uses local state while editing for instant feedback */}
          <p className="text-[13px] text-foreground leading-relaxed line-clamp-3">
            {(editing ? body : data.body)
              ? (editing ? body : data.body)
              : <span className="text-muted-foreground/60 italic text-xs">No message — click to edit</span>
            }
          </p>

          {/* Stats */}
          {hasSends && (
            <div className="flex items-center gap-4 mt-3 pt-2.5 border-t border-border">
              <span className="text-[11px] text-muted-foreground">
                <span className="font-semibold text-foreground">{data.sends}</span> sent
              </span>
              {data.responseRate !== undefined && (
                <span className="text-[11px]" style={{ color: barColor }}>
                  <span className="font-semibold">{Math.round(data.responseRate * 100)}%</span> replied
                </span>
              )}
            </div>
          )}
        </div>

        <Handle
          type="source"
          position={Position.Bottom}
          id="out"
          style={{ background: "var(--primary)", border: "2px solid var(--card)", width: 10, height: 10 }}
        />
      </div>
    </>
  );
}
