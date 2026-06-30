"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  PanOnScrollMode,
  ReactFlowProvider,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { format, formatDistanceToNow } from "date-fns";
import { CheckCircle2, XCircle, AlertCircle, Loader2, Clock, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useUserTimezone } from "@/providers/timezone-provider";
import { toZonedDate } from "@/lib/utils/timezone";
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

interface RunRow {
  id: string;
  triggerEvent: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
}

interface LogRow {
  id: string;
  nodeId: string;
  nodeType: string;
  nodeName: string | null;
  status: string;
  inputData: Record<string, unknown> | null;
  outputData: Record<string, unknown> | null;
  error: string | null;
  durationMs: number | null;
}

interface RunDetail extends RunRow {
  logs: LogRow[];
}

interface ExecutionsViewProps {
  workflowId: string;
  nodes: Node[];
  edges: Edge[];
}

function runDuration(run: RunRow) {
  if (!run.completedAt) return run.status === "running" ? "running…" : "—";
  const ms = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function StatusIcon({ status, className }: { status: string; className?: string }) {
  const base = cn("shrink-0", className);
  if (status === "success") return <CheckCircle2 className={cn(base, "text-emerald-500")} />;
  if (status === "error")   return <XCircle className={cn(base, "text-red-500")} />;
  if (status === "partial") return <AlertCircle className={cn(base, "text-amber-500")} />;
  if (status === "running") return <Loader2 className={cn(base, "text-blue-500 animate-spin")} />;
  return <Clock className={cn(base, "text-muted-foreground")} />;
}

export function ExecutionsView({ workflowId, nodes, edges }: ExecutionsViewProps) {
  const tz = useUserTimezone();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const { data: runs = [], isLoading } = useQuery<RunRow[]>({
    queryKey: ["exec-runs", workflowId],
    queryFn: async () => {
      const res = await fetch(`/api/workflows/${workflowId}/runs`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 5000,
  });

  // Auto-select most recent run
  const effectiveRunId = selectedRunId ?? runs[0]?.id ?? null;

  const { data: runDetail } = useQuery<RunDetail>({
    queryKey: ["exec-run-detail", effectiveRunId],
    queryFn: async () => {
      const res = await fetch(`/api/workflows/${workflowId}/runs/${effectiveRunId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!effectiveRunId,
    refetchInterval: (q) => q.state.data?.status === "running" ? 2000 : false,
  });

  // Map nodeId → log for overlay injection
  const logMap = useMemo<Record<string, LogRow>>(() => {
    if (!runDetail?.logs) return {};
    return Object.fromEntries(runDetail.logs.map((l) => [l.nodeId, l]));
  }, [runDetail]);

  // Inject execViewStatus into node data for the read-only canvas
  const overlaidNodes = useMemo<Node[]>(() => {
    if (!runDetail) return nodes;
    return nodes.map((node) => {
      const log = logMap[node.id];
      return {
        ...node,
        selected: node.id === selectedNodeId,
        data: {
          ...node.data,
          execViewStatus: (log?.status as LogRow["status"]) ?? "skipped",
        },
      };
    });
  }, [nodes, logMap, runDetail, selectedNodeId]);

  const selectedLog = selectedNodeId ? logMap[selectedNodeId] : null;
  const selectedNode = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null;

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId((prev) => (prev === node.id ? null : node.id));
  }, []);

  return (
    <div data-r10n-wf-exec="" className="flex-1 flex min-h-0">
      {/* ── Run list ──────────────────────────────────────────────── */}
      <div data-r10n-wf-runlist="" className="w-60 h-full flex flex-col border-r border-border bg-card shrink-0">
        <div className="px-3 py-2.5 border-b border-border">
          <p data-r10n-wf-runlist-title="" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Executions
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-16">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
            </div>
          ) : runs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 px-4 text-center">
              <Clock className="w-6 h-6 text-muted-foreground/20 mb-2" />
              <p className="text-xs text-muted-foreground">No executions yet</p>
            </div>
          ) : (
            runs.map((run) => {
              const isActive = run.id === effectiveRunId;
              return (
                <button
                  key={run.id}
                  onClick={() => { setSelectedRunId(run.id); setSelectedNodeId(null); }}
                  data-r10n-wf-runrow=""
                  data-active={isActive ? "true" : undefined}
                  className={cn(
                    "flex items-start gap-2.5 w-full px-3 py-2.5 text-left border-b border-border/50 transition-colors",
                    isActive ? "bg-primary/10" : "hover:bg-border/30"
                  )}
                >
                  <StatusIcon status={run.status} className="w-3.5 h-3.5 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-foreground">
                      {format(toZonedDate(new Date(run.startedAt), tz), "MMM d, HH:mm:ss")}
                    </p>
                    <p data-r10n-wf-runstatus="" data-status={run.status} className={cn(
                      "text-[10px] mt-0.5",
                      run.status === "success" && "text-emerald-500",
                      run.status === "error" && "text-red-500",
                      run.status === "partial" && "text-amber-500",
                      run.status === "running" && "text-blue-500",
                      run.status !== "success" && run.status !== "error" && run.status !== "partial" && run.status !== "running" && "text-muted-foreground"
                    )}>
                      {run.status === "success" ? "Succeeded" : run.status === "error" ? "Error" : run.status === "partial" ? "Partial" : run.status}
                      {" in "}{runDuration(run)}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Execution canvas ──────────────────────────────────────── */}
      <div data-r10n-wf-canvas="" className="flex-1 relative min-w-0">
        {!effectiveRunId ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">No executions yet</p>
          </div>
        ) : (
          <ReactFlowProvider>
            <ReactFlow
              nodes={overlaidNodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={true}
              onNodeClick={onNodeClick}
              onPaneClick={() => setSelectedNodeId(null)}
              panOnScroll
              panOnScrollMode={PanOnScrollMode.Free}
              zoomOnPinch
              zoomOnScroll={false}
              panOnDrag
              fitView
              fitViewOptions={{ padding: 0.1 }}
              minZoom={0.1}
              maxZoom={3}
              deleteKeyCode={null}
              className="bg-background"
            >
              <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--border)" />
              <Controls className="!bg-card !border-border [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground" />
            </ReactFlow>
          </ReactFlowProvider>
        )}

        {/* Run header overlay */}
        {runDetail && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
            <div data-r10n-wf-runheader="" className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-lg shadow-sm">
              <StatusIcon status={runDetail.status} className="w-3 h-3" />
              <span className="text-[11px] font-semibold text-foreground">
                {format(toZonedDate(new Date(runDetail.startedAt), tz), "MMM d · HH:mm:ss")}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {runDuration(runDetail)}
              </span>
              {runDetail.logs.length > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  · {runDetail.logs.length} nodes
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Node detail panel ─────────────────────────────────────── */}
      {selectedLog && selectedNode && (
        <NodeDetailPanel
          log={selectedLog}
          nodeName={String((selectedNode.data as Record<string, unknown>)?.label ?? selectedNode.type)}
          onClose={() => setSelectedNodeId(null)}
        />
      )}
    </div>
  );
}

function NodeDetailPanel({
  log,
  nodeName,
  onClose,
}: {
  log: LogRow;
  nodeName: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"output" | "input">("output");

  return (
    <div data-r10n-wf-detail="" className="w-80 h-full flex flex-col border-l border-border bg-card shrink-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <StatusIcon status={log.status} className="w-4 h-4" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{nodeName}</p>
          <p data-r10n-wf-runstatus="" data-status={log.status} className={cn(
            "text-[10px] font-medium mt-0.5",
            log.status === "success" && "text-emerald-500",
            log.status === "error" && "text-red-500",
            log.status === "partial" && "text-amber-500",
            log.status === "running" && "text-blue-500",
          )}>
            {log.status.charAt(0).toUpperCase() + log.status.slice(1)}
            {log.durationMs != null && ` · ${log.durationMs}ms`}
          </p>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-border/50 transition-colors">
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Input / Output tabs */}
      <div className="flex border-b border-border">
        {(["output", "input"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            data-r10n-wf-tab=""
            data-active={tab === t ? "true" : undefined}
            className={cn(
              "flex-1 py-2 text-[11px] font-semibold transition-colors",
              tab === t
                ? "text-foreground border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Error banner */}
      {log.error && (
        <div data-r10n-wf-error="" className="mx-3 mt-3 p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p data-r10n-wf-error-label="" className="text-[10px] font-bold uppercase tracking-widest text-red-500 mb-1">Error</p>
          <p data-r10n-wf-error-text="" className="text-[11px] text-red-400 font-mono break-all">{log.error}</p>
        </div>
      )}

      {/* JSON data */}
      <div className="flex-1 overflow-y-auto p-3">
        {tab === "output" && (
          log.outputData ? (
            <pre data-r10n-wf-json="" className="text-[10px] bg-background border border-border rounded-lg p-3 font-mono text-foreground/80 overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(log.outputData, null, 2)}
            </pre>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-8">No output data</p>
          )
        )}
        {tab === "input" && (
          log.inputData ? (
            <pre data-r10n-wf-json="" className="text-[10px] bg-background border border-border rounded-lg p-3 font-mono text-foreground/80 overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(log.inputData, null, 2)}
            </pre>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-8">No input data</p>
          )
        )}
      </div>
    </div>
  );
}
