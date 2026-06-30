"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, CheckCircle2, XCircle, AlertCircle, Loader2, ChevronDown, Clock } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { cn } from "@/lib/utils/cn";
import { useUserTimezone } from "@/providers/timezone-provider";
import { toZonedDate } from "@/lib/utils/timezone";

interface RunRow {
  id: string;
  triggerEvent: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
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

interface RunHistoryPanelProps {
  workflowId: string;
  onClose: () => void;
}

export function RunHistoryPanel({ workflowId, onClose }: RunHistoryPanelProps) {
  const tz = useUserTimezone();
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set());

  const { data: runs = [], isLoading } = useQuery<RunRow[]>({
    queryKey: ["workflow-runs", workflowId],
    queryFn: async () => {
      const res = await fetch(`/api/workflows/${workflowId}/runs`);
      if (!res.ok) throw new Error("Failed to load runs");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: runDetail } = useQuery<RunDetail>({
    queryKey: ["workflow-run-detail", expandedRunId],
    queryFn: async () => {
      const res = await fetch(`/api/workflows/${workflowId}/runs/${expandedRunId}`);
      if (!res.ok) throw new Error("Failed to load run");
      return res.json();
    },
    enabled: !!expandedRunId,
    refetchInterval: (q) => q.state.data?.status === "running" ? 2000 : false,
  });

  function StatusIcon({ status, size = "sm" }: { status: string; size?: "sm" | "xs" }) {
    const cls = size === "xs" ? "w-3 h-3" : "w-3.5 h-3.5";
    if (status === "success") return <CheckCircle2 className={cn(cls, "text-green-500 shrink-0")} />;
    if (status === "error")   return <XCircle className={cn(cls, "text-red-500 shrink-0")} />;
    if (status === "partial") return <AlertCircle className={cn(cls, "text-amber-500 shrink-0")} />;
    if (status === "running") return <Loader2 className={cn(cls, "text-blue-500 animate-spin shrink-0")} />;
    return <Clock className={cn(cls, "text-muted-foreground shrink-0")} />;
  }

  function duration(run: RunRow) {
    if (!run.completedAt) return run.status === "running" ? "running…" : "—";
    const ms = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  }

  function toggleLog(id: string) {
    setExpandedLogIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div data-r10n-wf-runhistory="" className="w-80 h-full flex flex-col border-l border-border bg-card shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div>
          <p data-r10n-wf-runlist-title="" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Run History
          </p>
          {runs.length > 0 && (
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">{runs.length} runs</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-border/50 transition-colors"
        >
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Run list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-24">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-center px-6">
            <Clock className="w-8 h-8 text-muted-foreground/20 mb-2" />
            <p className="text-xs text-muted-foreground">No runs yet</p>
            <p className="text-[11px] text-muted-foreground/60 mt-1">
              Click Run Now to test this workflow
            </p>
          </div>
        ) : (
          <div>
            {runs.map((run) => {
              const isExpanded = expandedRunId === run.id;
              const detail = isExpanded ? runDetail : null;

              return (
                <div key={run.id} className="border-b border-border last:border-b-0">
                  {/* Run row */}
                  <button
                    onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                    className="flex items-center gap-2.5 w-full px-4 py-3 text-left hover:bg-border/30 transition-colors"
                  >
                    <StatusIcon status={run.status} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-semibold truncate text-foreground">
                        {run.triggerEvent.replace(/\./g, " › ")}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}
                        <span className="mx-1">·</span>
                        {duration(run)}
                      </p>
                    </div>
                    <ChevronDown
                      className={cn(
                        "w-3 h-3 text-muted-foreground shrink-0 transition-transform",
                        isExpanded && "rotate-180"
                      )}
                    />
                  </button>

                  {/* Expanded node logs */}
                  {isExpanded && (
                    <div className="bg-muted/20 border-t border-border">
                      {!detail ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                        </div>
                      ) : (
                        <div>
                          {/* Run timestamp */}
                          <p className="px-4 pt-2.5 pb-1 text-[10px] text-muted-foreground/60 font-mono">
                            {format(toZonedDate(new Date(run.startedAt), tz), "MMM d · h:mm:ss a")}
                          </p>

                          {/* Node log rows */}
                          {detail.logs.map((log) => {
                            const logExpanded = expandedLogIds.has(log.id);
                            const hasDetail = log.inputData || log.outputData || log.error;

                            return (
                              <div key={log.id}>
                                <button
                                  onClick={() => hasDetail && toggleLog(log.id)}
                                  className={cn(
                                    "flex items-center gap-2 w-full px-4 py-2 text-left",
                                    hasDetail && "hover:bg-border/40 transition-colors"
                                  )}
                                >
                                  <StatusIcon status={log.status} size="xs" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[11px] font-medium truncate text-foreground">
                                      {log.nodeName ?? log.nodeType}
                                    </p>
                                    {log.error && (
                                      <p data-r10n-wf-error-text="" className="text-[10px] text-red-500 truncate mt-0.5">{log.error}</p>
                                    )}
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="text-[10px] font-mono text-muted-foreground">
                                      {log.durationMs != null ? `${log.durationMs}ms` : ""}
                                    </p>
                                  </div>
                                  {hasDetail && (
                                    <ChevronDown
                                      className={cn(
                                        "w-2.5 h-2.5 text-muted-foreground/50 shrink-0 transition-transform",
                                        logExpanded && "rotate-180"
                                      )}
                                    />
                                  )}
                                </button>

                                {/* Log detail — input/output JSON */}
                                {logExpanded && (
                                  <div className="px-4 pb-3 space-y-2">
                                    {log.error && (
                                      <div data-r10n-wf-error="" className="p-2 bg-red-500/10 rounded text-[10px] font-mono text-red-500 break-all">
                                        {log.error}
                                      </div>
                                    )}
                                    {log.outputData && (
                                      <div>
                                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
                                          Output
                                        </p>
                                        <pre className="text-[10px] bg-background border border-border rounded p-2 overflow-x-auto font-mono text-foreground/70 max-h-32">
                                          {JSON.stringify(log.outputData, null, 2)}
                                        </pre>
                                      </div>
                                    )}
                                    {log.inputData && (
                                      <div>
                                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
                                          Input
                                        </p>
                                        <pre className="text-[10px] bg-background border border-border rounded p-2 overflow-x-auto font-mono text-foreground/70 max-h-32">
                                          {JSON.stringify(log.inputData, null, 2)}
                                        </pre>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
