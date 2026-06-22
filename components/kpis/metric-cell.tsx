"use client";

import { cn } from "@/lib/utils/cn";
import { AreaChart, Area, ResponsiveContainer, Tooltip } from "recharts";
import { Pencil, Settings2, SlidersHorizontal, TrendingUp, TrendingDown } from "lucide-react";
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

/**
 * An admin-set goal for a metric.
 *   direction "higher" → ABOVE target is GOOD (revenue, leads, MRR).
 *   direction "lower"  → BELOW target is GOOD (costs, churn, CPL, ad spend).
 */
export interface MetricTarget {
  target: number;
  direction: "higher" | "lower";
}

interface MetricCellProps {
  def: MetricDef;
  value: number | null | undefined;
  spark?: SparkPoint[];
  sub?: string;
  onClick?: () => void;
  onManualSave?: (value: number) => void;
  /** "stale" = value came from cache because the source couldn't refresh. */
  status?: "ok" | "stale";
  /**
   * KPI-wiring affordances (admin only). When `configurable` is true the cell can
   * be wired via the configurator:
   *   - CONFIGURED   (configured=true)  → value renders normally; a gear appears on
   *                                       hover top-right → onConfigure(); value-click
   *                                       still drills down via onClick.
   *   - UNCONFIGURED (configured=false) → dashed-border ghost cell, muted "—", and a
   *                                       gold "Configure" pill. The whole cell opens
   *                                       the configurator.
   * When `configurable` is false/omitted the cell behaves exactly as before.
   */
  configurable?: boolean;
  configured?: boolean;
  onConfigure?: () => void;
  /**
   * An admin-set goal. When present and the cell has a numeric value, a small
   * direction-aware over/under badge renders under the value.
   */
  target?: MetricTarget;
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

export function MetricCell({
  def,
  value,
  spark,
  sub,
  onClick,
  onManualSave,
  status,
  configurable,
  configured,
  onConfigure,
  target,
}: MetricCellProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");

  // ── UNCONFIGURED ghost state ──────────────────────────────────────────────────
  // Only show the ghost when there is genuinely NO value. If the metric still has a
  // (built-in/legacy) number, show that accurate number — with a gear to wire it —
  // so no KPI ever reads "—" when a real figure is available.
  if (configurable && configured === false && (value === null || value === undefined)) {
    return (
      <button
        type="button"
        onClick={onConfigure}
        className="group/cell relative w-full text-left py-3.5 px-4 min-w-0 cursor-pointer transition-colors hover:bg-primary/[0.03]"
      >
        {/* Dashed inner frame to read as a ghost cell without breaking the grid lines */}
        <span className="pointer-events-none absolute inset-1.5 rounded-[6px] border border-dashed border-border/80 group-hover/cell:border-gold/50 transition-colors" />
        <div className="relative">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider leading-none truncate mb-1.5">
            {def.label}
          </p>
          <div className="flex items-center gap-2">
            <span
              className="text-lg font-bold leading-none text-muted-foreground/40"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {"—"}
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gold/12 text-[10px] font-semibold text-gold border border-gold/25 group-hover/cell:bg-gold/20 transition-colors">
              <SlidersHorizontal className="w-2.5 h-2.5" />
              Configure
            </span>
          </div>
        </div>
      </button>
    );
  }

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
      {/* Configure gear — always visible for admins (quiet at rest, lifts on hover)
          so the configurator (and its Target input) is discoverable without hunting. */}
      {configurable && onConfigure && (
        <button
          type="button"
          aria-label={`Configure ${def.label}`}
          title="Configure this KPI & set a target"
          onClick={(e) => {
            e.stopPropagation();
            onConfigure();
          }}
          className="absolute top-2 right-2 z-10 p-1 rounded-md text-muted-foreground/45 opacity-100 hover:text-primary hover:bg-primary/8 transition-all active:scale-90"
        >
          <Settings2 className="w-3 h-3" />
        </button>
      )}

      {/* Label row */}
      <div className="flex items-center gap-1.5 mb-1">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider leading-none truncate">
          {def.label}
        </p>
        {status === "stale" && (
          <span
            title="Showing the last value — couldn't refresh from the source just now"
            className="w-1.5 h-1.5 rounded-full bg-amber-400/80 shrink-0"
          />
        )}
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

      {/* Target over/under badge — direction-aware, only with a numeric value */}
      {!editing && target && typeof value === "number" && Number.isFinite(value) && (
        <div className="mt-1.5">
          <TargetBadge value={value} target={target} unit={def.unit} />
        </div>
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

// ─── Target over/under badge ──────────────────────────────────────────────────

/**
 * A small, direction-aware chip showing how the value compares to its target.
 *
 *   deltaPct = (value − target) / target × 100
 *
 * Good-vs-bad is decided by `direction`, NOT by the sign of the delta:
 *   direction "higher" → above target (deltaPct > 0) is GOOD.
 *   direction "lower"  → below target (deltaPct < 0) is GOOD.
 *
 * Worked examples (confirmed):
 *   • Cash $42k vs $30k target, higher → +40% above  → GREEN  "40% above target"
 *   • Ad Spend $6.7k vs $5k target, lower → +34% above → RED   "34% above target"
 *   • Expenses under a target (lower)                  → GREEN "x% below target"
 *
 * A near-zero delta (|deltaPct| < ON_TARGET_PCT) reads as a neutral "On target".
 * target === 0 can't yield a percentage, so it shows a neutral "vs 0 target".
 */

const ON_TARGET_PCT = 2; // within ±2% of target reads as "on target"

function TargetBadge({
  value,
  target,
  unit,
}: {
  value: number;
  target: MetricTarget;
  unit: MetricUnit;
}) {
  const targetLabel = `Target ${fmtValue(target.target, unit)}`;

  // Guard: a 0 target has no meaningful percentage — show a calm neutral chip.
  if (target.target === 0) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-muted/60 text-[10px] font-semibold text-muted-foreground">
        <span className="tabular-nums">vs 0 target</span>
      </span>
    );
  }

  const deltaPct = ((value - target.target) / target.target) * 100;
  const absPct = Math.abs(deltaPct);
  const isAbove = deltaPct > 0; // strictly above target

  // Roughly on target → neutral, no good/bad judgement.
  if (absPct < ON_TARGET_PCT) {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-muted/60 text-[10px] font-semibold text-muted-foreground"
        title={targetLabel}
      >
        On target
        <span className="font-normal text-muted-foreground/70">· {targetLabel}</span>
      </span>
    );
  }

  // Direction-aware verdict: is the current side of target the GOOD side?
  const isGood = target.direction === "higher" ? isAbove : !isAbove;

  // The arrow follows the VALUE's position vs target (up = above, down = below),
  // independent of good/bad — colour carries the good/bad meaning.
  const Arrow = isAbove ? TrendingUp : TrendingDown;
  const positionWord = isAbove ? "above" : "below";
  const pctText = `${absPct < 10 ? absPct.toFixed(1) : Math.round(absPct)}%`;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold",
        isGood
          ? "bg-success-subtle text-success"
          : "bg-destructive/10 text-destructive",
      )}
      title={targetLabel}
    >
      <Arrow className="w-2.5 h-2.5 shrink-0" aria-hidden />
      <span className="tabular-nums">{pctText} {positionWord} target</span>
      <span className="font-normal text-muted-foreground/70">· {targetLabel}</span>
    </span>
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
