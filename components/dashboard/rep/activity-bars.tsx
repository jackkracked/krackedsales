"use client";

import { cn } from "@/lib/utils/cn";

interface DayBar {
  date: string; // e.g. "Mon"
  calls: number;
}

interface ActivityBarsProps {
  data: DayBar[];
  targetPerDay: number;
}

export function ActivityBars({ data, targetPerDay }: ActivityBarsProps) {
  const max = Math.max(...data.map((d) => d.calls), targetPerDay, 1);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p
          className="text-xs font-semibold text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Calls this week
        </p>
        <span className="text-[10px] text-muted-foreground">
          target {targetPerDay}/day
        </span>
      </div>

      {/* Bar chart */}
      <div className="flex items-end gap-1.5 h-16">
        {data.map((day, i) => {
          const isToday = i === data.length - 1;
          const pct = day.calls / max;
          const atTarget = day.calls >= targetPerDay;

          return (
            <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full flex items-end" style={{ height: 48 }}>
                <div
                  className={cn(
                    "w-full rounded-t-[3px] transition-all duration-500",
                    isToday
                      ? atTarget
                        ? "bg-emerald-500"
                        : "bg-primary"
                      : atTarget
                      ? "bg-emerald-500/50"
                      : "bg-muted-foreground/25"
                  )}
                  style={{ height: `${Math.max(pct * 48, day.calls > 0 ? 4 : 1)}px` }}
                  title={`${day.calls} calls`}
                />
              </div>
              <span
                className={cn(
                  "text-[9px] uppercase tracking-wide",
                  isToday ? "text-foreground font-semibold" : "text-muted-foreground"
                )}
              >
                {day.date}
              </span>
            </div>
          );
        })}
      </div>

      {/* Target line label */}
      <p className="text-[10px] text-muted-foreground">
        {data.reduce((s, d) => s + d.calls, 0)} total this week
      </p>
    </div>
  );
}
