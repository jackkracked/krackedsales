"use client";

import { cn } from "@/lib/utils/cn";
import { AreaChart, Area, ResponsiveContainer, Tooltip } from "recharts";
import { Pencil, Settings2, SlidersHorizontal, TrendingUp, TrendingDown } from "lucide-react";
import { useState } from "react";
import { paceForWindow, type CadenceTargets, type Cadence } from "@/lib/kpi/pacing";

/** The reporting window a cell is showing (YYYY-MM-DD; end exclusive) — drives pacing. */
export interface DateWindow {
  start: string;
  end: string;
}

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
 *
 * `target` is the legacy single value, kept equal to the monthly target for back-compat.
 * The cadence slots drive pace-adjusted badges; any may be null (the engine derives a
 * run-rate from whichever cadence IS set).
 */
export interface MetricTarget {
  target: number;
  direction: "higher" | "lower";
  daily?: number | null;
  weekly?: number | null;
  monthly?: number | null;
  anchor?: Cadence;
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
   * direction-aware pace badge + hairline meter render under the value.
   */
  target?: MetricTarget;
  /**
   * The window this cell is reporting on. When provided, the badge paces the target
   * to the days elapsed (honest on-track for partial/rolling windows). Without it the
   * badge falls back to a plain value-vs-monthly comparison.
   */
  window?: DateWindow;
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

  // Under r10n, --r10n-spark-stroke / --r10n-spark-fill are set on the wrapper
  // (lime for positive, steel otherwise) and these vars resolve to them; in the
  // default theme the vars are unset so the JS-computed `color` is used as-is.
  const strokeColor = `var(--r10n-spark-stroke, ${color})`;
  const fillColor = `var(--r10n-spark-fill, ${color})`;

  return (
    <div className="h-[28px] w-full" data-r10n-spark data-r10n-spark-positive={positive === false ? "false" : "true"}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={fillColor} stopOpacity={0.15} />
              <stop offset="100%" stopColor={fillColor} stopOpacity={0} />
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
            stroke={strokeColor}
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
  window,
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
      data-r10n-metric
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
        <p data-r10n-metric-label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider leading-none truncate">
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
          data-r10n-metric-value
          className={cn("text-lg font-bold leading-none tabular-nums", accentColor)}
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {formatted}
        </p>
      )}

      {/* Pace badge + hairline meter — direction-aware, only with a numeric value */}
      {!editing && target && typeof value === "number" && Number.isFinite(value) && (
        <div className="mt-1.5">
          <PaceBadge value={value} target={target} unit={def.unit} window={window} />
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

// ─── Pace badge + hairline meter ──────────────────────────────────────────────

/**
 * The honest on-track read for the window the cell is showing. Instead of comparing
 * the value to one absolute target (which reads "-97%" on Today), it compares to a
 * PACE TARGET — the right cadence target scaled to the days elapsed (see lib/kpi/pacing).
 *
 * Renders two stacked things:
 *   ① a hairline meter — fill = value ÷ pace target, with a gold tick at the pace line
 *      (100%). Past the tick = ahead of pace; colour carries good/bad by direction.
 *   ② a chip — arrow + "{pct} ahead/behind pace" (or "above/below target" for whole
 *      periods), with a faint "{pace} of {full}" caption.
 *
 * Good-vs-bad is decided by `direction`, never by the sign of the delta.
 */

type PaceTone = "good" | "bad" | "neutral";

const METER_MAX = 1.25; // track spans 0–125% of pace, so "ahead" has room past the tick

function clamp01Max(n: number): number {
  return Math.max(0, Math.min(METER_MAX, n));
}

function toCadenceTargets(t: MetricTarget): CadenceTargets {
  return {
    daily: t.daily ?? null,
    weekly: t.weekly ?? null,
    monthly: t.monthly ?? t.target ?? null,
  };
}

const CADENCE_WORD: Record<Cadence, string> = { daily: "day", weekly: "week", monthly: "month" };

function pctLabel(absPct: number): string {
  return `${absPct < 10 ? absPct.toFixed(1) : Math.round(absPct)}%`;
}

function PaceMeter({ ratio, tone }: { ratio: number; tone: PaceTone }) {
  const markLeft = (1 / METER_MAX) * 100; // the pace line (100% of pace) inside the track
  const fillWidth = (clamp01Max(ratio) / METER_MAX) * 100;
  const fillColor =
    tone === "good" ? "bg-success" : tone === "bad" ? "bg-destructive" : "bg-gold";
  return (
    <div
      data-r10n-pace-meter
      data-tone={tone}
      className="relative h-1 w-full max-w-[150px] rounded-full bg-border/55 overflow-hidden"
      aria-hidden
    >
      <div
        data-r10n-pace-fill
        className={cn(
          "absolute inset-y-0 left-0 transition-[width] duration-500 ease-out motion-reduce:transition-none",
          fillColor,
        )}
        style={{ width: `${fillWidth}%` }}
      />
      {/* Pace line — the gold target tick the fill is measured against. */}
      <div
        data-r10n-pace-tick
        className="absolute inset-y-0 w-px bg-foreground/45"
        style={{ left: `${markLeft}%` }}
      />
    </div>
  );
}

function PaceBadge({
  value,
  target,
  unit,
  window,
}: {
  value: number;
  target: MetricTarget;
  unit: MetricUnit;
  window?: DateWindow;
}) {
  const targets = toCadenceTargets(target);
  const pace = window
    ? paceForWindow({ value, direction: target.direction, targets, window })
    : null;

  // No window (or an empty range) → fall back to the plain value-vs-monthly chip.
  if (!pace) {
    return (
      <AbsoluteBadge value={value} target={target.target} direction={target.direction} unit={unit} />
    );
  }

  // Window entirely in the future — nothing to judge yet.
  if (pace.periodKind === "upcoming") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-muted/60 text-[10px] font-semibold text-muted-foreground">
        Hasn&apos;t started
      </span>
    );
  }

  // No usable positive target → calm neutral chip.
  if (pace.zeroTarget) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-muted/60 text-[10px] font-semibold text-muted-foreground">
        <span className="tabular-nums">vs 0 target</span>
      </span>
    );
  }

  const wholePeriod =
    !pace.prorated &&
    (pace.periodKind === "day" || pace.periodKind === "week" || pace.periodKind === "month");
  const refWord = wholePeriod ? "target" : "pace";
  const tone: PaceTone = pace.neutral ? "neutral" : pace.isGood ? "good" : "bad";

  // Caption: "{pace} of {full}" for partial windows, "Target {full}" for whole periods.
  const caption = wholePeriod
    ? `Target ${fmtValue(pace.fullPeriodTarget, unit)}`
    : `${fmtValue(pace.expected, unit)} of ${fmtValue(pace.fullPeriodTarget, unit)}`;

  // Rich tooltip — the full pacing story, kept out of the dense visible row.
  const title = pace.neutral
    ? `On ${refWord} for the ${CADENCE_WORD[pace.cadence]} · ${fmtValue(value, unit)} vs ${fmtValue(
        pace.expected,
        unit,
      )} ${refWord}${pace.prorated ? ` · ${pace.elapsedDays} of ${pace.periodDays} days` : ""}`
    : `${pctLabel(Math.abs(pace.deltaPct))} ${pace.isAbove ? "above" : "below"} ${refWord} · ${fmtValue(
        value,
        unit,
      )} vs ${fmtValue(pace.expected, unit)}${
        pace.prorated ? ` · ${pace.elapsedDays} of ${pace.periodDays} days` : ""
      }`;

  return (
    <div className="space-y-1" title={title}>
      <PaceMeter ratio={pace.ratio} tone={tone} />
      {pace.neutral ? (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
          <span className="h-1 w-1 rounded-full bg-gold shrink-0" aria-hidden />
          On {refWord}
          <span className="font-normal text-muted-foreground/75 tabular-nums">· {caption}</span>
        </span>
      ) : (
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[10px] font-semibold",
            tone === "good" ? "text-success" : "text-destructive",
          )}
        >
          {pace.isAbove ? (
            <TrendingUp className="w-2.5 h-2.5 shrink-0" aria-hidden />
          ) : (
            <TrendingDown className="w-2.5 h-2.5 shrink-0" aria-hidden />
          )}
          <span className="tabular-nums">
            {pctLabel(Math.abs(pace.deltaPct))} {pace.isAbove ? "above" : "below"} {refWord}
          </span>
          <span className="font-normal text-muted-foreground/75 tabular-nums">· {caption}</span>
        </span>
      )}
    </div>
  );
}

// ─── Absolute fallback (no window) — the pre-pacing value-vs-monthly chip ─────────

const ON_TARGET_PCT = 2;

function AbsoluteBadge({
  value,
  target,
  direction,
  unit,
}: {
  value: number;
  target: number;
  direction: "higher" | "lower";
  unit: MetricUnit;
}) {
  const targetLabel = `Target ${fmtValue(target, unit)}`;
  if (target === 0) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-muted/60 text-[10px] font-semibold text-muted-foreground">
        <span className="tabular-nums">vs 0 target</span>
      </span>
    );
  }
  const deltaPct = ((value - target) / target) * 100;
  const absPct = Math.abs(deltaPct);
  const isAbove = deltaPct > 0;
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
  const isGood = direction === "higher" ? isAbove : !isAbove;
  const Arrow = isAbove ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold",
        isGood ? "bg-success-subtle text-success" : "bg-destructive/10 text-destructive",
      )}
      title={targetLabel}
    >
      <Arrow className="w-2.5 h-2.5 shrink-0" aria-hidden />
      <span className="tabular-nums">
        {pctLabel(absPct)} {isAbove ? "above" : "below"} target
      </span>
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
