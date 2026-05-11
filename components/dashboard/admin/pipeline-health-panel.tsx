"use client";

import { useQuery } from "@tanstack/react-query";

interface Stage {
  id: string;
  name: string;
  count: number;
}

interface PipelineData {
  stages: Stage[];
  total: number;
}

async function fetchPipelineHealth(): Promise<PipelineData> {
  // Get available pipelines first, then fetch opps for the first one
  const pipelinesRes = await fetch("/api/ghl/pipelines").then((r) => r.json());
  const pipelines: Array<{ id: string; name: string; stages?: Array<{ id: string; name: string }> }> =
    pipelinesRes?.pipelines ?? [];

  if (pipelines.length === 0) return { stages: [], total: 0 };

  const pipeline = pipelines[0];
  const stageNames = new Map<string, string>(
    (pipeline.stages ?? []).map((s) => [s.id, s.name])
  );

  const oppsRes = await fetch(`/api/ghl/opportunities?pipelineId=${pipeline.id}&limit=100`).then((r) =>
    r.json()
  );
  const opps: Array<{ pipelineStageId: string; status: string }> = oppsRes?.opportunities ?? [];
  const open = opps.filter((o) => o.status === "open");

  const counts = new Map<string, number>();
  for (const o of open) {
    counts.set(o.pipelineStageId, (counts.get(o.pipelineStageId) ?? 0) + 1);
  }

  // Order by pipeline stage order, not by count
  const stages: Stage[] = (pipeline.stages ?? [])
    .filter((s) => counts.has(s.id))
    .map((s) => ({ id: s.id, name: stageNames.get(s.id) ?? s.name, count: counts.get(s.id)! }));

  return { stages, total: open.length };
}

export function PipelineHealthPanel() {
  const { data, isLoading } = useQuery<PipelineData>({
    queryKey: ["pipeline-health"],
    queryFn: fetchPipelineHealth,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const stages = data?.stages.slice(0, 6) ?? [];
  const maxCount = stages.reduce((m, s) => Math.max(m, s.count), 1);

  return (
    <div className="bg-card border border-border rounded-[10px] overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-baseline justify-between">
        <h3
          className="text-sm font-semibold text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Pipeline
        </h3>
        {data && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {data.total} open
          </span>
        )}
      </div>

      <div className="p-4 space-y-2.5">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1">
                <div className="h-3 bg-muted/60 rounded animate-pulse w-32" />
                <div className="h-2 bg-muted/40 rounded animate-pulse" style={{ width: `${60 - i * 10}%` }} />
              </div>
            ))
          : stages.length === 0
          ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                No open opportunities
              </p>
            )
          : stages.map((stage) => {
              const pct = Math.round((stage.count / maxCount) * 100);
              return (
                <div key={stage.id}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-foreground/80 truncate max-w-[180px]">
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
    </div>
  );
}
