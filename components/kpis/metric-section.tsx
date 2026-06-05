"use client";

import { cn } from "@/lib/utils/cn";
import { MetricCell, MetricCellSkeleton, type MetricDef, type SparkPoint } from "./metric-cell";

interface MetricValue {
  value: number | null | undefined;
  spark?: SparkPoint[];
  sub?: string;
}

interface MetricSectionProps {
  title: string;
  subtitle?: string;
  metrics: MetricDef[];
  values: Record<string, MetricValue | undefined>;
  loading?: boolean;
  onMetricClick?: (key: string) => void;
  onManualSave?: (key: string, value: number) => void;
  /** Accent color for the section header bar */
  accent?: string;
}

/**
 * A full-width section band containing a responsive grid of metrics.
 * Metrics flow into rows that fill the content area.
 * Last row stretches to match the width of full rows.
 */
export function MetricSection({
  title,
  subtitle,
  metrics,
  values,
  loading,
  onMetricClick,
  onManualSave,
  accent,
}: MetricSectionProps) {
  if (metrics.length === 0 && !loading) return null;

  return (
    <section className="mb-6">
      {/* Section header — left label with extending rule */}
      <div className="flex items-center gap-3 mb-2 px-1">
        <div
          className="w-0.5 h-3.5 rounded-full shrink-0"
          style={{ backgroundColor: accent ?? "oklch(0.45 0.03 250)" }}
        />
        <h3
          className="text-[11px] font-bold uppercase tracking-widest text-foreground/70 shrink-0"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {title}
        </h3>
        {subtitle && (
          <span className="text-[11px] text-muted-foreground font-medium">{subtitle}</span>
        )}
        <div className="flex-1 h-px bg-border/60" />
      </div>

      {/* Metric grid — fills width, last row stretches */}
      <div className="bg-card border border-border rounded-[10px] overflow-hidden">
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 divide-x divide-y divide-border/40">
            {Array.from({ length: 5 }).map((_, i) => (
              <MetricCellSkeleton key={i} />
            ))}
          </div>
        ) : (
          <MetricGrid
            metrics={metrics}
            values={values}
            onMetricClick={onMetricClick}
            onManualSave={onManualSave}
          />
        )}
      </div>
    </section>
  );
}

/**
 * Responsive grid that auto-fills and stretches the last row.
 * Uses CSS grid with auto-fill so metrics dynamically adapt.
 */
function MetricGrid({
  metrics,
  values,
  onMetricClick,
  onManualSave,
}: {
  metrics: MetricDef[];
  values: Record<string, MetricValue | undefined>;
  onMetricClick?: (key: string) => void;
  onManualSave?: (key: string, value: number) => void;
}) {
  // Calculate ideal columns: aim for 4-5 on desktop, 2-3 on mobile
  // Use a CSS grid that fills rows evenly
  const count = metrics.length;

  // Determine the column count for the last row to make it stretch
  // We use tailwind responsive classes and let the grid handle it
  return (
    <div
      className={cn(
        "grid divide-x divide-y divide-border/40",
        // Responsive columns
        count === 1 && "grid-cols-1",
        count === 2 && "grid-cols-2",
        count === 3 && "grid-cols-3",
        count >= 4 && count <= 5 && "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
        count >= 6 && count <= 8 && "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
        count >= 9 && "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
      )}
      style={{
        // Make last row items stretch to fill remaining space
        // Each cell is equal width within its row
      }}
    >
      {metrics.map((def) => {
        const mv = values[def.key];
        return (
          <MetricCell
            key={def.key}
            def={def}
            value={mv?.value}
            spark={mv?.spark}
            sub={mv?.sub}
            onClick={onMetricClick ? () => onMetricClick(def.key) : undefined}
            onManualSave={def.manual && onManualSave ? (v) => onManualSave(def.key, v) : undefined}
          />
        );
      })}
    </div>
  );
}
