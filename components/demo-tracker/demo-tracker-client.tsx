"use client";

import { useState, useMemo } from "react";
import { RefreshCw, Search, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatDistanceToNow } from "date-fns";
import { useDemoTasks } from "@/lib/hooks/use-demo-tasks";
import { useDemoGhlLinks } from "@/lib/hooks/use-demo-ghl-links";
import { DemoBucketColumn } from "./demo-bucket";
import { DemoKpiStrip } from "./demo-kpi-strip";
import { StageHeatmap } from "./stage-heatmap";
import { RiskAlerts } from "./risk-alerts";
import type { EnrichedTask } from "@/app/api/clickup/tasks/route";
import type { DemoBucket } from "@/lib/utils/demo-stage";
import { getStageRiskDays } from "@/lib/utils/demo-stage";
import { TIME_RANGE_OPTIONS, getTimeRangeStart, type TimeRange } from "@/lib/utils/time-range";

// ─── Stage options (only stages that appear on the demo list) ───────────────────
const DEMO_STAGE_OPTIONS = [
  { value: "copy",                    label: "Copy"            },
  { value: "design",                  label: "Design"          },
  { value: "copy revision needed",    label: "Copy Revision"   },
  { value: "design revision needed",  label: "Design Revision" },
  { value: "internal qa",             label: "Internal QA"     },
  { value: "scheduled/live",          label: "Scheduled/Live"  },
];

// ─── Bucket grouping ────────────────────────────────────────────────────────────

function groupByBucket(
  tasks: EnrichedTask[],
  range: TimeRange
): Record<DemoBucket, EnrichedTask[]> {
  const rangeStart = getTimeRangeStart(range);

  return {
    // IN_PROGRESS and WAITING_TO_SEND always show current pipeline — no date filter
    IN_PROGRESS: tasks.filter((t) => t.bucket === "IN_PROGRESS"),
    WAITING_TO_SEND: tasks.filter((t) => t.bucket === "WAITING_TO_SEND"),
    // DEMO_SENT filtered by when the demo was actually sent in the selected period
    DEMO_SENT: tasks
      .filter((t) => {
        if (t.bucket !== "DEMO_SENT") return false;
        if (!rangeStart) return true; // "all time"
        if (!t.dateSent) return false; // no sent date yet — exclude from range-filtered view
        return new Date(t.dateSent) >= rangeStart;
      })
      .sort((a, b) =>
        new Date(b.dateSent ?? b.dateUpdated).getTime() -
        new Date(a.dateSent ?? a.dateUpdated).getTime()
      ),
  };
}

// ─── Time range selector ────────────────────────────────────────────────────────

function TimeRangeSelector({ range, onChange }: { range: TimeRange; onChange: (r: TimeRange) => void }) {
  return (
    <div className="flex items-center gap-1 p-1 bg-muted rounded-lg shrink-0">
      {TIME_RANGE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "px-3 py-1 rounded-md text-xs font-medium transition-all whitespace-nowrap",
            range === opt.value
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ─── Select (reusable mini select) ─────────────────────────────────────────────

function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "text-xs rounded-lg border border-border bg-card px-2.5 py-1.5 pr-6",
        "text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30",
        "appearance-none cursor-pointer",
        value ? "font-medium" : "text-muted-foreground"
      )}
      style={{ backgroundImage: "none" }}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────────

export function DemoTrackerClient() {
  const [range, setRange] = useState<TimeRange>("month");
  const [search, setSearch] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } = useDemoTasks();
  const tasks = data?.tasks ?? [];
  const backfill = data?.backfill;
  const backfillComplete = !backfill || backfill.synced >= backfill.total;
  const backfillPct = backfill ? Math.round((backfill.synced / backfill.total) * 100) : 0;
  const { data: links = {} } = useDemoGhlLinks(tasks, range);

  // ── Extract unique assignees from loaded tasks ──
  const assigneeOptions = useMemo(() => {
    const names = [...new Set(tasks.map((t) => t.assignee).filter(Boolean))] as string[];
    return names.sort().map((n) => ({ value: n, label: n }));
  }, [tasks]);

  // ── Apply search + filters ──
  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      // Search: check task name (contains brand + "Email Demo" etc.)
      if (search) {
        const q = search.toLowerCase();
        if (!t.name.toLowerCase().includes(q)) return false;
      }
      // Assignee
      if (assigneeFilter && t.assignee !== assigneeFilter) return false;
      // Stage
      if (stageFilter && t.status.toLowerCase() !== stageFilter) return false;
      // Status
      if (statusFilter === "at-risk") {
        const threshold = getStageRiskDays(t.status);
        if (t.bucket === "DEMO_SENT" || t.daysInStage <= threshold) return false;
      }
      if (statusFilter === "on-track") {
        const threshold = getStageRiskDays(t.status);
        if (t.bucket === "DEMO_SENT" || t.daysInStage > threshold) return false;
      }
      return true;
    });
  }, [tasks, search, assigneeFilter, stageFilter, statusFilter]);

  const hasActiveFilters = search || assigneeFilter || stageFilter || statusFilter;

  function clearFilters() {
    setSearch("");
    setAssigneeFilter("");
    setStageFilter("");
    setStatusFilter("");
  }

  // ── Loading / error states ──
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm gap-2">
        <RefreshCw className="w-4 h-4 animate-spin" />
        Loading demos…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full text-destructive text-sm">
        Failed to load demo tasks. Check your ClickUp API token.
      </div>
    );
  }

  const buckets = groupByBucket(filtered, range);

  return (
    <div className="flex flex-col gap-4 h-full">

      {/* ── Header ── */}
      <div className="flex items-start justify-between shrink-0">
        <div>
          <h1
            className="text-2xl font-bold text-foreground leading-tight"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Demo Tracker
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Live production pipeline
          </p>
        </div>
        <div className="flex items-center gap-3">
          {dataUpdatedAt > 0 && (
            <span className="text-xs text-muted-foreground hidden sm:block">
              Synced {formatDistanceToNow(dataUpdatedAt, { addSuffix: true })}
            </span>
          )}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className={cn(
              "flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg",
              "border border-border bg-card hover:bg-muted transition-colors",
              isFetching && "opacity-60 cursor-not-allowed"
            )}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Controls: time range + search + filters ── */}
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <TimeRangeSelector range={range} onChange={setRange} />

        <div className="flex-1 min-w-0" />

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search clients…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={cn(
              "text-xs rounded-lg border border-border bg-card pl-7 pr-3 py-1.5 w-44",
              "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30",
              search && "border-primary/40"
            )}
          />
        </div>

        <FilterSelect
          value={assigneeFilter}
          onChange={setAssigneeFilter}
          options={assigneeOptions}
          placeholder="All assignees"
        />

        <FilterSelect
          value={stageFilter}
          onChange={setStageFilter}
          options={DEMO_STAGE_OPTIONS}
          placeholder="All stages"
        />

        <FilterSelect
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "at-risk",  label: "At risk"  },
            { value: "on-track", label: "On track" },
          ]}
          placeholder="All statuses"
        />

        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3 h-3" />
            Clear
          </button>
        )}
      </div>

      {/* ── Backfill progress banner ── */}
      {!backfillComplete && backfill && (
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/60 border border-border shrink-0">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-xs text-muted-foreground">
                Syncing stage data — metrics update as tasks are processed
              </span>
              <span className="text-xs font-medium text-foreground tabular-nums shrink-0">
                {backfill.synced} / {backfill.total}
              </span>
            </div>
            <div className="h-1 rounded-full bg-border overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${backfillPct}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Metrics strip ── */}
      <DemoKpiStrip tasks={filtered} range={range} links={links} />

      {/* ── Stage heatmap ── */}
      <StageHeatmap tasks={filtered} range={range} />

      {/* ── At-risk alerts ── */}
      <RiskAlerts tasks={filtered} />

      {/* ── Kanban columns ── */}
      <div className="flex gap-4 flex-1 min-h-0 overflow-x-auto">
        <DemoBucketColumn bucket="IN_PROGRESS"     tasks={buckets.IN_PROGRESS}    />
        <DemoBucketColumn bucket="WAITING_TO_SEND" tasks={buckets.WAITING_TO_SEND} />
        <DemoBucketColumn bucket="DEMO_SENT"       tasks={buckets.DEMO_SENT}       links={links} />
      </div>

    </div>
  );
}
