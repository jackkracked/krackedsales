"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BarChart2, Pencil } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { KpiCard } from "./kpi-card";
import { KpiEditSheet } from "./kpi-edit-sheet";
import { getDefaults, getKpiDef, getPoolForRole } from "@/lib/dashboard-kpis";
import type { KpiMetricResult } from "@/app/api/dashboard/kpis/route";

type Period = "day" | "week" | "month";

interface KpiWidgetProps {
  role: "admin" | "rep";
  userId: string;
  ghlUserId?: string | null;
  email?: string;
}

const PERIOD_LABELS: { key: Period; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

export function KpiWidget({ role, userId, ghlUserId, email }: KpiWidgetProps) {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<Period>("month");
  const [editOpen, setEditOpen] = useState(false);

  // Load saved KPI selections
  const { data: prefsData } = useQuery<{ keys: string[] }>({
    queryKey: ["kpi-prefs"],
    queryFn: () => fetch("/api/dashboard/kpi-prefs").then((r) => r.json()),
    staleTime: Infinity,
  });

  const selectedKeys = prefsData?.keys ?? getDefaults(role);
  const pool = getPoolForRole(role);

  // Build query params for metric data
  const params = new URLSearchParams({ period, role });
  selectedKeys.forEach((k) => params.append("keys[]", k));
  if (userId) params.set("userId", userId);
  if (ghlUserId) params.set("ghlUserId", ghlUserId);
  if (email) params.set("email", email);

  const { data: kpisData, isLoading } = useQuery<{ metrics: Record<string, KpiMetricResult> }>({
    queryKey: ["dashboard-kpis", period, selectedKeys.join(","), userId],
    queryFn: () => fetch(`/api/dashboard/kpis?${params}`).then((r) => r.json()),
    staleTime: 60_000,
    refetchInterval: 3 * 60_000,
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
            {/* Period toggle */}
            <div className="flex items-center bg-muted/50 rounded-[7px] p-0.5 gap-0.5">
              {PERIOD_LABELS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setPeriod(key)}
                  className={cn(
                    "px-3 py-1 text-[11.5px] font-medium rounded-[5px] transition-all duration-150",
                    period === key
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Edit button */}
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
        <div className="flex gap-4">
          {selectedKeys.map((key) => {
            const def = getKpiDef(key);
            if (!def) return null;
            return (
              <KpiCard
                key={key}
                def={def}
                data={kpisData?.metrics?.[key]}
                isLoading={isLoading}
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
    </>
  );
}
