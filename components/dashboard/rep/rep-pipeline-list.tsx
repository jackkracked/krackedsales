"use client";

import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils/cn";

interface PipelineOpp {
  id: string;
  name: string;
  contactName: string;
  monetaryValue: number;
  status: string;
  pipelineStageId: string;
  updatedAt: string;
}

interface RepMetrics {
  pipelineOpps: PipelineOpp[];
}

interface RepPipelineListProps {
  userId: string;
  ghlUserId: string | null;
  email: string;
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function RepPipelineList({ userId, ghlUserId, email }: RepPipelineListProps) {
  const params = new URLSearchParams({ userId });
  if (ghlUserId) params.set("ghlUserId", ghlUserId);
  if (email) params.set("email", email);

  const { data, isLoading } = useQuery<RepMetrics>({
    queryKey: ["rep-metrics", userId],
    queryFn: () =>
      fetch(`/api/kpi/rep-metrics?${params}`).then((r) => r.json()),
    staleTime: 60 * 1000,
    refetchInterval: 3 * 60 * 1000,
    enabled: !!userId,
  });

  const opps = data?.pipelineOpps ?? [];

  return (
    <div className="bg-card border border-border rounded-[10px] overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-baseline justify-between">
        <h3
          className="text-sm font-semibold text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          My Pipeline
        </h3>
        {!isLoading && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {opps.length} open
          </span>
        )}
      </div>

      <div className="divide-y divide-border max-h-64 overflow-y-auto">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="space-y-1.5 flex-1">
                  <div className="h-3 bg-muted/60 rounded animate-pulse w-32" />
                  <div className="h-2.5 bg-muted/40 rounded animate-pulse w-20" />
                </div>
                <div className="h-3 bg-muted/40 rounded animate-pulse w-12" />
              </div>
            ))
          : opps.length === 0
          ? !ghlUserId
            ? (
                <div className="px-4 py-5 text-center text-xs text-muted-foreground">
                  Link your GHL account in Settings to see your pipeline.
                </div>
              )
            : (
                <div className="px-4 py-5 text-center text-xs text-muted-foreground">
                  No open opportunities.
                </div>
              )
          : opps.map((opp) => (
              <div
                key={opp.id}
                className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-muted/30 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate leading-tight">
                    {opp.name || opp.contactName || "Unnamed"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatDistanceToNow(new Date(opp.updatedAt), { addSuffix: true })}
                  </p>
                </div>
                {opp.monetaryValue > 0 && (
                  <span className="text-sm font-semibold tabular-nums text-foreground shrink-0">
                    {formatCurrency(opp.monetaryValue)}
                  </span>
                )}
              </div>
            ))}
      </div>
    </div>
  );
}
