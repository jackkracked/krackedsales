"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import type { KpiDef } from "@/lib/dashboard-kpis";
import type { KpiMetricResult } from "@/app/api/dashboard/kpis/route";

interface KpiCardProps {
  def: KpiDef;
  data: KpiMetricResult | undefined;
  isLoading: boolean;
  compareLabel?: string;
  healthStatus?: "healthy" | "stale" | "error" | "override";
  /** Open the cross-reference drawer for this metric. */
  onClick?: () => void;
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

function getDelta(value: number, prev: number): { pct: number; up: boolean; flat: boolean } {
  if (prev === 0) return { pct: 0, up: false, flat: true };
  const pct = Math.round(((value - prev) / prev) * 100);
  if (Math.abs(pct) < 1) return { pct: 0, up: false, flat: true };
  return { pct, up: pct > 0, flat: false };
}

function DeltaBadge({
  value,
  prev,
  unit,
  compareLabel,
}: {
  value: number;
  prev: number;
  unit: KpiDef["unit"];
  compareLabel: string;
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const { pct, up, flat } = getDelta(value, prev);
  if (flat) return null;

  return (
    <span
      className="relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <span
        className={cn(
          "text-[11px] font-medium tabular-nums cursor-default",
          up ? "text-emerald-600" : "text-rose-500"
        )}
      >
        {up ? "↑" : "↓"} {Math.abs(pct)}%
      </span>
      {showTooltip && (
        <span className="absolute z-10 bottom-full right-0 mb-1.5 px-2.5 py-1.5 rounded-[6px] bg-foreground text-background text-[10px] font-medium whitespace-nowrap shadow-lg">
          {formatValue(value, unit)} vs {formatValue(prev, unit)} {compareLabel}
        </span>
      )}
    </span>
  );
}

function Sparkline({ series, up, flat }: { series: number[]; up: boolean; flat: boolean }) {
  if (series.length < 2) return <div className="h-[32px]" />;
  // Don't render a flat line of all zeros — no information
  if (series.every((v) => v === 0)) return <div className="h-[32px]" />;

  const data = series.map((v, i) => ({ v, i }));
  const color = flat
    ? "oklch(0.65 0.01 250)"    // muted gray
    : up
      ? "oklch(0.65 0.18 155)"  // emerald
      : "oklch(0.60 0.18 20)";  // rose

  return (
    <div className="h-[32px] w-full -mb-1">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`spark-${color.replace(/[^a-z0-9]/g, "")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.2} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#spark-${color.replace(/[^a-z0-9]/g, "")})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function KpiCard({ def, data, isLoading, compareLabel = "last period", healthStatus, onClick }: KpiCardProps) {
  if (isLoading) {
    return (
      <div className="flex-1 min-w-[240px] bg-card border border-border rounded-[12px] p-5 animate-pulse">
        <div className="h-3 w-24 bg-muted/60 rounded mb-4" />
        <div className="h-9 w-32 bg-muted/60 rounded mb-3" />
        <div className="h-[32px] w-full bg-muted/40 rounded" />
      </div>
    );
  }

  const value = data?.value ?? 0;
  const prev = data?.prev ?? 0;
  const series = data?.series ?? [];
  const target = data?.target;
  const asOfLabel = data?.asOfLabel;
  const showProgress = def.hasTarget && target !== undefined && target > 0;
  const progress = showProgress ? Math.min((value / target) * 100, 100) : 0;
  const { up, flat } = getDelta(value, prev);

  const progressColor =
    progress >= 100 ? "bg-emerald-500" :
    progress >= 60  ? "bg-amber-400" :
    "bg-rose-400";

  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      className={cn(
        "relative flex-1 min-w-[240px] bg-card border border-border rounded-[12px] p-5 flex flex-col justify-between gap-2 min-h-[140px]",
        onClick && "cursor-pointer transition-colors hover:border-primary/40 hover:bg-muted/20",
      )}
    >
      {healthStatus && healthStatus !== "healthy" && (
        <span
          className={cn(
            "absolute top-2.5 right-2.5 w-2 h-2 rounded-full",
            healthStatus === "error"
              ? "bg-red-500"
              : healthStatus === "stale"
                ? "bg-amber-400"
                : healthStatus === "override"
                  ? "bg-blue-500"
                  : "bg-emerald-500"
          )}
          title={
            healthStatus === "error"
              ? "Problem with this metric"
              : healthStatus === "stale"
                ? "Not checked recently"
                : "Manual value"
          }
        />
      )}
      {/* Label row */}
      <div className="flex items-start justify-between gap-2">
        <p
          className="text-[11.5px] font-medium text-muted-foreground leading-snug"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {def.label}
          {asOfLabel && (
            <span className="ml-1.5 text-[10px] text-muted-foreground/50 font-normal">
              · {asOfLabel}
            </span>
          )}
        </p>
        <DeltaBadge value={value} prev={prev} unit={def.unit} compareLabel={compareLabel} />
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

      {/* Sparkline or progress bar */}
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
      ) : series.length > 1 ? (
        <Sparkline series={series} up={up} flat={flat} />
      ) : (
        <div className="h-[32px]" />
      )}
    </div>
  );
}
