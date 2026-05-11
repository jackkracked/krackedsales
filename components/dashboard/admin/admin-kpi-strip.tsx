"use client";

import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface AdminMetrics {
  cash: number;
  cashPrev: number;
  spend: number;
  calls: number;
  leads: number;
  leadsPrev: number;
}

function safeNum(n: unknown): number {
  return typeof n === "number" && isFinite(n) ? n : 0;
}

function formatCurrency(n: unknown): string {
  const num = safeNum(n);
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
  return `$${num.toFixed(0)}`;
}

function pctChange(current: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((current - prev) / prev) * 100);
}

function Delta({ current, prev }: { current: number; prev: number }) {
  const pct = pctChange(current, prev);
  if (pct === null) return null;

  const up = pct > 0;
  const flat = pct === 0;
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  const color = flat
    ? "text-muted-foreground"
    : up
    ? "text-emerald-500"
    : "text-rose-500";

  return (
    <span className={cn("flex items-center gap-0.5 text-[11px] font-medium tabular-nums", color)}>
      <Icon className="w-3 h-3 shrink-0" />
      {Math.abs(pct)}% vs last month
    </span>
  );
}

function Divider() {
  return <div className="w-px self-stretch bg-border shrink-0" />;
}

function MetricSection({
  label,
  value,
  sub,
  delta,
  accent = false,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  delta?: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="flex-1 px-6 py-4 flex flex-col gap-1 min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "text-2xl font-bold leading-none tabular-nums",
          accent ? "text-primary" : "text-foreground"
        )}
        style={{ fontFamily: "var(--font-heading)" }}
      >
        {value}
      </p>
      <div className="flex items-center gap-2 h-4">
        {sub}
        {delta}
      </div>
    </div>
  );
}

export function AdminKpiStrip() {
  // isPending = status === 'pending' (no data in cache yet, first load only)
  // isError covers the case where both initial fetch + retry failed — without
  // this check, !data flips the strip back to skeleton forever after a failure
  const { data, isPending, isError } = useQuery<AdminMetrics>({
    queryKey: ["admin-metrics"],
    queryFn: async () => {
      const r = await fetch("/api/kpi/admin-metrics");
      if (!r.ok) throw new Error(`admin-metrics ${r.status}`);
      return r.json() as Promise<AdminMetrics>;
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
    placeholderData: (prev) => prev,
  });

  // Three states:
  // 1. isPending — first load, no data yet → skeleton
  // 2. isError && !data — fetches failed, no cached value → show dashes (never stuck skeleton)
  // 3. data exists — show real values
  const showSkeleton = isPending;
  const showDashes = isError && !data;

  return (
    <div className="bg-card border border-border rounded-[10px] flex overflow-hidden">
      {showSkeleton ? (
        <>
          {[0, 1, 2, 3].map((i) => (
            <Fragment key={i}>
              {i > 0 && <Divider />}
              <div className="flex-1 px-6 py-4 flex flex-col gap-2">
                <div className="h-2.5 w-16 rounded animate-pulse" style={{ background: "var(--muted)", opacity: 0.6 }} />
                <div className="h-7 w-24 rounded animate-pulse" style={{ background: "var(--muted)", opacity: 0.6 }} />
                <div className="h-2.5 w-28 rounded animate-pulse" style={{ background: "var(--muted)", opacity: 0.6 }} />
              </div>
            </Fragment>
          ))}
        </>
      ) : (
        <>
          <MetricSection
            label="Cash"
            value={showDashes ? "--" : formatCurrency(data!.cash)}
            sub={
              !showDashes ? (
                <span className="text-[11px] text-muted-foreground">
                  {formatCurrency(data!.spend)} spend
                </span>
              ) : undefined
            }
            delta={!showDashes ? <Delta current={safeNum(data!.cash)} prev={safeNum(data!.cashPrev)} /> : undefined}
            accent
          />
          <Divider />
          <MetricSection
            label="Spend"
            value={showDashes ? "--" : formatCurrency(data!.spend)}
            sub={
              !showDashes ? (
                <span className="text-[11px] text-muted-foreground">monthly recurring</span>
              ) : undefined
            }
          />
          <Divider />
          <MetricSection
            label="Calls"
            value={showDashes ? "--" : safeNum(data!.calls).toLocaleString()}
            sub={
              !showDashes ? (
                <span className="text-[11px] text-muted-foreground">this month</span>
              ) : undefined
            }
          />
          <Divider />
          <MetricSection
            label="Leads"
            value={showDashes ? "--" : safeNum(data!.leads).toLocaleString()}
            delta={!showDashes ? <Delta current={safeNum(data!.leads)} prev={safeNum(data!.leadsPrev)} /> : undefined}
          />
        </>
      )}
    </div>
  );
}
