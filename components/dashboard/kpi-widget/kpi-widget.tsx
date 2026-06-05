"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BarChart2, Pencil } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { KpiCard } from "./kpi-card";
import { KpiEditSheet } from "./kpi-edit-sheet";
import { KpiDetailSheet } from "@/components/kpis/KpiDetailSheet";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { getDefaults, getKpiDef, getPoolForRole } from "@/lib/dashboard-kpis";
import type { KpiMetricResult } from "@/app/api/dashboard/kpis/route";

interface KpiHealthEntry {
  status: "ok" | "error";
  override?: boolean;
  lastCheckedAt: string | null;
}

type KpiHealthData = Record<string, KpiHealthEntry>;

function deriveHealthStatus(entry: KpiHealthEntry | undefined): "healthy" | "stale" | "error" | "override" {
  if (!entry) return "stale";
  if (entry.override) return "override";
  if (entry.status === "error") return "error";
  if (!entry.lastCheckedAt) return "stale";
  const age = Date.now() - new Date(entry.lastCheckedAt).getTime();
  if (age > 30 * 60 * 1000) return "stale";
  return "healthy";
}

interface KpiWidgetProps {
  role: "admin" | "rep";
  userId: string;
  ghlUserId?: string | null;
  email?: string;
}

/** Trailing phrase for the delta tooltip, e.g. "X vs Y last month". */
function compareLabelFor(preset?: string): string {
  switch (preset) {
    case "today":     return "yesterday";
    case "yesterday": return "the prior day";
    case "7d":        return "the prior 7 days";
    case "30d":       return "the prior 30 days";
    case "wtd":       return "last week";
    case "mtd":       return "last month";
    case "ytd":       return "last year";
    default:          return "the prior period";
  }
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
  const compareLabel = compareLabelFor(dateRange.preset);
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

  const { data: kpisData, isLoading } = useQuery<{ metrics: Record<string, KpiMetricResult> }>({
    // start/end are in the key so changing the date filter refetches
    queryKey: ["dashboard-kpis", dateRange.start, dateRange.end, selectedKeys.join(","), userId],
    queryFn: () => fetch(`/api/dashboard/kpis?${params}`).then((r) => r.json()),
    staleTime: 60_000,
    refetchInterval: 3 * 60_000,
  });

  const { data: healthData } = useQuery<KpiHealthData>({
    queryKey: ["kpi-health"],
    queryFn: () => fetch("/api/kpis/health").then((r) => r.json()),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
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
      <div className="bg-card border border-border rounded-[10px] p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-muted-foreground" />
            <h3
              className="text-sm font-semibold text-foreground"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              KPIs
            </h3>
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

        {/* Cards */}
        <div className="flex gap-4 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {selectedKeys.map((key) => {
            const def = getKpiDef(key);
            if (!def) return null;
            return (
              <KpiCard
                key={key}
                def={def}
                data={kpisData?.metrics?.[key]}
                isLoading={isLoading}
                compareLabel={compareLabel}
                healthStatus={healthData ? deriveHealthStatus(healthData[key]) : undefined}
                onClick={() => setDetailKey(key)}
              />
            );
          })}
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
