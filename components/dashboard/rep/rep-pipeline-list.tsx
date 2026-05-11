"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils/cn";
import { OpportunityModal } from "@/components/pipeline/opportunity-modal";
import type { GHLOpportunity, GHLPipeline } from "@/lib/ghl/types";

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

export function RepPipelineList({ userId, ghlUserId }: RepPipelineListProps) {
  const [filter, setFilter] = useState<"all" | "mine">("all");
  const [selectedOpp, setSelectedOpp] = useState<GHLOpportunity | null>(null);

  // Pipelines — shared query key with PipelineHealthPanel so React Query deduplicates
  const { data: pipelinesData } = useQuery<{ pipelines: GHLPipeline[] }>({
    queryKey: ["ghl-pipelines"],
    queryFn: () => fetch("/api/ghl/pipelines").then((r) => r.json()),
    staleTime: 10 * 60 * 1000,
  });

  const pipeline = pipelinesData?.pipelines?.[0] ?? null;
  const stageMap = new Map<string, string>(
    (pipeline?.stages ?? []).map((s) => [s.id, s.name])
  );

  // All opportunities for the first pipeline
  const { data: oppsData, isLoading } = useQuery<{ opportunities: GHLOpportunity[] }>({
    queryKey: ["pipeline-opps-all", pipeline?.id],
    queryFn: () =>
      fetch(`/api/ghl/opportunities?pipelineId=${pipeline!.id}&limit=100`).then((r) =>
        r.json()
      ),
    enabled: !!pipeline?.id,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const allOpen = (oppsData?.opportunities ?? []).filter((o) => o.status === "open");
  const displayed =
    filter === "mine" && ghlUserId
      ? allOpen.filter((o) => o.assignedTo === ghlUserId)
      : allOpen;

  const selectedStageName = selectedOpp
    ? (stageMap.get(selectedOpp.pipelineStageId) ?? selectedOpp.pipelineStageId_name ?? "Unknown Stage")
    : "";

  return (
    <>
      <div className="bg-card border border-border rounded-[10px] overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
          <h3
            className="text-sm font-semibold text-foreground"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Pipeline
          </h3>
          <div className="flex items-center gap-2">
            {!isLoading && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {displayed.length} open
              </span>
            )}
            {/* All / Mine toggle — only show if rep has a GHL ID */}
            {ghlUserId && (
              <div className="flex rounded-[5px] border border-border overflow-hidden text-[11px] font-medium">
                {(["all", "mine"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={cn(
                      "px-2.5 py-1 transition-colors",
                      filter === f
                        ? "bg-primary text-white"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                    )}
                  >
                    {f === "all" ? "All" : "Mine"}
                  </button>
                ))}
              </div>
            )}
          </div>
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
            : displayed.length === 0
            ? (
                <div className="px-4 py-5 text-center text-xs text-muted-foreground">
                  {filter === "mine" ? "No open opportunities assigned to you." : "No open opportunities."}
                </div>
              )
            : displayed.map((opp) => (
                <button
                  key={opp.id}
                  onClick={() => setSelectedOpp(opp)}
                  className="px-4 py-3 flex items-center justify-between gap-3 w-full text-left hover:bg-muted/30 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate leading-tight">
                      {opp.contact?.name || opp.name || "Unnamed"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(opp.updatedAt), { addSuffix: true })}
                    </p>
                  </div>
                  {(opp.monetaryValue ?? 0) > 0 && (
                    <span className="text-sm font-semibold tabular-nums text-foreground shrink-0">
                      {formatCurrency(opp.monetaryValue ?? 0)}
                    </span>
                  )}
                </button>
              ))}
        </div>
      </div>

      {selectedOpp && (
        <OpportunityModal
          opportunity={selectedOpp}
          stageName={selectedStageName}
          onClose={() => setSelectedOpp(null)}
        />
      )}
    </>
  );
}
