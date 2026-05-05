"use client";

import { useMemo } from "react";
import { subWeeks, startOfWeek, endOfWeek } from "date-fns";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils/cn";
import type { EnrichedTask } from "@/app/api/clickup/tasks/route";
import type { DemoLinkData } from "@/app/api/demo-tracker/ghl-links/route";
import { getTimeRangeStart, type TimeRange } from "@/lib/utils/time-range";

interface MetricsStripProps {
  tasks: EnrichedTask[];
  range: TimeRange;
  links?: Record<string, DemoLinkData>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function sentInRange(tasks: EnrichedTask[], range: TimeRange): EnrichedTask[] {
  const start = getTimeRangeStart(range);
  return tasks.filter((t) => {
    if (t.bucket !== "DEMO_SENT" || !t.dateSent) return false;
    if (!start) return true;
    return new Date(t.dateSent) >= start;
  });
}

function daysBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24);
}

// ─── Metric card ───────────────────────────────────────────────────────────────

interface MetricCardProps {
  label: string;
  value: string | number;
  sub?: React.ReactNode;
  accent?: boolean;
  sparkline?: number[]; // weekly throughput values — renders a chart on the right
}

function MetricCard({ label, value, sub, accent, sparkline }: MetricCardProps) {
  const hasChart = sparkline && sparkline.length >= 2;
  const chartData = hasChart ? sparkline.map((v) => ({ v })) : [];

  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-1 min-w-0">
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider truncate">
        {label}
      </p>

      {/* Value row: number on left, chart on right (when sparkline present) */}
      <div className="flex items-end justify-between gap-2 min-h-[52px]">
        <div className="flex flex-col justify-end gap-1">
          <p className={cn(
            "text-2xl font-bold leading-none tabular-nums",
            accent ? "text-primary" : "text-foreground"
          )}>
            {value}
          </p>
          {sub && <div>{sub}</div>}
        </div>

        {hasChart && (
          <div className="w-[45%] h-14 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="demo-spark-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}    />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke="#3b82f6"
                  strokeWidth={1.5}
                  fill="url(#demo-spark-fill)"
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Fulfillment breakdown bar ──────────────────────────────────────────────────

interface Bucket { label: string; pct: number; color: string }

function FulfillmentBar({ buckets }: { buckets: Bucket[] }) {
  return (
    <div className="flex flex-col gap-1.5 mt-0.5">
      <div className="flex h-1.5 rounded-full overflow-hidden gap-px">
        {buckets.filter((b) => b.pct > 0).map((b) => (
          <div key={b.label} className={cn("h-full", b.color)} style={{ width: `${b.pct}%` }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
        {buckets.map((b) => (
          <span key={b.label} className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className={cn("w-1.5 h-1.5 rounded-sm shrink-0", b.color)} />
            {b.label} {b.pct}%
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────────

export function DemoKpiStrip({ tasks, range, links = {} }: MetricsStripProps) {
  const stats = useMemo(() => {
    const sent = sentInRange(tasks, range);
    const demosSent = sent.length;

    const inQueue =
      tasks.filter((t) => t.bucket === "IN_PROGRESS" || t.bucket === "WAITING_TO_SEND").length;

    // Avg fulfillment (range-scoped): dateSent - dateCreated for tasks sent in the selected period.
    // sentInRange already guarantees dateSent != null.
    const avgFulfillment =
      sent.length > 0
        ? (
            sent.reduce((sum, t) => {
              return sum + (new Date(t.dateSent!).getTime() - new Date(t.dateCreated).getTime());
            }, 0) / sent.length / (1000 * 60 * 60 * 24)
          ).toFixed(1)
        : null;

    // Fulfillment breakdown buckets — range-scoped (same period as Demos Sent)
    const breakdown = sent.length > 0
      ? {
          lt3:   Math.round((sent.filter((t) => daysBetween(t.dateCreated, t.dateSent!) <  3).length / sent.length) * 100),
          d3_7:  Math.round((sent.filter((t) => { const d = daysBetween(t.dateCreated, t.dateSent!); return d >= 3  && d < 7;  }).length / sent.length) * 100),
          d7_14: Math.round((sent.filter((t) => { const d = daysBetween(t.dateCreated, t.dateSent!); return d >= 7  && d < 14; }).length / sent.length) * 100),
          gt14:  Math.round((sent.filter((t) => daysBetween(t.dateCreated, t.dateSent!) >= 14).length / sent.length) * 100),
        }
      : null;

    // All DEMO_SENT tasks with dateSent — used for sparklines only (need full history for 8-week chart)
    const allSentWithDate = tasks.filter((t) => t.bucket === "DEMO_SENT" && t.dateSent != null);

    const now = new Date();

    // Helper: week boundaries for 8w sparklines
    const weeks = Array.from({ length: 8 }, (_, i) => {
      const weekStart = startOfWeek(subWeeks(now, 7 - i), { weekStartsOn: 1 });
      return { weekStart, weekEnd: endOfWeek(weekStart, { weekStartsOn: 1 }) };
    });

    // Demos sent per week (throughput sparkline)
    const weeklyThroughput = weeks.map(({ weekStart, weekEnd }) =>
      allSentWithDate.filter((t) => {
        const d = new Date(t.dateSent!);
        return d >= weekStart && d <= weekEnd;
      }).length
    );

    // New demos created per week (In Queue trend — pipeline intake)
    const weeklyCreated = weeks.map(({ weekStart, weekEnd }) =>
      tasks.filter((t) => {
        const d = new Date(t.dateCreated);
        return d >= weekStart && d <= weekEnd;
      }).length
    );

    // Avg fulfillment days per week
    const weeklyFulfillment = weeks.map(({ weekStart, weekEnd }) => {
      const w = allSentWithDate.filter((t) => {
        const d = new Date(t.dateSent!);
        return d >= weekStart && d <= weekEnd;
      });
      if (w.length === 0) return 0;
      return w.reduce((sum, t) =>
        sum + (new Date(t.dateSent!).getTime() - new Date(t.dateCreated).getTime()), 0
      ) / w.length / (1000 * 60 * 60 * 24);
    });

    // Demo → Call metrics from GHL links (range-filtered)
    const linkedKeys = Object.keys(links);
    const linkedSent = sent.filter((t) => linkedKeys.includes(t.id));
    const bookedLinks = linkedSent.filter((t) => links[t.id]?.callStatus === "booked");

    const avgDemoToCall =
      bookedLinks.length > 0
        ? (bookedLinks.reduce((sum, t) => sum + (links[t.id]?.daysToCall ?? 0), 0) / bookedLinks.length).toFixed(1)
        : null;

    const callBookingRate =
      linkedSent.length > 0
        ? Math.round((bookedLinks.length / linkedSent.length) * 100)
        : null;

    // Avg days to call per week
    const weeklyDaysToCall = weeks.map(({ weekStart, weekEnd }) => {
      const w = bookedLinks.filter((t) => {
        const d = new Date(t.dateSent!);
        return d >= weekStart && d <= weekEnd;
      });
      if (w.length === 0) return 0;
      return w.reduce((sum, t) => sum + (links[t.id]?.daysToCall ?? 0), 0) / w.length;
    });

    // Booking rate % per week
    const weeklyBookingRate = weeks.map(({ weekStart, weekEnd }) => {
      const w = linkedSent.filter((t) => {
        const d = new Date(t.dateSent!);
        return d >= weekStart && d <= weekEnd;
      });
      if (w.length === 0) return 0;
      const booked = w.filter((t) => links[t.id]?.callStatus === "booked");
      return (booked.length / w.length) * 100;
    });

    return {
      demosSent, inQueue, avgFulfillment, breakdown,
      weeklyThroughput, weeklyCreated, weeklyFulfillment,
      weeklyDaysToCall, weeklyBookingRate,
      avgDemoToCall, callBookingRate,
      hasLinkData: linkedKeys.length > 0,
    };
  }, [tasks, range, links]);

  const breakdownBuckets: Bucket[] = stats.breakdown
    ? [
        { label: "<3d",   pct: stats.breakdown.lt3,   color: "bg-emerald-500" },
        { label: "3–7d",  pct: stats.breakdown.d3_7,  color: "bg-amber-400"  },
        { label: "7–14d", pct: stats.breakdown.d7_14, color: "bg-orange-500" },
        { label: "14d+",  pct: stats.breakdown.gt14,  color: "bg-destructive" },
      ]
    : [];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 shrink-0">

      <MetricCard
        label="Demos Sent"
        value={stats.demosSent}
        accent
        sparkline={stats.weeklyThroughput}
      />

      <MetricCard
        label="In Queue"
        value={stats.inQueue}
        sparkline={stats.weeklyCreated}
      />

      <MetricCard
        label="Avg Fulfillment"
        value={stats.avgFulfillment != null ? `${stats.avgFulfillment}d` : "—"}
        sparkline={stats.weeklyFulfillment}
      />

      <MetricCard
        label="Fulfillment Split"
        value={stats.breakdown ? `${stats.breakdown.lt3}% fast` : "—"}
        sub={stats.breakdown ? <FulfillmentBar buckets={breakdownBuckets} /> : null}
      />

      <MetricCard
        label="Avg Demo → Call"
        value={stats.avgDemoToCall != null ? `${stats.avgDemoToCall}d` : "—"}
        sparkline={stats.hasLinkData ? stats.weeklyDaysToCall : undefined}
        sub={!stats.hasLinkData ? <span className="text-[10px] text-muted-foreground">Linking to GHL…</span> : null}
      />

      <MetricCard
        label="Call Booking Rate"
        value={stats.callBookingRate != null ? `${stats.callBookingRate}%` : "—"}
        sparkline={stats.hasLinkData ? stats.weeklyBookingRate : undefined}
        sub={!stats.hasLinkData ? <span className="text-[10px] text-muted-foreground">Linking to GHL…</span> : null}
      />

    </div>
  );
}
