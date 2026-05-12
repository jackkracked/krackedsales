"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface GHLPipeline {
  id: string;
  name: string;
  stages?: Array<{ id: string; name: string }>;
}

interface Stage { id: string; name: string; count: number; }
interface PipelineData { stages: Stage[]; total: number; }

async function fetchPipelines(): Promise<GHLPipeline[]> {
  const res = await fetch("/api/ghl/pipelines").then((r) => r.json());
  return res?.pipelines ?? [];
}

async function fetchPipelineHealth(pipeline: GHLPipeline): Promise<PipelineData> {
  const stageNames = new Map<string, string>(
    (pipeline.stages ?? []).map((s) => [s.id, s.name])
  );
  const oppsRes = await fetch(
    `/api/ghl/opportunities?pipelineId=${pipeline.id}&limit=100`
  ).then((r) => r.json());
  const opps: Array<{ pipelineStageId: string; status: string }> = oppsRes?.opportunities ?? [];
  const open = opps.filter((o) => o.status === "open");
  const counts = new Map<string, number>();
  for (const o of open) counts.set(o.pipelineStageId, (counts.get(o.pipelineStageId) ?? 0) + 1);
  const stages: Stage[] = (pipeline.stages ?? [])
    .filter((s) => counts.has(s.id))
    .map((s) => ({ id: s.id, name: stageNames.get(s.id) ?? s.name, count: counts.get(s.id)! }));
  return { stages, total: open.length };
}

export function PipelineHealthPanel() {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const { data: pipelines = [] } = useQuery<GHLPipeline[]>({
    queryKey: ["ghl-pipelines-list"],
    queryFn: fetchPipelines,
    staleTime: 10 * 60 * 1000,
  });

  const selectedPipeline = pipelines[selectedIndex] ?? null;

  const { data, isLoading: dataLoading, isPlaceholderData } = useQuery<PipelineData>({
    queryKey: ["pipeline-health", selectedPipeline?.id],
    queryFn: () => fetchPipelineHealth(selectedPipeline!),
    enabled: !!selectedPipeline,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const isLoading = dataLoading && !data;
  const stages = data?.stages ?? [];
  const maxCount = stages.reduce((m, s) => Math.max(m, s.count), 1);

  return (
    <div className="bg-card border border-border rounded-[10px] overflow-hidden flex flex-col" style={{ height: 320 }}>
      {/* Header — pipeline name + open count */}
      <div className="px-4 pt-3 pb-2 border-b border-border shrink-0">
        <div className="flex items-center justify-between gap-2">
          <h3
            className="text-sm font-semibold text-foreground truncate flex-1 min-w-0"
            style={{ fontFamily: "var(--font-heading)" }}
            title={selectedPipeline?.name}
          >
            {selectedPipeline?.name ?? "Pipeline"}
          </h3>
          {data && (
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
              {data.total} open
            </span>
          )}
        </div>

        {/* Navigation row */}
        {pipelines.length > 1 && (
          <div className="flex items-center gap-2 mt-1.5">
            <button
              onClick={() => setSelectedIndex((i) => i - 1)}
              disabled={selectedIndex === 0}
              className={cn(
                "p-0.5 rounded transition-colors",
                selectedIndex > 0
                  ? "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  : "text-muted-foreground/20 cursor-default"
              )}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

            <div className="flex items-center gap-1 flex-1">
              {pipelines.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedIndex(i)}
                  className={cn(
                    "rounded-full transition-all duration-200",
                    i === selectedIndex
                      ? "bg-primary"
                      : "bg-muted-foreground/25 hover:bg-muted-foreground/40"
                  )}
                  style={{
                    width: i === selectedIndex ? 12 : 6,
                    height: 6,
                  }}
                />
              ))}
            </div>

            <button
              onClick={() => setSelectedIndex((i) => i + 1)}
              disabled={selectedIndex >= pipelines.length - 1}
              className={cn(
                "p-0.5 rounded transition-colors",
                selectedIndex < pipelines.length - 1
                  ? "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  : "text-muted-foreground/20 cursor-default"
              )}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Stages — fixed height area with fade transition */}
      <div
        className="flex-1 px-4 py-3 overflow-hidden"
        style={{
          opacity: isPlaceholderData ? 0.4 : 1,
          transition: "opacity 150ms ease",
        }}
      >
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-1">
                <div className="h-2.5 bg-muted/60 rounded animate-pulse" style={{ width: `${55 - i * 7}%` }} />
                <div className="h-1.5 bg-muted/40 rounded animate-pulse" style={{ width: `${45 - i * 5}%` }} />
              </div>
            ))}
          </div>
        ) : stages.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">No open opportunities</p>
        ) : (
          <div className="space-y-2.5">
            {stages.slice(0, 7).map((stage) => {
              const pct = Math.round((stage.count / maxCount) * 100);
              return (
                <div key={stage.id}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs text-foreground/80 truncate" style={{ maxWidth: "78%" }}>
                      {stage.name}
                    </span>
                    <span className="text-xs font-medium tabular-nums text-foreground shrink-0 ml-2">
                      {stage.count}
                    </span>
                  </div>
                  <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary/60 rounded-full transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
