"use client";

import { useState, useMemo } from "react";
import { ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { EnrichedTask } from "@/app/api/clickup/tasks/route";
import { getStageRiskDays, getStageBadge } from "@/lib/utils/demo-stage";

interface RiskAlertsProps {
  tasks: EnrichedTask[];
}

interface AtRiskTask {
  task: EnrichedTask;
  daysOver: number;
  threshold: number;
}

export function RiskAlerts({ tasks }: RiskAlertsProps) {
  const [expanded, setExpanded] = useState(false);

  const atRisk = useMemo((): AtRiskTask[] => {
    return tasks
      .filter((t) => t.bucket !== "DEMO_SENT")
      .flatMap((t) => {
        const threshold = getStageRiskDays(t.status);
        const daysOver = t.daysInStage - threshold;
        if (daysOver <= 0) return [];
        return [{ task: t, daysOver, threshold }];
      })
      .sort((a, b) => b.daysOver - a.daysOver);
  }, [tasks]);

  if (atRisk.length === 0) return null;

  const urgentCount = atRisk.filter((r) => r.daysOver >= 3).length;

  return (
    <div className={cn(
      "shrink-0 rounded-xl border overflow-hidden",
      urgentCount > 0 ? "border-destructive/30 bg-destructive/5" : "border-amber-200 bg-amber-50/60"
    )}>
      {/* Summary row — always visible */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-foreground/5 transition-colors"
      >
        <AlertTriangle className={cn(
          "w-4 h-4 shrink-0",
          urgentCount > 0 ? "text-destructive" : "text-amber-600"
        )} />
        <span className={cn(
          "text-sm font-semibold flex-1",
          urgentCount > 0 ? "text-destructive" : "text-amber-800"
        )}>
          {atRisk.length} demo{atRisk.length !== 1 ? "s" : ""} overdue
          {urgentCount > 0 && ` — ${urgentCount} urgent`}
        </span>
        <span className="text-xs text-muted-foreground mr-1">
          {expanded ? "Hide" : "Show"}
        </span>
        {expanded
          ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        }
      </button>

      {/* Expanded list */}
      {expanded && (
        <div className="border-t border-border/50 px-4 py-3 flex flex-col gap-2">
          {atRisk.map(({ task, daysOver, threshold }) => {
            const badge = getStageBadge(task.status);
            const isUrgent = daysOver >= 3;
            // Extract brand name from task (everything before ": " in the name)
            const brand = task.name.includes(": ")
              ? task.name.split(": ")[0].trim()
              : task.name;

            return (
              <div
                key={task.id}
                className="flex items-center gap-3 text-sm"
              >
                <span className={cn(
                  "w-1.5 h-1.5 rounded-full shrink-0",
                  isUrgent ? "bg-destructive" : "bg-amber-500"
                )} />
                <span className="font-medium text-foreground truncate flex-1">{brand}</span>
                <span className={cn(
                  "text-xs px-2 py-0.5 rounded-full font-medium shrink-0",
                  badge.className
                )}>
                  {badge.label}
                </span>
                <span className={cn(
                  "text-xs font-semibold shrink-0",
                  isUrgent ? "text-destructive" : "text-amber-700"
                )}>
                  Day {task.daysInStage}
                  <span className="font-normal text-muted-foreground ml-1">
                    ({daysOver}d over)
                  </span>
                </span>
                <a
                  href={task.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  ↗
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
