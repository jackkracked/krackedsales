"use client";

import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, XCircle, Clock, Loader2, ChevronDown } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils/cn";

interface LogRow {
  id: string;
  nodeId: string;
  nodeType: string;
  nodeName: string | null;
  status: string;
  inputData: unknown;
  outputData: unknown;
  error: string | null;
  durationMs: number | null;
  executedAt: string;
}

interface RunDetail {
  id: string;
  triggerEvent: string;
  triggerData: unknown;
  status: string;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  logs: LogRow[];
}

export default function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string; runId: string }>;
}) {
  const { id, runId } = use(params);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());

  const { data: run, isLoading } = useQuery<RunDetail>({
    queryKey: ["workflow-run", runId],
    queryFn: async () => {
      const res = await fetch(`/api/workflows/${id}/runs/${runId}`);
      if (!res.ok) throw new Error("Failed to load run");
      return res.json();
    },
    refetchInterval: (q) => (q.state.data?.status === "running" ? 2000 : false),
  });

  if (isLoading || !run) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  function toggleLog(logId: string) {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      next.has(logId) ? next.delete(logId) : next.add(logId);
      return next;
    });
  }

  return (
    <div data-r10n-wf-rundetail-page="" className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link
            href={`/workflows/${id}/runs`}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-border/50 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 data-r10n-wf-page-title="" className="text-xl font-bold">Run Detail</h1>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">{run.id}</p>
          </div>
        </div>

        {/* Run summary */}
        <div data-r10n-wf-summary="" className="p-4 bg-card border border-border rounded-xl mb-6">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p data-r10n-wf-microlabel="" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Status</p>
              <span data-r10n-wf-statuspill="" data-status={run.status} className={cn(
                "inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full",
                run.status === "success" && "bg-green-500/10 text-green-600",
                run.status === "error" && "bg-red-500/10 text-red-600",
                run.status === "partial" && "bg-amber-500/10 text-amber-600",
                run.status === "running" && "bg-blue-500/10 text-blue-600",
              )}>
                {run.status}
              </span>
            </div>
            <div>
              <p data-r10n-wf-microlabel="" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Trigger</p>
              <p className="font-mono text-xs">{run.triggerEvent}</p>
            </div>
            <div>
              <p data-r10n-wf-microlabel="" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Started</p>
              <p className="text-xs">{format(new Date(run.startedAt), "MMM d · h:mm:ss a")}</p>
            </div>
          </div>
        </div>

        {/* Node logs */}
        <div>
          <p data-r10n-wf-microlabel="" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">
            Node Execution Log
          </p>
          <div className="space-y-2">
            {run.logs.map((log) => {
              const isExpanded = expandedLogs.has(log.id);
              return (
                <div key={log.id} data-r10n-wf-logcard="" className="bg-card border border-border rounded-xl overflow-hidden">
                  <button
                    onClick={() => toggleLog(log.id)}
                    className="flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-border/30 transition-colors"
                  >
                    {log.status === "success" ? (
                      <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                    ) : log.status === "error" ? (
                      <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                    ) : (
                      <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-sm font-semibold truncate">{log.nodeName ?? log.nodeType}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">{log.nodeType}</p>
                    </div>
                    <div className="text-right mr-2">
                      <p className="text-xs font-mono text-muted-foreground">
                        {log.durationMs != null ? `${log.durationMs}ms` : "—"}
                      </p>
                    </div>
                    <ChevronDown className={cn(
                      "w-3.5 h-3.5 text-muted-foreground transition-transform shrink-0",
                      isExpanded && "rotate-180"
                    )} />
                  </button>

                  {isExpanded && (
                    <div className="border-t border-border px-4 py-3 space-y-3">
                      {log.error && (
                        <div data-r10n-wf-error="" className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                          <p data-r10n-wf-error-label="" className="text-xs font-bold text-red-600 mb-1">Error</p>
                          <p data-r10n-wf-error-text="" className="text-xs font-mono text-red-600">{log.error}</p>
                        </div>
                      )}
                      {log.inputData != null && (
                        <div>
                          <p data-r10n-wf-microlabel="" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                            Input
                          </p>
                          <pre data-r10n-wf-json="" className="text-[11px] bg-muted/50 rounded-lg p-3 overflow-x-auto font-mono text-foreground/80">
                            {JSON.stringify(log.inputData, null, 2)}
                          </pre>
                        </div>
                      )}
                      {log.outputData != null && (
                        <div>
                          <p data-r10n-wf-microlabel="" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                            Output
                          </p>
                          <pre data-r10n-wf-json="" className="text-[11px] bg-muted/50 rounded-lg p-3 overflow-x-auto font-mono text-foreground/80">
                            {JSON.stringify(log.outputData, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
