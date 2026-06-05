"use client";

import { useState } from "react";
import {
  useQueryClient,
  useMutation,
} from "@tanstack/react-query";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Pencil,
  ExternalLink,
  RefreshCw,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils/cn";
import {
  type HealthMetric,
  type DerivedStatus,
  deriveStatus,
} from "./kpi-health-client";

// ─── Value formatting ────────────────────────────────────────────────────────

function formatValue(
  value: number | null,
  unit: HealthMetric["unit"],
): string {
  if (value === null || value === undefined) return "—";

  switch (unit) {
    case "currency":
      if (Math.abs(value) >= 1000) {
        return (
          "$" +
          new Intl.NumberFormat("en-US", {
            maximumFractionDigits: 0,
          }).format(value)
        );
      }
      return "$" + value.toFixed(0);

    case "count":
      return new Intl.NumberFormat("en-US").format(value);

    case "ratio":
      return value.toFixed(1) + "x";

    case "percent":
      return value.toFixed(1) + "%";

    default:
      return String(value);
  }
}

// ─── Status config ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  DerivedStatus,
  {
    icon: typeof CheckCircle2;
    label: string;
    iconClass: string;
    labelClass: string;
    dotClass: string;
  }
> = {
  healthy: {
    icon: CheckCircle2,
    label: "All good",
    iconClass: "text-emerald-500",
    labelClass: "text-emerald-600",
    dotClass: "bg-emerald-500",
  },
  stale: {
    icon: Clock,
    label: "Not checked recently",
    iconClass: "text-amber-500",
    labelClass: "text-amber-600",
    dotClass: "bg-amber-500",
  },
  error: {
    icon: XCircle,
    label: "Problem",
    iconClass: "text-red-500",
    labelClass: "text-red-600",
    dotClass: "bg-red-500",
  },
  override: {
    icon: Pencil,
    label: "Manual value",
    iconClass: "text-blue-500",
    labelClass: "text-blue-600",
    dotClass: "bg-blue-500",
  },
};

// ─── Source system labels ────────────────────────────────────────────────────

function sourceLabel(system: string): string {
  switch (system) {
    case "stripe":
      return "Open in Stripe";
    case "ghl":
      return "Open in GoHighLevel";
    case "meta":
      return "Open in Meta Ads";
    default:
      return "Open source";
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function HealthRow({ metric }: { metric: HealthMetric }) {
  const queryClient = useQueryClient();
  const status = deriveStatus(metric);
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  const [expanded, setExpanded] = useState(false);
  const [showOverrideForm, setShowOverrideForm] = useState(false);
  const [overrideValue, setOverrideValue] = useState("");
  const [overrideNote, setOverrideNote] = useState("");

  // ── Verify mutation ──────────────────────────────────────────────
  const verify = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/kpis/verify/${metric.key}`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Verification failed");
      return res.json() as Promise<{
        key: string;
        verified: boolean;
        currentValue: number;
        sourceValue: number;
        match: boolean;
        error: string | null;
        checkedAt: string;
      }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kpi-health"] });
    },
  });

  // ── Save override mutation ───────────────────────────────────────
  const saveOverride = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/kpi/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metricKey: metric.key,
          period: format(new Date(), "yyyy-MM"),
          value: parseFloat(overrideValue),
          note: overrideNote || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to save override");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kpi-health"] });
      setShowOverrideForm(false);
      setOverrideValue("");
      setOverrideNote("");
    },
  });

  // ── Remove override mutation ─────────────────────────────────────
  const removeOverride = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/kpi/overrides", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metricKey: metric.key,
          period: format(new Date(), "yyyy-MM"),
        }),
      });
      if (!res.ok) throw new Error("Failed to remove override");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kpi-health"] });
    },
  });

  // ── Checked-ago label ────────────────────────────────────────────
  const checkedAgo = metric.lastCheckedAt
    ? `Checked ${formatDistanceToNow(new Date(metric.lastCheckedAt), { addSuffix: true })}`
    : "Never checked";

  return (
    <div className="bg-card border border-border rounded-[10px] p-5">
      {/* ── Top section (always visible) ─────────────────────────── */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-3 w-full text-left"
      >
        {/* Left: status + name */}
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <Icon className={cn("w-5 h-5 shrink-0", config.iconClass)} />
          <span className="font-medium text-foreground truncate">
            {metric.name}
          </span>
          <span
            className={cn(
              "text-xs font-medium shrink-0",
              config.labelClass,
            )}
          >
            {config.label}
          </span>
        </div>

        {/* Right: value + checked ago + chevron */}
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-lg font-semibold tabular-nums text-foreground">
            {formatValue(
              metric.override?.value ?? metric.value,
              metric.unit,
            )}
          </span>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {checkedAgo}
          </span>
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* ── Expandable details ───────────────────────────────────── */}
      {expanded && (
        <div className="mt-4 pt-4 border-t border-border space-y-4">
          {/* What this measures */}
          <div>
            <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground/70 mb-1">
              What this measures
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {metric.whatItMeasures}
            </p>
          </div>

          {/* Where it comes from */}
          <div>
            <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground/70 mb-1">
              Where it comes from
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {metric.whereItComesFrom}
            </p>
          </div>

          {/* Error section */}
          {status === "error" && metric.error && (
            <div className="rounded-lg bg-red-500/5 border border-red-500/10 p-4">
              <p className="text-[10px] font-bold tracking-widest uppercase text-red-600 mb-1">
                What went wrong
              </p>
              <p className="text-sm text-red-600 leading-relaxed">
                {metric.error}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Try clicking "Check now" to re-fetch the value. If the
                problem persists, the source system may be down or your
                connection may need re-authorizing.
              </p>
            </div>
          )}

          {/* Override section */}
          {status === "override" && metric.override && (
            <div className="rounded-lg bg-blue-500/5 border border-blue-500/10 p-4">
              <p className="text-[10px] font-bold tracking-widest uppercase text-blue-600 mb-1">
                This value was set manually
              </p>
              <p className="text-sm text-foreground">
                Override value:{" "}
                <span className="font-semibold">
                  {formatValue(metric.override.value, metric.unit)}
                </span>
              </p>
              {metric.override.note && (
                <p className="text-sm text-muted-foreground mt-1">
                  Reason: {metric.override.note}
                </p>
              )}
              <button
                onClick={() => removeOverride.mutate()}
                disabled={removeOverride.isPending}
                className="mt-3 text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
              >
                {removeOverride.isPending
                  ? "Removing..."
                  : "Remove override"}
              </button>
            </div>
          )}

          {/* ── Action buttons ───────────────────────────────────── */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Check now */}
            <button
              onClick={() => verify.mutate()}
              disabled={verify.isPending}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                "bg-muted text-muted-foreground hover:text-foreground border border-border",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              <RefreshCw
                className={cn(
                  "w-3.5 h-3.5",
                  verify.isPending && "animate-spin",
                )}
              />
              {verify.isPending ? "Checking..." : "Check now"}
            </button>

            {/* Open in source */}
            {metric.sourceUrl && (
              <a
                href={metric.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                  "bg-muted text-muted-foreground hover:text-foreground border border-border",
                )}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                {sourceLabel(metric.sourceSystem)}
              </a>
            )}

            {/* Override value toggle */}
            <button
              onClick={() =>
                setShowOverrideForm((prev) => !prev)
              }
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                "bg-muted text-muted-foreground hover:text-foreground border border-border",
              )}
            >
              <Pencil className="w-3.5 h-3.5" />
              Override value
            </button>
          </div>

          {/* ── Verify result inline ─────────────────────────────── */}
          {verify.isSuccess && verify.data && (
            <div
              className={cn(
                "rounded-lg p-3 text-sm",
                verify.data.match
                  ? "bg-emerald-500/5 border border-emerald-500/10 text-emerald-700"
                  : "bg-amber-500/5 border border-amber-500/10 text-amber-700",
              )}
            >
              {verify.data.match
                ? `Confirmed: ${formatValue(verify.data.currentValue, metric.unit)} matches source`
                : `Mismatch: local is ${formatValue(verify.data.currentValue, metric.unit)}, source is ${formatValue(verify.data.sourceValue, metric.unit)}`}
            </div>
          )}

          {verify.isError && (
            <div className="rounded-lg bg-red-500/5 border border-red-500/10 p-3 text-sm text-red-600">
              Error: {(verify.error as Error).message}
            </div>
          )}

          {/* ── Override form ────────────────────────────────────── */}
          {showOverrideForm && (
            <div className="rounded-lg bg-muted/30 border border-border p-4 space-y-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Value
                </label>
                <input
                  type="number"
                  value={overrideValue}
                  onChange={(e) => setOverrideValue(e.target.value)}
                  placeholder="0"
                  className="h-9 rounded-lg border border-border bg-card px-3 text-sm text-foreground tabular-nums focus:outline-none focus:ring-2 focus:ring-ring w-full"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Reason
                </label>
                <input
                  type="text"
                  value={overrideNote}
                  onChange={(e) => setOverrideNote(e.target.value)}
                  placeholder="Why are you changing this?"
                  className="h-9 rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring w-full"
                />
              </div>
              <button
                onClick={() => saveOverride.mutate()}
                disabled={
                  saveOverride.isPending || !overrideValue
                }
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                  "bg-foreground text-background hover:bg-foreground/90",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                )}
              >
                {saveOverride.isPending
                  ? "Saving..."
                  : "Save override"}
              </button>
              {saveOverride.isError && (
                <p className="text-xs text-red-600">
                  Failed to save override. Please try again.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
