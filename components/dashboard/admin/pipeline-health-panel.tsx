"use client";

import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils/cn";

interface Stage {
  id: string;
  name: string;
  count: number;
}

interface PipelineData {
  stages: Stage[];
  total: number;
}

// We derive pipeline health from GHL opportunities via the existing opps endpoint
async function fetchPipelineHealth(): Promise<PipelineData> {
  const res = await fetch("/api/ghl/opportunities?limit=100");
  if (!res.ok) throw new Error("Failed to fetch pipeline");
  const data = await res.json();
  const opps = (data.opportunities ?? []) as Array<{
    pipelineStageId: string;
    status: string;
    contact?: { name?: string };
  }>;

  // Only open opportunities
  const open = opps.filter((o) => o.status === "open");

  // Group by stage (we don't have stage names here — use pipelineStageId as key)
  const counts = new Map<string, number>();
  for (const o of open) {
    counts.set(o.pipelineStageId, (counts.get(o.pipelineStageId) ?? 0) + 1);
  }

  const stages: Stage[] = Array.from(counts.entries()).map(([id, count]) => ({
    id,
    name: id, // will be replaced with real stage names from GHL pipelines API below
    count,
  }));

  return { stages, total: open.length };
}

async function fetchPipelineHealthWithNames(): Promise<PipelineData> {
  const [health, pipelinesRes] = await Promise.allSettled([
    fetchPipelineHealth(),
    fetch("/api/ghl/pipelines").then((r) => r.json()),
  ]);

  if (health.status === "rejected") throw health.reason;
  const data = health.value;

  if (pipelinesRes.status === "fulfilled") {
    const pipelines = pipelinesRes.value?.pipelines ?? [];
    const stageNames = new Map<string, string>();
    for (const pipeline of pipelines) {
      for (const stage of pipeline.stages ?? []) {
        stageNames.set(stage.id, stage.name);
      }
    }
    data.stages = data.stages.map((s) => ({
      ...s,
      name: stageNames.get(s.id) ?? s.name,
    }));
  }

  // Sort by count desc
  data.stages.sort((a, b) => b.count - a.count);
  return data;
}

export function PipelineHealthPanel() {
  const { data, isLoading } = useQuery<PipelineData>({
    queryKey: ["pipeline-health"],
    queryFn: fetchPipelineHealthWithNames,
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
