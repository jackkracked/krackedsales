"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { BarChart2, Pencil, Plus } from "lucide-react";
import { fmtNumber, type MetricDef } from "@/components/kpis/metric-cell";
import { BalancedMetricGrid, type MetricValue } from "@/components/kpis/balanced-metric-grid";
import { KpiEditSheet } from "./kpi-edit-sheet";
import { KpiDetailSheet } from "@/components/kpis/KpiDetailSheet";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { getDefaults, getKpiDef, getPoolForRole } from "@/lib/dashboard-kpis";
import type { KpiMetricResult } from "@/app/api/dashboard/kpis/route";

interface KpiWidgetProps {
  role: "admin" | "rep";
  userId: string;
  ghlUserId?: string | null;
  email?: string;
}

/** Human label for the selected range, used in the detail drawer. */
function periodLabelFor(preset?: string): string {
  switch (preset) {
    case "today":     return "Today";
    case "yesterday": return "Yesterday";
    case "7d":        return "Last 7 Days";
    case "30d":       return "Last 30 Days";
    case "wtd":       return "Week to Date";
    case "mtd":       return "Month to Date";
    case "ytd":       return "Year to Date";
    default:          return "selected range";
  }
}

/** Folded sub-text under a cell: a target or an "as of" marker (no delta arrow). */
function subFor(data?: KpiMetricResult): string | undefined {
  if (!data) return undefined;
  if (data.asOfLabel) return data.asOfLabel;
  if (data.target != null) return `of ${fmtNumber(data.target)} target`;
  return undefined;
}

/** Quiet "add a metric" affordance that fills the last balanced slot (until the 8 max). */
function AddKpiCell({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Add a KPI"
      className="group/add w-full h-full min-h-[72px] flex flex-col items-center justify-center gap-1.5 py-3.5 px-4 text-muted-foreground/60 transition-all duration-150 hover:bg-muted/20 hover:text-foreground motion-safe:hover:-translate-y-px"
    >
      <span className="w-7 h-7 rounded-full border border-dashed border-border flex items-center justify-center transition-colors group-hover/add:border-primary/60 group-hover/add:text-primary">
        <Plus className="w-3.5 h-3.5" />
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-wider">Add KPI</span>
    </button>
  );
}

export function KpiWidget({ role, userId, ghlUserId, email }: KpiWidgetProps) {
  const queryClient = useQueryClient();
  const now = new Date();
  const defaultRange = useMemo(() => {
    const s = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
    const e = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1));
    return { start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10), preset: "mtd" };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [dateRange, setDateRange] = useState<{ start: string; end: string; preset?: string }>(defaultRange);
  const [editOpen, setEditOpen] = useState(false);
  const [detailKey, setDetailKey] = useState<string | null>(null);

  // Load saved KPI selections
  const { data: prefsData } = useQuery<{ keys: string[] }>({
    queryKey: ["kpi-prefs"],
    queryFn: () => fetch("/api/dashboard/kpi-prefs").then((r) => r.json()),
    staleTime: Infinity,
  });

  const selectedKeys = prefsData?.keys ?? getDefaults(role);
  const pool = getPoolForRole(role);

  // Build query params for metric data — pass the real selected date range
  const params = new URLSearchParams({ role, start: dateRange.start, end: dateRange.end });
  if (dateRange.preset) params.set("preset", dateRange.preset);
  selectedKeys.forEach((k) => params.append("keys[]", k));
  if (userId) params.set("userId", userId);
  if (ghlUserId) params.set("ghlUserId", ghlUserId);
  if (email) params.set("email", email);

  const { data: kpisData, isLoading, isFetching } = useQuery<{ metrics: Record<string, KpiMetricResult> }>({
    // start/end are in the key so changing the date filter refetches
    queryKey: ["dashboard-kpis", dateRange.start, dateRange.end, selectedKeys.join(","), userId],
    queryFn: () => fetch(`/api/dashboard/kpis?${params}`).then((r) => r.json()),
    staleTime: 60_000,
    refetchInterval: 3 * 60_000,
    // Keep the previous values on screen while a background refresh runs, so a
    // refetch never flashes skeletons/zeros — the data just updates in place.
    placeholderData: keepPreviousData,
  });

  // Save prefs mutation
  const saveMutation = useMutation({
    mutationFn: (keys: string[]) =>
      fetch("/api/dashboard/kpi-prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kpi-prefs"] });
      setEditOpen(false);
    },
  });

  return (
    <>
      <div className="bg-card border border-border rounded-[10px] overflow-hidden shrink-0">
        {/* Header */}
        <div className="flex items-center justify-between p-5 pb-4">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-muted-foreground" />
            <h3
              className="text-sm font-semibold text-foreground"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              KPIs
            </h3>
            {isFetching && !isLoading && (
              <span
                title="Refreshing…"
                className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-pulse"
              />
            )}
          </div>

          <div className="flex items-center gap-2">
            <DateRangePicker value={dateRange} onChange={setDateRange} />
            <button
              onClick={() => setEditOpen(true)}
              className="w-7 h-7 rounded-[6px] flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              title="Customise KPIs"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Cards — balanced rows; the last slot is a quiet "Add KPI" affordance */}
        <div className="border-t border-border/60">
          {(() => {
            const mdefs: MetricDef[] = selectedKeys
              .map((key) => {
                const def = getKpiDef(key);
                return def ? { key, label: def.label, unit: def.unit } : null;
              })
              .filter((d): d is MetricDef => d !== null);
            const vals: Record<string, MetricValue | undefined> = {};
            for (const key of selectedKeys) {
              const data = kpisData?.metrics?.[key];
              vals[key] = data ? { value: data.value, spark: data.series, sub: subFor(data), status: data.status } : undefined;
            }
            return (
              <BalancedMetricGrid
                metrics={mdefs}
                values={vals}
                loading={isLoading}
                loadingCount={selectedKeys.length || 3}
                onMetricClick={(key) => setDetailKey(key)}
                addCell={
                  !isLoading && selectedKeys.length < 8 ? (
                    <AddKpiCell onClick={() => setEditOpen(true)} />
                  ) : undefined
                }
              />
            );
          })()}
        </div>
      </div>

      {editOpen && (
        <KpiEditSheet
          pool={pool}
          selected={selectedKeys}
          onSave={(keys) => saveMutation.mutate(keys)}
          onClose={() => setEditOpen(false)}
          isSaving={saveMutation.isPending}
        />
      )}

      {detailKey && (
        <KpiDetailSheet
          metric={detailKey}
          start={dateRange.start}
          end={dateRange.end}
          periodLabel={periodLabelFor(dateRange.preset)}
          userId={userId}
          ghlUserId={ghlUserId ?? undefined}
          email={email}
          onClose={() => setDetailKey(null)}
        />
      )}
    </>
  );
}
