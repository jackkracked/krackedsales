"use client";

import { cn } from "@/lib/utils/cn";
import { AreaChart, Area, ResponsiveContainer, Tooltip } from "recharts";
import { Pencil } from "lucide-react";
import { useState } from "react";

// ─── Value formatting ─────────────────────────────────────────────────────────

export function fmtCurrency(v: number | null | undefined): string {
  if (v == null) return "\u2014";
  const abs = Math.abs(v);
  if (abs >= 1000) return `${v < 0 ? "-" : ""}$${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}K`;
  return `${v < 0 ? "-" : ""}$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function fmtNumber(v: number | null | undefined): string {
  if (v == null) return "\u2014";
  return v.toLocaleString("en-US");
}

export function fmtPercent(v: number | null | undefined): string {
  if (v == null) return "\u2014";
  return `${v.toFixed(1)}%`;
}

export function fmtRatio(v: number | null | undefined): string {
  if (v == null) return "\u2014";
  return `${v.toFixed(2)}x`;
}

export function fmtValue(v: number | null | undefined, unit: MetricUnit): string {
  switch (unit) {
    case "currency": return fmtCurrency(v);
    case "percent": return fmtPercent(v);
    case "ratio": return fmtRatio(v);
    default: return fmtNumber(v);
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type MetricUnit = "currency" | "count" | "percent" | "ratio";

export interface MetricDef {
  key: string;
  label: string;
  unit: MetricUnit;
  manual?: boolean; // shows inline edit
  accent?: "positive" | "negative" | "neutral"; // forced color
}

interface MetricCellProps {
  def: MetricDef;
  value: number | null | undefined;
  spark?: SparkPoint[];
  sub?: string;
  onClick?: () => void;
  onManualSave?: (value: number) => void;
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

export type SparkPoint = { date: string; value: number } | number;

function MiniSparkline({ data, positive, unit }: { data: SparkPoint[]; positive?: boolean; unit?: MetricUnit }) {
  const color = positive === false
    ? "oklch(0.55 0.2 25)"   // muted red
    : "oklch(0.55 0.15 155)"; // muted green

  // Normalize to { date, value } format
  const chartData = data.map((pt, i) =>
    typeof pt === "number" ? { date: `Day ${i + 1}`, value: pt } : pt
  );

  // Unique gradient ID per instance to avoid conflicts
  const gradId = `spark-${positive ? "g" : "r"}-${Math.random().toString(36).slice(2, 6)}`;

  return (
    <div className="h-[28px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.15} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const pt = payload[0].payload as { date: string; value: number };
              const formatted = fmtValue(pt.value, unit ?? "currency");
              return (
                <div className="bg-foreground text-background text-[10px] px-2 py-1 rounded font-medium tabular-nums whitespace-nowrap">
                  {pt.date} {formatted}
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${gradId})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Metric Cell ──────────────────────────────────────────────────────────────

export function MetricCell({ def, value, spark, sub, onClick, onManualSave }: MetricCellProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");

  const formatted = fmtValue(value, def.unit);

  // Determine value color
  const isNeg = (value ?? 0) < 0;
  const accentColor = def.accent === "positive"
    ? "text-accent-green"
    : def.accent === "negative"
    ? "text-destructive"
    : isNeg
    ? "text-destructive"
    : "text-foreground";

  const sparkPositive = def.accent === "negative" ? false : def.accent === "positive" ? true : !isNeg;

  function handleSave() {
    setEditing(false);
    const num = parseFloat(editValue);
    if (!isNaN(num) && onManualSave) onManualSave(num);
  }

  return (
    <div
      className={cn(
        "group relative py-3.5 px-4 min-w-0",
        onClick && "cursor-pointer hover:bg-muted/30 transition-colors duration-100",
      )}
      onClick={editing ? undefined : onClick}
    >
      {/* Label row */}
      <div className="flex items-center gap-1.5 mb-1">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider leading-none truncate">
          {def.label}
        </p>
        {def.manual && !editing && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEditValue(String(value ?? 0));
              setEditing(true);
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
          >
            <Pencil className="w-2.5 h-2.5 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Value */}
      {editing ? (
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <input
            type="number"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleSave}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            autoFocus
            className="w-20 text-lg font-bold bg-transparent border-b border-primary/50 text-foreground outline-none tabular-nums"
            style={{ fontFamily: "var(--font-heading)" }}
          />
        </div>
      ) : (
        <p
          className={cn("text-lg font-bold leading-none tabular-nums", accentColor)}
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {formatted}
        </p>
      )}

      {/* Sub-text */}
      {sub && (
        <p className="text-[10px] text-muted-foreground mt-1 leading-tight truncate">{sub}</p>
      )}

      {/* Sparkline */}
      {spark && spark.length > 1 && (
        <div className="mt-2">
          <MiniSparkline data={spark} positive={sparkPositive} unit={def.unit} />
        </div>
      )}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

export function MetricCellSkeleton() {
  return (
    <div className="py-3.5 px-4 animate-pulse">
      <div className="h-2.5 w-16 bg-muted rounded mb-2" />
      <div className="h-5 w-20 bg-muted rounded mb-1" />
      <div className="h-2 w-12 bg-muted/60 rounded" />
    </div>
  );
}
