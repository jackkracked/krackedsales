"use client";

import { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from "recharts";
import { subDays, format, startOfDay, endOfDay, startOfWeek, startOfMonth, startOfQuarter } from "date-fns";
import type { EnrichedTask } from "@/app/api/clickup/tasks/route";
import { cn } from "@/lib/utils/cn";

type Period = "today" | "week" | "month" | "quarter";

const BUCKET_COLORS = {
  IN_PROGRESS: "#0F3A5C",
  WAITING_TO_SEND: "#D4A574",
  DEMO_SENT: "#2D5E3F",
};

function getPeriodStart(period: Period): Date {
  const now = new Date();
  switch (period) {
    case "today": return startOfDay(now);
    case "week": return startOfWeek(now, { weekStartsOn: 1 }); // Mon
    case "month": return startOfMonth(now);
    case "quarter": return startOfQuarter(now);
  }
}

interface AnalyticsPanelProps {
  tasks: EnrichedTask[];
}

export function AnalyticsPanel({ tasks }: AnalyticsPanelProps) {
  const [period, setPeriod] = useState<Period>("week");

  const stats = useMemo(() => {
    const periodStart = getPeriodStart(period);

    // "In period" = demos SENT (date_closed) in the period, not created
    const inPeriod = tasks.filter(
      (t) => t.bucket === "DEMO_SENT" && t.dateSent != null && new Date(t.dateSent) >= periodStart
    ).length;

    // Bar chart: demos SENT per day (uses dateSent = date_closed)
    const barDays = period === "today" ? 7 : period === "week" ? 14 : period === "month" ? 30 : 90;
    const barData = Array.from({ length: Math.min(barDays, 30) }).map((_, i) => {
      const day = subDays(new Date(), Math.min(barDays, 30) - 1 - i);
      const label = format(day, barDays <= 14 ? "dd MMM" : "dd MMM");
      const dayStart = startOfDay(day).getTime();
      const dayEnd = endOfDay(day).getTime();
      const count = tasks.filter((t) => {
        if (t.bucket !== "DEMO_SENT" || !t.dateSent) return false;
        const sent = new Date(t.dateSent).getTime();
        return sent >= dayStart && sent <= dayEnd;
      }).length;
      return { label, count };
    });

    // Donut: stage distribution
    const byBucket = {
      IN_PROGRESS: tasks.filter((t) => t.bucket === "IN_PROGRESS").length,
      WAITING_TO_SEND: tasks.filter((t) => t.bucket === "WAITING_TO_SEND").length,
      DEMO_SENT: tasks.filter((t) => t.bucket === "DEMO_SENT").length,
    };

    const donutData = [
      { name: "In Progress", value: byBucket.IN_PROGRESS, color: BUCKET_COLORS.IN_PROGRESS },
      { name: "Waiting", value: byBucket.WAITING_TO_SEND, color: BUCKET_COLORS.WAITING_TO_SEND },
      { name: "Demo Sent", value: byBucket.DEMO_SENT, color: BUCKET_COLORS.DEMO_SENT },
    ].filter((d) => d.value > 0);

    // Slowest active demos
    const slowest = [...tasks]
      .filter((t) => t.bucket === "IN_PROGRESS")
      .sort((a, b) => b.daysInStage - a.daysInStage)
      .slice(0, 3);

    // Average turnaround: dateSent (date_closed) minus dateCreated — accurate production time
    const sentTasks = tasks.filter((t) => t.bucket === "DEMO_SENT" && t.dateSent != null);
    const avgTurnaround = sentTasks.length > 0
      ? Math.round(
          sentTasks.reduce((sum, t) => {
            const days = Math.floor(
              (new Date(t.dateSent!).getTime() - new Date(t.dateCreated).getTime()) /
                (1000 * 60 * 60 * 24)
            );
            return sum + Math.max(0, days);
          }, 0) / sentTasks.length
        )
      : 0;

    return { inPeriod, barData, donutData, slowest, avgTurnaround };
  }, [tasks, period]);

  const PERIODS: { key: Period; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "week", label: "Week" },
    { key: "month", label: "Month" },
    { key: "quarter", label: "Qtr" },
  ];

  return (
    <div className="bg-card border border-border rounded-[10px] p-4 flex flex-col gap-4">
      {/* Header + period toggle */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
          Analytics
        </h3>
        <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5">
          {PERIODS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                period === key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Key stats */}
      <div className="flex items-center gap-3">
        <div>
          <p className="text-2xl font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
            {stats.inPeriod}
          </p>
          <p className="text-xs text-muted-foreground">demos requested</p>
        </div>
        <div className="h-8 w-px bg-border" />
        <div>
          <p className="text-2xl font-bold text-gold" style={{ fontFamily: "var(--font-heading)" }}>
            {stats.avgTurnaround}d
          </p>
          <p className="text-xs text-muted-foreground">avg turnaround</p>
        </div>
      </div>

      {/* Bar chart */}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2">Demos per day</p>
        <ResponsiveContainer width="100%" height={80}>
          <BarChart data={stats.barData} barSize={8}>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              interval={Math.floor(stats.barData.length / 5)}
            />
            <YAxis hide />
            <Tooltip
              contentStyle={{
                fontSize: 11,
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "var(--card)",
                color: "var(--foreground)",
              }}
              cursor={{ fill: "var(--muted)" }}
            />
            <Bar dataKey="count" radius={[3, 3, 0, 0]}>
              {stats.barData.map((entry, i) => (
                <Cell key={i} fill={entry.count > 0 ? "var(--primary)" : "var(--muted)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Donut chart */}
      {stats.donutData.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Stage distribution</p>
          <ResponsiveContainer width="100%" height={100}>
            <PieChart>
              <Pie
                data={stats.donutData}
                cx="38%"
                cy="50%"
                innerRadius={30}
                outerRadius={46}
                dataKey="value"
                strokeWidth={0}
              >
                {stats.donutData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Legend
                layout="vertical"
                align="right"
                verticalAlign="middle"
                iconType="circle"
                iconSize={7}
                formatter={(value) => (
                  <span style={{ fontSize: 10, color: "var(--foreground)" }}>{value}</span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Slowest in-progress */}
      {stats.slowest.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Longest active</p>
          <div className="space-y-1">
            {stats.slowest.map((task) => (
              <div key={task.id} className="flex items-center justify-between gap-2">
                <span className="text-xs text-foreground truncate flex-1">{task.name}</span>
                <span className={cn(
                  "text-xs font-medium shrink-0",
                  task.daysInStage > 5 ? "text-destructive" : "text-muted-foreground"
                )}>
                  {task.daysInStage}d
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
