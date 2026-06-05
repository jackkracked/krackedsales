"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils/cn";
import type { EnrichedTask } from "@/app/api/clickup/tasks/route";
import { getStageBadge, getStageRiskDays } from "@/lib/utils/demo-stage";
import { useStageAverages } from "@/lib/hooks/use-stage-averages";
import { useDemoTargets, targetsToStageMap } from "@/lib/hooks/use-demo-targets";
import type { TimeRange } from "@/lib/utils/time-range";

interface StageHeatmapProps {
  tasks: EnrichedTask[];
  range: TimeRange;
}

const DEMO_STAGES = [
  "copy",
  "design",
  "copy revision needed",
  "design revision needed",
  "internal qa",
];

function normaliseStage(s: string): string {
  const n = s.toLowerCase().trim();
  return n === "internal qa review" ? "internal qa" : n;
}

// Heat level: how far over the threshold is the average?
function getHeatLevel(avgDays: number, threshold: number): "green" | "amber" | "red" {
  if (avgDays <= threshold * 0.6) return "green";
  if (avgDays <= threshold) return "amber";
  return "red";
}

export function StageHeatmap({ tasks, range }: StageHeatmapProps) {
  const { data: dbAverages = [] } = useStageAverages(range);
  const { data: demoTargetData } = useDemoTargets();
  const stageTargets = demoTargetData ? targetsToStageMap(demoTargetData) : undefined;

  const dbAvgMap = useMemo(() => {
    const m = new Map<string, { avgDays: number; taskCount: number }>();
    for (const row of dbAverages) {
      const key = normaliseStage(row.stageName);
      const existing = m.get(key);
      if (existing) {
        const totalTasks = existing.taskCount + row.taskCount;
        m.set(key, {
          avgDays:
            (existing.avgDays * existing.taskCount + row.avgDays * row.taskCount) /
            totalTasks,
          taskCount: totalTasks,
        });
      } else {
        m.set(key, { avgDays: row.avgDays, taskCount: row.taskCount });
      }
    }
    return m;
  }, [dbAverages]);

  const stages = useMemo(() => {
    const active = tasks.filter((t) => t.bucket !== "DEMO_SENT");

    return DEMO_STAGES.map((stage) => {
      const stageTasks = active.filter((t) => normaliseStage(t.status) === stage);
      const count = stageTasks.length;
      const threshold = getStageRiskDays(stage, stageTargets);
      const badge = getStageBadge(stage);
      const dbEntry = dbAvgMap.get(stage);

      // Always render every stage — show null avgDays when no data for this period
      let avgDays: number | null = null;
      let isHistorical = false;

      if (dbEntry && dbEntry.taskCount >= 1) {
        avgDays = dbEntry.avgDays;
        isHistorical = true;
      } else if (count > 0) {
        avgDays = stageTasks.reduce((s, t) => s + t.daysInStage, 0) / count;
        isHistorical = false;
      }
      // else: avgDays stays null — stage renders with "—"

      return {
        stage,
        label: badge.label,
        count,
        avgDays,
        threshold,
        isHistorical,
        dbCount: dbEntry?.taskCount ?? 0,
      };
    });
  }, [tasks, dbAvgMap, stageTargets]);

  return (
    <div className="shrink-0">
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
        Avg time per stage — demos sent in period
      </p>
      <div className="flex flex-wrap gap-2">
        {stages.map(({ stage, label, count, avgDays, threshold, isHistorical, dbCount }) => {
          const heat = avgDays !== null ? getHeatLevel(avgDays, threshold) : null;
          return (
            <div
              key={stage}
              title={
                avgDays === null
                  ? "No demos in this period passed through this stage yet"
                  : isHistorical
                  ? `Historical avg across ${dbCount} demos`
                  : "Estimated from current tasks"
              }
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-lg bg-card border border-border",
                heat === "green" && "border-emerald-500",
                heat === "amber" && "border-amber-400",
                heat === "red"   && "border-red-500",
                heat === null    && "border-border opacity-50",
              )}
            >
              <span className="text-xs font-medium text-foreground">{label}</span>

              <span className={cn(
                "text-sm font-bold tabular-nums",
                heat === "green" && "text-emerald-600",
                heat === "amber" && "text-amber-500",
                heat === "red"   && "text-red-500",
                heat === null    && "text-muted-foreground",
              )}>
                {avgDays !== null ? `${avgDays.toFixed(1)}d` : "—"}
              </span>

              {count > 0 && (
                <span className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                  {count}
                </span>
              )}

              {avgDays !== null && !isHistorical && (
                <span className="text-[9px] text-muted-foreground/40">~</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
