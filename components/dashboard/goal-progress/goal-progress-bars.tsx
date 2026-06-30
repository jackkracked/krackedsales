"use client";

import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils/cn";

interface GoalBar {
  label: string;
  current: number;
  target: number;
  format: "number" | "currency";
}

function formatValue(value: number, fmt: "number" | "currency"): string {
  if (fmt === "currency") {
    if (value >= 1000) {
      return `$${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
    }
    return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  return value.toLocaleString("en-US");
}

function barColor(current: number, target: number): string {
  if (target <= 0) return "bg-muted";
  const pct = current / target;
  if (pct >= 1) return "bg-emerald-500";
  if (pct >= 0.6) return "bg-amber-400";
  return "bg-rose-400";
}

function goalState(current: number, target: number): "none" | "ahead" | "mid" | "behind" {
  if (target <= 0) return "none";
  const pct = current / target;
  if (pct >= 1) return "ahead";
  if (pct >= 0.6) return "mid";
  return "behind";
}

function ProgressBar({ goal }: { goal: GoalBar }) {
  const pct = goal.target > 0 ? Math.min((goal.current / goal.target) * 100, 100) : 0;
  const noTarget = goal.target <= 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span data-r10n-goal-label className="text-[11px] font-medium text-muted-foreground">
          {goal.label}
        </span>
        {noTarget ? (
          <span className="text-[11px] text-muted-foreground/60">No target set</span>
        ) : (
          <span className="text-[11px] font-semibold tabular-nums text-foreground">
            {formatValue(goal.current, goal.format)}
            <span className="text-muted-foreground font-normal">
              {" / "}
              {formatValue(goal.target, goal.format)}
            </span>
          </span>
        )}
      </div>
      {!noTarget && (
        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
          <div
            data-r10n-goal-bar
            data-state={goalState(goal.current, goal.target)}
            className={cn(
              "h-full rounded-full transition-all duration-500",
              barColor(goal.current, goal.target)
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function GoalProgressBars() {
  const { data, isPending } = useQuery<{ goals: GoalBar[] }>({
    queryKey: ["goal-progress"],
    queryFn: () => fetch("/api/dashboard/goal-progress").then((r) => r.json()),
    staleTime: 60 * 1000,
    refetchInterval: 3 * 60 * 1000,
  });

  const goals = data?.goals ?? [];
  const isLoading = isPending && !data;

  // Don't render an empty card shell — return null until we have data
  if (!isLoading && goals.length === 0) return null;

  return (
    <div data-r10n-card className="bg-card border border-border rounded-[10px] overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border">
        <h3
          data-r10n-section-title
          className="text-sm font-semibold text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Goal Progress
        </h3>
      </div>

      <div className="px-5 py-4 grid grid-cols-2 gap-x-8 gap-y-5">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-2">
                <div className="h-3 bg-muted/60 rounded animate-pulse w-24" />
                <div className="h-1.5 bg-muted/60 rounded-full animate-pulse w-full" />
              </div>
            ))
          : goals.map((goal) => (
              <ProgressBar key={goal.label} goal={goal} />
            ))}
      </div>
    </div>
  );
}
