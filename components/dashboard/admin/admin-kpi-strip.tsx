"use client";

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

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
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

function Divider() {
  return <div className="w-px self-stretch bg-border shrink-0" />;
}

function StripSkeleton() {
  return (
    <div className="bg-card border border-border rounded-[10px] flex overflow-hidden">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="contents">
          {i > 0 && <Divider />}
          <div className="flex-1 px-6 py-4 flex flex-col gap-2">
            <div className="h-2.5 w-16 bg-muted/60 rounded animate-pulse" />
            <div className="h-7 w-24 bg-muted/60 rounded animate-pulse" />
            <div className="h-2.5 w-28 bg-muted/60 rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function AdminKpiStrip() {
  const { data, isLoading, isError } = useQuery<AdminMetrics>({
    queryKey: ["admin-metrics"],
    queryFn: async () => {
      const r = await fetch("/api/kpi/admin-metrics");
      if (!r.ok) throw new Error(`admin-metrics ${r.status}`);
      return r.json();
    },
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });

  if (isLoading) return <StripSkeleton />;

  if (isError || !data) {
    return (
      <div className="bg-card border border-border rounded-[10px] flex overflow-hidden">
        <div className="flex-1 px-6 py-4 text-xs text-muted-foreground">
          Could not load metrics — retrying…
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-[10px] flex overflow-hidden">
      <MetricSection
        label="Cash"
        value={formatCurrency(data.cash)}
        sub={
          <span className="text-[11px] text-muted-foreground">
            {formatCurrency(data.spend)} spend
          </span>
        }
        delta={<Delta current={data.cash} prev={data.cashPrev} />}
        accent
      />
      <Divider />
      <MetricSection
        label="Spend"
        value={formatCurrency(data.spend)}
        sub={
          <span className="text-[11px] text-muted-foreground">monthly recurring</span>
        }
      />
      <Divider />
      <MetricSection
        label="Calls"
        value={data.calls.toLocaleString()}
        sub={
          <span className="text-[11px] text-muted-foreground">this month</span>
        }
      />
      <Divider />
      <MetricSection
        label="Leads"
        value={data.leads.toLocaleString()}
        delta={<Delta current={data.leads} prev={data.leadsPrev} />}
      />
    </div>
  );
}
