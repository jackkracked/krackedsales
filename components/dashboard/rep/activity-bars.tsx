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
    // h-full so the chart fills the stretched card; flex-col pushes bars to fill space
    <div className="flex flex-col h-full gap-3">
      <div className="flex items-center justify-between shrink-0">
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

      {/* Bar chart — flex-1 so it grows to fill available height */}
      <div className="flex gap-1.5 flex-1 min-h-0">
        {data.map((day, i) => {
          const isToday = i === data.length - 1;
          const pct = day.calls / max;
          const atTarget = day.calls >= targetPerDay;

          return (
            <div key={day.date} className="flex-1 flex flex-col items-center justify-end gap-1">
              {/* Bar — grows from bottom, height is a % of the available column space */}
              <div
                className="w-full flex flex-col justify-end"
                style={{ height: "100%", paddingBottom: 20 /* reserve space for label */ }}
              >
                <div
                  className={cn(
                    "w-full rounded-t-[3px] transition-all duration-500",
                    isToday
                      ? atTarget ? "bg-emerald-500" : "bg-primary"
                      : atTarget ? "bg-emerald-500/50" : "bg-muted-foreground/25"
                  )}
                  style={{ height: `${Math.max(pct * 100, day.calls > 0 ? 8 : 0.5)}%` }}
                  title={`${day.calls} calls`}
                />
              </div>
              <span
                className={cn(
                  "text-[9px] uppercase tracking-wide shrink-0",
                  isToday ? "text-foreground font-semibold" : "text-muted-foreground"
                )}
              >
                {day.date}
              </span>
            </div>
          );
        })}
      </div>

      {/* Total — pinned at bottom */}
      <p className="text-[10px] text-muted-foreground shrink-0">
        {data.reduce((s, d) => s + d.calls, 0)} total this week
      </p>
    </div>
  );
}
