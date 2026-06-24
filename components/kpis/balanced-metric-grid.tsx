"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { MetricCell, MetricCellSkeleton, type MetricDef, type MetricTarget, type SparkPoint } from "./metric-cell";

export interface MetricValue {
  value: number | null | undefined;
  spark?: SparkPoint[];
  sub?: string;
  status?: "ok" | "stale";
  /** Admin-set goal → renders the over/under target badge on the cell. */
  target?: MetricTarget;
}

interface BalancedMetricGridProps {
  metrics: MetricDef[];
  values: Record<string, MetricValue | undefined>;
  onMetricClick?: (key: string) => void;
  onManualSave?: (key: string, value: number) => void;
  /** Optional trailing cell (e.g. an "Add KPI" affordance) — counted in the balance. */
  addCell?: ReactNode;
  loading?: boolean;
  loadingCount?: number;
}

/**
 * Split N slots into balanced rows that fill the width:
 *   ≤4 → one row;  ≥5 → two rows [ceil(n/2), floor(n/2)].
 * Each row is a flex row whose cells share the width equally (flex-1 basis-0),
 * so the last row stretches — never an empty trailing cell.
 */
export function balancedRows(n: number): number[] {
  if (n <= 0) return [];
  if (n <= 4) return [n];
  return [Math.ceil(n / 2), Math.floor(n / 2)];
}

export function BalancedMetricGrid({
  metrics,
  values,
  onMetricClick,
  onManualSave,
  addCell,
  loading,
  loadingCount = 4,
}: BalancedMetricGridProps) {
  if (loading) {
    return (
      <Rows
        rows={balancedRows(loadingCount)}
        cells={Array.from({ length: loadingCount }, (_, i) => <MetricCellSkeleton key={i} />)}
      />
    );
  }

  const cells: ReactNode[] = metrics.map((def) => {
    const mv = values[def.key];
    return (
      <MetricCell
        key={def.key}
        def={def}
        value={mv?.value}
        spark={mv?.spark}
        sub={mv?.sub}
        status={mv?.status}
        target={mv?.target}
        onClick={onMetricClick ? () => onMetricClick(def.key) : undefined}
        onManualSave={def.manual && onManualSave ? (v) => onManualSave(def.key, v) : undefined}
      />
    );
  });
  if (addCell) cells.push(<div key="__add" className="h-full">{addCell}</div>);

  return <Rows rows={balancedRows(cells.length)} cells={cells} />;
}

function Rows({ rows, cells }: { rows: number[]; cells: ReactNode[] }) {
  // Slice cells into their rows up front (no mutation during the JSX render).
  const slices: ReactNode[][] = [];
  let offset = 0;
  for (const count of rows) {
    slices.push(cells.slice(offset, offset + count));
    offset += count;
  }
  return (
    <div>
      {slices.map((rowCells, ri) => (
        <div
          key={ri}
          className={cn("flex divide-x divide-border/40", ri > 0 && "border-t border-border/40")}
        >
          {rowCells.map((c, ci) => (
            <div key={ci} className="flex-1 basis-0 min-w-0">
              {c}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
