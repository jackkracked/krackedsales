"use client";

import { BalancedMetricGrid, type MetricValue } from "./balanced-metric-grid";
import { type MetricDef, type DateWindow } from "./metric-cell";

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
  /** Reporting window — paces each cell's target badge. */
  window?: DateWindow;
}

/**
 * A full-width section band containing a balanced grid of metrics.
 * Rows fill the width and the last row stretches — no empty trailing cells.
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
  window,
}: MetricSectionProps) {
  if (metrics.length === 0 && !loading) return null;

  return (
    <section className="mb-6">
      {/* Section header — left label with extending rule */}
      <div className="flex items-center gap-3 mb-2 px-1">
        <div
          data-r10n-section-accent
          className="w-0.5 h-3.5 rounded-full shrink-0"
          style={{ backgroundColor: `var(--r10n-section-accent, ${accent ?? "oklch(0.45 0.03 250)"})` }}
        />
        <h3
          data-r10n-section-title
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

      {/* Balanced metric grid */}
      <div data-r10n-card className="bg-card border border-border rounded-[10px] overflow-hidden">
        <BalancedMetricGrid
          metrics={metrics}
          values={values}
          loading={loading}
          loadingCount={metrics.length || 5}
          onMetricClick={onMetricClick}
          onManualSave={onManualSave}
          window={window}
        />
      </div>
    </section>
  );
}
