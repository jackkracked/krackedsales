"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { useDemoTasks } from "@/lib/hooks/use-demo-tasks";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  AreaChart,
  Area,
  CartesianGrid,
  LabelList,
} from "recharts";
import {
  subDays,
  format,
  startOfDay,
  endOfDay,
  startOfWeek,
  startOfMonth,
  startOfQuarter,
} from "date-fns";
import { cn } from "@/lib/utils/cn";
import { useUserTimezone } from "@/providers/timezone-provider";
import { toZonedDate } from "@/lib/utils/timezone";
import { RefreshCw, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { DonutChart } from "@/components/ui/donut-chart";
import type { EnrichedTask } from "@/app/api/clickup/tasks/route";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Period = "today" | "week" | "month" | "quarter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPeriodStart(period: Period): Date {
  const now = new Date();
  switch (period) {
    case "today":
      return startOfDay(now);
    case "week":
      return startOfWeek(now, { weekStartsOn: 1 });
    case "month":
      return startOfMonth(now);
    case "quarter":
      return startOfQuarter(now);
  }
}

function getPeriodDays(period: Period): number {
  return { today: 1, week: 7, month: 30, quarter: 90 }[period];
}

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------

interface StatCardProps {
  label: string;
  value: number | string;
  subtitle?: string;
  trend?: { value: string; up: boolean | null };
  accent?: "default" | "gold" | "green" | "red";
}

function StatCard({ label, value, subtitle, trend, accent = "default" }: StatCardProps) {
  const valueColor =
    accent === "gold"
      ? "text-gold"
      : accent === "green"
      ? "text-accent-green"
      : accent === "red"
      ? "text-destructive"
      : "text-foreground";

  const TrendIcon =
    trend?.up === true ? TrendingUp : trend?.up === false ? TrendingDown : Minus;
  const trendColor =
    trend?.up === true
      ? "text-accent-green"
      : trend?.up === false
      ? "text-destructive"
      : "text-muted-foreground";

  return (
    <div data-r10n-analytics-card className="bg-card border border-border rounded-[10px] p-4">
      <p
        data-r10n-analytics-metric-label
        className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2"
      >
        {label}
      </p>
      <p
        data-r10n-analytics-metric-value
        data-accent={accent}
        className={cn("text-3xl font-bold leading-none", valueColor)}
        style={{ fontFamily: "var(--font-heading)" }}
      >
        {value}
      </p>
      {(subtitle || trend) && (
        <div className="flex items-center gap-2 mt-1.5">
          {trend && (
            <span
              data-r10n-analytics-trend
              data-dir={trend.up === true ? "up" : trend.up === false ? "down" : "flat"}
              className={cn("flex items-center gap-0.5 text-xs font-medium", trendColor)}
            >
              <TrendIcon className="w-3 h-3" />
              {trend.value}
            </span>
          )}
          {subtitle && (
            <span data-r10n-analytics-metric-sub className="text-xs text-muted-foreground">
              {subtitle}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// useAnalytics
// ---------------------------------------------------------------------------

function useAnalytics(tasks: EnrichedTask[], period: Period, tz: string) {
  return useMemo(() => {
    const periodStart = getPeriodStart(period);
    const days = getPeriodDays(period);
    const prevPeriodStart = subDays(periodStart, days);

    const inPeriod = tasks.filter((t) => new Date(t.dateCreated) >= periodStart);
    const prevPeriod = tasks.filter((t) => {
      const d = new Date(t.dateCreated);
      return d >= prevPeriodStart && d < periodStart;
    });

    const demosRequested = inPeriod.length;
    const prevDemosRequested = prevPeriod.length;

    const demosSent = inPeriod.filter((t) => t.bucket === "DEMO_SENT").length;
    const prevDemosSent = prevPeriod.filter((t) => t.bucket === "DEMO_SENT").length;

    const inProgress = tasks.filter((t) => t.bucket === "IN_PROGRESS").length;
    const waitingToSend = tasks.filter((t) => t.bucket === "WAITING_TO_SEND").length;

    // Fulfillment rate: demos sent / demos requested in period
    const fulfillmentRate =
      demosRequested > 0 ? Math.round((demosSent / demosRequested) * 100) : 0;

    // Average turnaround for DEMO_SENT tasks (creation → last update)
    const sentTasks = tasks.filter((t) => t.bucket === "DEMO_SENT");
    const avgTurnaround =
      sentTasks.length > 0
        ? (
            sentTasks.reduce((sum, t) => {
              const d = Math.max(
                0,
                Math.floor(
                  (new Date(t.dateUpdated).getTime() - new Date(t.dateCreated).getTime()) /
                    86400000
                )
              );
              return sum + d;
            }, 0) / sentTasks.length
          ).toFixed(1)
        : "—";

    // Area chart: demos requested + demos sent per day (last N days, max 30)
    const barDays = Math.min(days, 30);
    const barData = Array.from({ length: barDays }).map((_, i) => {
      const day = subDays(new Date(), barDays - 1 - i);
      const ds = startOfDay(day).getTime();
      const de = endOfDay(day).getTime();
      const count = tasks.filter((t) => {
        const c = new Date(t.dateCreated).getTime();
        return c >= ds && c <= de;
      }).length;
      const sent = tasks.filter((t) => {
        const u = new Date(t.dateUpdated).getTime();
        return t.bucket === "DEMO_SENT" && u >= ds && u <= de;
      }).length;
      return {
        label: format(toZonedDate(day, tz), barDays <= 14 ? "dd MMM" : "dd/MM"),
        count,
        sent,
        dayName: format(day, "EEEE"),
      };
    });

    // Day-of-week breakdown
    const dayOfWeek = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, i) => ({
      day,
      count: tasks.filter((t) => {
        const d = new Date(t.dateCreated).getDay();
        return d === (i + 1) % 7;
      }).length,
    }));

    const peakDay = dayOfWeek.reduce(
      (max, d) => (d.count > max.count ? d : max),
      dayOfWeek[0]
    );

    // Requested trend vs previous period
    const trend =
      demosRequested > prevDemosRequested
        ? "up"
        : demosRequested < prevDemosRequested
        ? "down"
        : "flat";
    const trendPct =
      prevDemosRequested > 0
        ? Math.round(
            (Math.abs(demosRequested - prevDemosRequested) / prevDemosRequested) * 100
          )
        : 0;

    // Sent trend vs previous period
    const sentTrend =
      demosSent > prevDemosSent ? "up" : demosSent < prevDemosSent ? "down" : "flat";
    const sentTrendPct =
      prevDemosSent > 0
        ? Math.round((Math.abs(demosSent - prevDemosSent) / prevDemosSent) * 100)
        : 0;

    return {
      demosRequested,
      demosSent,
      inProgress,
      waitingToSend,
      avgTurnaround,
      barData,
      dayOfWeek,
      peakDay,
      trend,
      trendPct,
      sentTrend,
      sentTrendPct,
      fulfillmentRate,
      total: tasks.length,
    };
  }, [tasks, period, tz]);
}

// ---------------------------------------------------------------------------
// Tooltip style
// ---------------------------------------------------------------------------

const TOOLTIP_STYLE = {
  fontSize: 11,
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--card)",
  color: "var(--foreground)",
  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
};

// ---------------------------------------------------------------------------
// AnalyticsClient
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// MarketingEfficiencyCard
// ---------------------------------------------------------------------------

interface MetaAdsData {
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  leads: number;
  cpl: number | null;
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-GB");
}

function MarketingEfficiencyCard({
  period,
  demosRequested,
  fulfillmentRate,
}: {
  period: Period;
  demosRequested: number;
  fulfillmentRate: number;
}) {
  const { data: adsData, isLoading: adsLoading } = useQuery<MetaAdsData>({
    queryKey: ["meta-ads", period],
    queryFn: async () => {
      const res = await fetch(`/api/meta/ads?period=${period}`);
      if (!res.ok) throw new Error("Failed to fetch Meta ads data");
      return res.json();
    },
  });

  const allZero =
    adsData &&
    adsData.spend === 0 &&
    adsData.impressions === 0 &&
    adsData.clicks === 0 &&
    adsData.reach === 0 &&
    adsData.leads === 0;

  const rows: { label: string; value: string; highlight?: boolean }[] = adsData
    ? [
        {
          label: "Ad Spend",
          value: adsData.spend > 0 ? `$${adsData.spend.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—",
          highlight: true,
        },
        {
          label: "Impressions",
          value: adsData.impressions > 0 ? formatNumber(adsData.impressions) : "—",
        },
        {
          label: "Clicks",
          value: adsData.clicks > 0 ? formatNumber(adsData.clicks) : "—",
        },
        {
          label: "Reach",
          value: adsData.reach > 0 ? formatNumber(adsData.reach) : "—",
        },
        {
          label: "Leads from ads",
          value: adsData.leads > 0 ? formatNumber(adsData.leads) : "—",
        },
        {
          label: "Cost per Lead",
          value: adsData.cpl != null && adsData.cpl > 0 ? `$${adsData.cpl.toFixed(2)}` : "—",
          highlight: true,
        },
        {
          label: "Demos requested",
          value: String(demosRequested),
        },
        {
          label: "Lead → Demo rate",
          value: `${fulfillmentRate}%`,
        },
      ]
    : [];

  return (
    <div data-r10n-analytics-card className="bg-card border border-border rounded-[10px] p-5">
      <h3
        data-r10n-analytics-chart-title
        className="text-sm font-semibold text-foreground mb-4"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        Marketing efficiency
      </h3>

      {adsLoading ? (
        <div className="space-y-2.5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-4 bg-muted rounded animate-pulse" />
          ))}
        </div>
      ) : allZero ? (
        <div data-r10n-analytics-empty className="flex items-start gap-2 py-3 text-muted-foreground">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="text-xs">Connect Meta Ads to see live data</p>
        </div>
      ) : (
        <div className="space-y-0">
          {rows.map(({ label, value, highlight }) => (
            <div
              key={label}
              data-r10n-analytics-row
              className="flex items-center justify-between py-2 border-b border-border last:border-0"
            >
              <span data-r10n-analytics-row-label className="text-sm text-muted-foreground">
                {label}
              </span>
              <span
                data-r10n-analytics-row-value
                data-highlight={highlight && value !== "—" ? "true" : "false"}
                className={cn(
                  "text-sm font-semibold",
                  highlight && value !== "—" ? "text-gold" : "text-foreground"
                )}
              >
                {value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommentLeadsSection
// ---------------------------------------------------------------------------

interface CommentLeadsData {
  total: number;
  facebook: number;
  instagram: number;
  chartData: { label: string; facebook: number; instagram: number; total: number }[];
  topKeywords: { keyword: string; count: number }[];
}

function CommentLeadsSection({ period }: { period: Period }) {
  const { data, isLoading } = useQuery<CommentLeadsData>({
    queryKey: ["comment-leads", period],
    queryFn: async () => {
      const res = await fetch(`/api/comment-leads?period=${period}`);
      if (!res.ok) throw new Error("Failed to fetch comment leads");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-[10px] p-5">
        <div className="h-4 w-40 bg-muted rounded animate-pulse mb-4" />
        <div className="h-32 bg-muted rounded animate-pulse" />
      </div>
    );
  }

  if (!data) return null;

  const hasData = data.total > 0;

  return (
    <div className="space-y-4">
      {/* Section header */}
      <h2
        data-r10n-analytics-section-title
        className="text-base font-semibold text-foreground"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        Social comment leads
      </h2>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total triggers" value={data.total} accent="default" />
        <StatCard label="Facebook" value={data.facebook} accent="default" />
        <StatCard label="Instagram" value={data.instagram} accent="default" />
      </div>

      {/* Chart + keywords */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Chart — takes 2 cols */}
        <div data-r10n-analytics-card className="lg:col-span-2 bg-card border border-border rounded-[10px] p-5">
          <h3
            data-r10n-analytics-chart-title
            className="text-sm font-semibold text-foreground mb-4"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Trigger word comments over time
          </h3>
          {!hasData ? (
            <div data-r10n-analytics-empty className="flex items-center gap-2 py-6 text-muted-foreground">
              <Info className="w-4 h-4 shrink-0" />
              <p className="text-xs">No trigger word comments in this period yet.</p>
            </div>
          ) : (
            <div data-r10n-analytics-chart>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={data.chartData} barSize={12} margin={{ top: 8, right: 4, bottom: 0, left: -16 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    tickLine={false}
                    axisLine={false}
                    width={24}
                    allowDecimals={false}
                  />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--muted)" }} />
                  <Bar dataKey="facebook" name="Facebook" fill="var(--r10n-chart-fb, #1877F2)" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="instagram" name="Instagram" fill="var(--r10n-chart-ig, #E1306C)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {/* Legend */}
          {hasData && (
            <div data-r10n-analytics-legend className="flex items-center gap-4 mt-2">
              <span data-r10n-analytics-legend-item className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  data-r10n-analytics-swatch
                  data-series="fb"
                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: "var(--r10n-chart-fb, #1877F2)" }}
                />
                Facebook
              </span>
              <span data-r10n-analytics-legend-item className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  data-r10n-analytics-swatch
                  data-series="ig"
                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: "var(--r10n-chart-ig, #E1306C)" }}
                />
                Instagram
              </span>
            </div>
          )}
        </div>

        {/* Top keywords */}
        <div data-r10n-analytics-card className="bg-card border border-border rounded-[10px] p-5">
          <h3
            data-r10n-analytics-chart-title
            className="text-sm font-semibold text-foreground mb-4"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Top trigger words
          </h3>
          {data.topKeywords.length === 0 ? (
            <p data-r10n-analytics-empty className="text-xs text-muted-foreground">No data yet.</p>
          ) : (
            <div className="space-y-0">
              {data.topKeywords.map(({ keyword, count }) => (
                <div
                  key={keyword}
                  data-r10n-analytics-row
                  className="flex items-center justify-between py-2 border-b border-border last:border-0"
                >
                  <span data-r10n-analytics-keyword className="text-sm text-muted-foreground font-mono truncate pr-2">
                    {keyword}
                  </span>
                  <span data-r10n-analytics-row-value className="text-sm font-semibold text-foreground shrink-0">{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AnalyticsClient
// ---------------------------------------------------------------------------

export function AnalyticsClient() {
  const tz = useUserTimezone();
  const [period, setPeriod] = useState<Period>("week");
  const { data, isLoading, isFetching } = useDemoTasks();
  const tasks = data?.tasks ?? [];
  const stats = useAnalytics(tasks, period, tz);

  const PERIODS: { key: Period; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "week", label: "This Week" },
    { key: "month", label: "This Month" },
    { key: "quarter", label: "This Quarter" },
  ];

  const allDemosSent = tasks.filter((t) => t.bucket === "DEMO_SENT").length;

  // Under r10n these map to the obsidian/steel/lime ramp via inline var fallbacks;
  // default theme keeps the original navy/sand/green literals.
  const donutSegments = [
    { label: "In Progress", value: stats.inProgress, color: "var(--r10n-chart-segment-1, #0F3A5C)" },
    { label: "Waiting to Send", value: stats.waitingToSend, color: "var(--r10n-chart-segment-2, #D4A574)" },
    { label: "Demo Sent", value: allDemosSent, color: "var(--r10n-chart-segment-3, #2D5E3F)" },
  ].filter((s) => s.value > 0);

  if (isLoading) {
    return (
      <div data-r10n-analytics-loading className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        <RefreshCw className="w-4 h-4 animate-spin mr-2" />
        Loading analytics…
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* 1 — Period selector */}
      <div data-r10n-analytics-periods className="flex items-center gap-1 bg-muted rounded-lg p-1 w-fit">
        {PERIODS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setPeriod(key)}
            data-r10n-analytics-period
            data-active={period === key ? "true" : "false"}
            className={cn(
              "px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
              period === key
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
        {isFetching && (
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-foreground ml-2" />
        )}
      </div>

      {/* 2 — KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Demos Requested"
          value={stats.demosRequested}
          trend={{
            value: `${stats.trendPct}% vs prev period`,
            up:
              stats.trend === "up" ? true : stats.trend === "down" ? false : null,
          }}
        />
        <StatCard
          label="Demos Sent"
          value={stats.demosSent}
          trend={{
            value: `${stats.sentTrendPct}% vs prev period`,
            up:
              stats.sentTrend === "up"
                ? true
                : stats.sentTrend === "down"
                ? false
                : null,
          }}
          accent="green"
        />
        <StatCard
          label="Fulfillment Rate"
          value={`${stats.fulfillmentRate}%`}
          subtitle="of demos completed"
          accent="gold"
        />
        <StatCard
          label="Avg Turnaround"
          value={`${stats.avgTurnaround}d`}
          subtitle="creation → sent"
          accent="green"
        />
      </div>

      {/* 3 — Full-width gradient area chart */}
      <div data-r10n-analytics-card className="bg-card border border-border rounded-[10px] p-5">
        <h3
          data-r10n-analytics-chart-title
          className="text-sm font-semibold text-foreground mb-4"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Demo volume over time
        </h3>
        <div data-r10n-analytics-chart>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={stats.barData} margin={{ top: 8, right: 4, bottom: 0, left: -16 }}>
              <defs>
                {/* The line is the single accent: lime under r10n, navy by default. */}
                <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--r10n-chart-line, #0F3A5C)" stopOpacity={0.12} />
                  <stop offset="100%" stopColor="var(--r10n-chart-line, #0F3A5C)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                vertical={false}
                stroke="var(--border)"
                strokeDasharray="3 3"
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                interval={Math.max(0, Math.floor(stats.barData.length / 7) - 1)}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                width={28}
                allowDecimals={false}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: "var(--border)" }} />
              <Area
                type="monotone"
                dataKey="count"
                name="Demos requested"
                stroke="var(--r10n-chart-line, var(--primary))"
                strokeWidth={2}
                fill="url(#areaGradient)"
                dot={false}
                activeDot={{ r: 4, fill: "var(--r10n-chart-line, #0F3A5C)", strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 4 — Donut + Pipeline summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Left — Animated donut */}
        <div data-r10n-analytics-card data-r10n-analytics-donut className="bg-card border border-border rounded-[10px] p-5">
          <h3
            data-r10n-analytics-chart-title
            className="text-sm font-semibold text-foreground mb-4"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Pipeline breakdown
          </h3>
          {donutSegments.length > 0 ? (
            <DonutChart segments={donutSegments} />
          ) : (
            <p data-r10n-analytics-empty className="text-xs text-muted-foreground">No data yet.</p>
          )}
        </div>

        {/* Right — Pipeline summary table */}
        <div data-r10n-analytics-card className="bg-card border border-border rounded-[10px] p-5">
          <h3
            data-r10n-analytics-chart-title
            className="text-sm font-semibold text-foreground mb-4"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Pipeline summary
          </h3>
          <div className="space-y-0">
            {[
              { label: "Total demos in system", value: stats.total },
              { label: "In Progress", value: stats.inProgress, color: "text-primary" },
              { label: "Waiting to Send", value: stats.waitingToSend, color: "text-gold" },
              {
                label: "Demo Sent",
                value: allDemosSent,
                color: "text-accent-green",
              },
              { label: "Avg turnaround time", value: `${stats.avgTurnaround}d` },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                data-r10n-analytics-row
                className="flex items-center justify-between py-2 border-b border-border last:border-0"
              >
                <span data-r10n-analytics-row-label className="text-sm text-muted-foreground">{label}</span>
                <span data-r10n-analytics-row-value className={cn("text-sm font-semibold text-foreground", color)}>
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 5 — Day of week + Marketing efficiency */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Left — Day of week bar chart */}
        <div data-r10n-analytics-card className="bg-card border border-border rounded-[10px] p-5 flex flex-col">
          <h3
            data-r10n-analytics-chart-title
            className="text-sm font-semibold text-foreground mb-1 shrink-0"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Demos by day of week
            {stats.peakDay.count > 0 && (
              <span data-r10n-analytics-peak className="ml-2 text-xs font-normal text-muted-foreground">
                — peak: {stats.peakDay.day} ({stats.peakDay.count})
              </span>
            )}
          </h3>
          <div data-r10n-analytics-chart className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={stats.dayOfWeek}
                barSize={32}
                margin={{ top: 16, right: 0, bottom: 0, left: 0 }}
              >
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  height={28}
                />
                <YAxis hide allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--muted)" }} />
                <Bar dataKey="count" name="Demos" radius={[4, 4, 0, 0]}>
                  <LabelList
                    dataKey="count"
                    position="top"
                    style={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  />
                  {/* Default: navy bars dimmed by opacity, peak full. Under r10n the
                      peak bar claims the lime accent while the rest stay obsidian. */}
                  {stats.dayOfWeek.map((entry, i) => {
                    const isPeak = entry.day === stats.peakDay.day && entry.count > 0;
                    return (
                      <Cell
                        key={i}
                        fill={
                          isPeak
                            ? "var(--r10n-chart-bar-peak, var(--primary))"
                            : "var(--r10n-chart-bar, var(--primary))"
                        }
                        opacity={
                          entry.count === 0 ? 0.12
                          : isPeak ? 1
                          : 0.55
                        }
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right — Marketing efficiency (live Meta Ads data) */}
        <MarketingEfficiencyCard
          period={period}
          demosRequested={stats.demosRequested}
          fulfillmentRate={stats.fulfillmentRate}
        />
      </div>

      {/* 6 — Comment leads section */}
      <div data-r10n-analytics-divider className="border-t border-border pt-6">
        <CommentLeadsSection period={period} />
      </div>
    </div>
  );
}
