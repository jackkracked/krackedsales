"use client";

import { cn } from "@/lib/utils/cn";
import type { KpiDef } from "@/lib/dashboard-kpis";
import type { KpiMetricResult } from "@/app/api/dashboard/kpis/route";

interface KpiCardProps {
  def: KpiDef;
  data: KpiMetricResult | undefined;
  isLoading: boolean;
}

function formatValue(value: number, unit: KpiDef["unit"]): string {
  if (unit === "currency") {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
    return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  if (unit === "ratio") return `${value.toFixed(1)}x`;
  if (unit === "percent") return `${value.toFixed(1)}%`;
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function DeltaBadge({ value, prev }: { value: number; prev: number }) {
  if (prev === 0) return null;
  const pct = Math.round(((value - prev) / prev) * 100);
  if (Math.abs(pct) < 1) return null;
  const up = pct > 0;
  return (
    <span
      className={cn(
        "text-[11px] font-medium tabular-nums",
        up ? "text-emerald-600" : "text-rose-500"
      )}
    >
      {up ? "↑" : "↓"} {Math.abs(pct)}%
    </span>
  );
}

export function KpiCard({ def, data, isLoading }: KpiCardProps) {
  if (isLoading) {
    return (
      <div className="flex-1 min-w-0 bg-card border border-border rounded-[12px] p-5 animate-pulse">
        <div className="h-3 w-24 bg-muted/60 rounded mb-4" />
        <div className="h-9 w-32 bg-muted/60 rounded mb-3" />
        <div className="h-1.5 w-full bg-muted/40 rounded-full" />
      </div>
    );
  }

  const value = data?.value ?? 0;
  const prev = data?.prev ?? 0;
  const target = data?.target;
  const periodNote = data?.periodNote;
  const showProgress = def.hasTarget && target !== undefined && target > 0;
  const progress = showProgress ? Math.min((value / target) * 100, 100) : 0;

  const progressColor =
    progress >= 100 ? "bg-emerald-500" :
    progress >= 60  ? "bg-amber-400" :
    "bg-rose-400";

  return (
    <div className="flex-1 min-w-0 bg-card border border-border rounded-[12px] p-5 flex flex-col justify-between gap-3 min-h-[140px]">
      {/* Label row */}
      <div className="flex items-start justify-between gap-2">
        <p
          className="text-[11.5px] font-medium text-muted-foreground leading-snug"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {def.label}
          {periodNote && (
            <span className="ml-1.5 text-[10px] text-muted-foreground/50 font-normal">
              ({periodNote})
            </span>
          )}
        </p>
        <DeltaBadge value={value} prev={prev} />
      </div>

      {/* Value */}
      <div className="flex items-end gap-2">
        <p
          className="text-[2rem] font-bold text-foreground leading-none tabular-nums"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {formatValue(value, def.unit)}
        </p>
        {showProgress && (
          <p className="text-[13px] text-muted-foreground/70 mb-0.5 leading-none tabular-nums">
            / {formatValue(target!, def.unit)}
          </p>
        )}
      </div>

      {/* Progress bar (only for targeted metrics) */}
      {showProgress ? (
        <div className="space-y-1">
          <div className="h-[3px] w-full bg-muted/40 rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all duration-500", progressColor)}
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground/50 tabular-nums">
            {Math.round(progress)}% of target
          </p>
        </div>
      ) : (
        // Spacer so all cards have the same height
        <div className="h-[22px]" />
      )}
    </div>
  );
}
