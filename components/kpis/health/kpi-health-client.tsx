"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Shield, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import Link from "next/link";
import { HealthRow } from "./health-row";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HealthMetric {
  key: string;
  name: string;
  whatItMeasures: string;
  whereItComesFrom: string;
  sourceSystem: string;
  sourceUrl: string | null;
  zeroMeans: string;
  unit: "currency" | "count" | "ratio" | "percent";
  value: number | null;
  status: string;
  lastCheckedAt: string | null;
  error: string | null;
  responseTimeMs: number | null;
  override: { value: number; note: string | null } | null;
}

export type DerivedStatus = "healthy" | "stale" | "error" | "override";

export function deriveStatus(metric: HealthMetric): DerivedStatus {
  if (metric.override) return "override";
  if (metric.status === "error") return "error";
  if (
    metric.status === "unknown" ||
    !metric.lastCheckedAt ||
    Date.now() - new Date(metric.lastCheckedAt).getTime() > 30 * 60 * 1000
  )
    return "stale";
  return "healthy";
}

// ─── Section grouping ────────────────────────────────────────────────────────

interface HealthSection {
  title: string;
  accent: string;
  keys: string[];
}

const HEALTH_SECTIONS: HealthSection[] = [
  {
    title: "Business Metrics",
    accent: "oklch(0.45 0.12 250)",
    keys: ["cash", "cash_collected", "outstanding", "mrr", "total_mrr", "total_expenses", "net_pl"],
  },
  {
    title: "Management Metrics",
    accent: "oklch(0.50 0.12 170)",
    keys: ["management_mrr", "new_management_mrr", "churned_management_mrr", "management_clients", "client_retention_rate"],
  },
  {
    title: "Project Metrics",
    accent: "oklch(0.55 0.15 85)",
    keys: ["new_project_value", "active_projects"],
  },
  {
    title: "Sales Metrics",
    accent: "oklch(0.45 0.12 300)",
    keys: ["proposals_sent", "mgmt_proposal_value_sent", "mgmt_proposal_value_lost", "proj_proposal_value_sent", "proj_proposal_value_lost", "ad_spend"],
  },
  {
    title: "Offer Metrics",
    accent: "oklch(0.55 0.12 25)",
    keys: ["leads", "roas", "cpl", "booked_calls", "demos_submitted", "demos_completed", "audits_requested", "audits_completed"],
  },
  {
    title: "System",
    accent: "oklch(0.50 0.05 250)",
    keys: ["software_spend", "pipeline_value_admin", "pipeline_value", "deals_won", "calls_admin", "calls_rep", "commission", "revenue_won", "pipeline_count"],
  },
];

function LegendDot({ color, label, tone }: { color: string; label: string; tone?: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span data-r10n-health-legend-dot data-tone={tone} className={cn("inline-block h-2 w-2 rounded-full", color)} />
      {label}
    </span>
  );
}

// ─── Root ────────────────────────────────────────────────────────────────────

export function KpiHealthClient() {
  const queryClient = useQueryClient();
  const [checkingAll, setCheckingAll] = useState(false);

  const { data, isLoading } = useQuery<{ metrics: HealthMetric[] }>({
    queryKey: ["kpi-health"],
    queryFn: async () => {
      const res = await fetch("/api/kpis/health");
      if (!res.ok) throw new Error("Failed to load health data");
      return res.json();
    },
    staleTime: 30_000,
  });

  const metrics = data?.metrics ?? [];
  const healthyCount = metrics.filter((m) => deriveStatus(m) === "healthy").length;

  // Group metrics by section
  const assignedKeys = new Set(HEALTH_SECTIONS.flatMap((s) => s.keys));
  const ungrouped = metrics.filter((m) => !assignedKeys.has(m.key));

  async function checkAll() {
    setCheckingAll(true);
    try {
      await Promise.allSettled(
        metrics.map((m) => fetch(`/api/kpis/verify/${m.key}`, { method: "POST" }))
      );
      queryClient.invalidateQueries({ queryKey: ["kpi-health"] });
    } finally {
      setCheckingAll(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <Link
              href="/kpis"
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors mb-2"
            >
              <ArrowLeft className="w-3 h-3" />
              Back to KPIs
            </Link>
            <h1
              data-r10n-kpi-page-title
              className="text-2xl font-bold tracking-tight text-foreground"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              KPI Health
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Verify every metric is tracking correctly
            </p>
          </div>

          <button
            data-r10n-health-btn
            onClick={checkAll}
            disabled={checkingAll || isLoading}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] text-xs font-medium transition-colors",
              "bg-muted text-muted-foreground hover:text-foreground border border-border",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", checkingAll && "animate-spin")} />
            {checkingAll ? "Checking..." : "Check all"}
          </button>
        </div>

        {/* Summary + legend */}
        <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">
              {isLoading ? "Loading..." : `${healthyCount} of ${metrics.length} metrics healthy`}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <LegendDot color="bg-emerald-500" label="Healthy" tone="healthy" />
            <LegendDot color="bg-amber-500" label="Stale" tone="stale" />
            <LegendDot color="bg-red-500" label="Error" tone="error" />
            <LegendDot color="bg-blue-500" label="Override" tone="override" />
          </div>
        </div>

        {/* Loading skeleton */}
        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-[10px] p-5 animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="h-5 w-5 rounded-full bg-muted" />
                  <div className="h-4 w-40 rounded bg-muted" />
                  <div className="ml-auto h-6 w-20 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Grouped metric rows */}
        {!isLoading && HEALTH_SECTIONS.map((section) => {
          const sectionMetrics = metrics.filter((m) => section.keys.includes(m.key));
          if (sectionMetrics.length === 0) return null;

          return (
            <div key={section.title} className="mb-6">
              {/* Section header */}
              <div className="flex items-center gap-3 mb-3 px-1">
                <div data-r10n-section-accent className="w-0.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: `var(--r10n-section-accent, ${section.accent})` }} />
                <h3
                  data-r10n-section-title
                  className="text-[11px] font-bold uppercase tracking-widest text-foreground/70 shrink-0"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {section.title}
                </h3>
                <div className="flex-1 h-px bg-border/60" />
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {sectionMetrics.filter((m) => deriveStatus(m) === "healthy").length}/{sectionMetrics.length} healthy
                </span>
              </div>

              {/* Rows */}
              <div className="flex flex-col gap-2">
                {sectionMetrics.map((metric) => (
                  <HealthRow key={metric.key} metric={metric} />
                ))}
              </div>
            </div>
          );
        })}

        {/* Ungrouped metrics (legacy/system) */}
        {!isLoading && ungrouped.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-3 px-1">
              <div data-r10n-section-accent className="w-0.5 h-3.5 rounded-full shrink-0 bg-muted-foreground/30" />
              <h3 data-r10n-section-title className="text-[11px] font-bold uppercase tracking-widest text-foreground/70 shrink-0" style={{ fontFamily: "var(--font-heading)" }}>
                Other
              </h3>
              <div className="flex-1 h-px bg-border/60" />
            </div>
            <div className="flex flex-col gap-2">
              {ungrouped.map((metric) => (
                <HealthRow key={metric.key} metric={metric} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
