"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, XCircle, Clock, Loader2, AlertCircle } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { cn } from "@/lib/utils/cn";

interface RunRow {
  id: string;
  triggerEvent: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
}

export default function WorkflowRunsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const { data: runs = [], isLoading } = useQuery<RunRow[]>({
    queryKey: ["workflow-runs", id],
    queryFn: async () => {
      const res = await fetch(`/api/workflows/${id}/runs`);
      if (!res.ok) throw new Error("Failed to load runs");
      return res.json();
    },
    refetchInterval: 5000,
  });

  function StatusIcon({ status }: { status: string }) {
    if (status === "success") return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    if (status === "error") return <XCircle className="w-4 h-4 text-red-500" />;
    if (status === "partial") return <AlertCircle className="w-4 h-4 text-amber-500" />;
    if (status === "running") return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
    return <Clock className="w-4 h-4 text-muted-foreground" />;
  }

  return (
    <div data-r10n-wf-runs-page="" className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-8">
          <Link
            href={`/workflows/${id}`}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-border/50 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <h1 data-r10n-wf-page-title="" className="text-xl font-bold">Run History</h1>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : runs.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Clock className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No runs yet. Click &quot;Run Now&quot; on the canvas to test your workflow.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => {
              const duration =
                run.completedAt
                  ? `${((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000).toFixed(1)}s`
                  : "—";

              return (
                <Link
                  key={run.id}
                  href={`/workflows/${id}/runs/${run.id}`}
                  data-r10n-wf-row=""
                  className="flex items-center gap-4 p-4 bg-card border border-border rounded-xl hover:border-primary/30 transition-colors"
                >
                  <StatusIcon status={run.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span data-r10n-wf-statuspill="" data-status={run.status} className={cn(
                        "text-xs font-bold px-2 py-0.5 rounded-full",
                        run.status === "success" && "bg-green-500/10 text-green-600",
                        run.status === "error" && "bg-red-500/10 text-red-600",
                        run.status === "partial" && "bg-amber-500/10 text-amber-600",
                        run.status === "running" && "bg-blue-500/10 text-blue-600",
                      )}>
                        {run.status}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono">
                        {run.triggerEvent}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {format(new Date(run.startedAt), "MMM d, yyyy · h:mm a")}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-mono text-muted-foreground">{duration}</p>
                    <p className="text-[10px] text-muted-foreground/60">
                      {formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
