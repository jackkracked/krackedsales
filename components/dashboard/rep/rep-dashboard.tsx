"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, getHours, startOfWeek, startOfMonth, startOfYear, startOfDay, addDays } from "date-fns";
import { MetricSection } from "@/components/kpis/metric-section";
import type { MetricDef } from "@/components/kpis/metric-cell";
import { KpiDetailSheet } from "@/components/kpis/KpiDetailSheet";
import { useUserTimezone } from "@/providers/timezone-provider";
import { toZonedDate } from "@/lib/utils/timezone";
import { TodaysFocus } from "./todays-focus";
import { GoingColdWidget, type PipelineOpp } from "./going-cold-widget";
import { TasksStrip } from "@/components/dashboard/tasks-strip/tasks-strip";
import { CallsStrip } from "@/components/dashboard/calls-strip/calls-strip";
import { ConversationsStrip } from "@/components/dashboard/conversations-strip/conversations-strip";
import { KpiWidget } from "@/components/dashboard/kpi-widget/kpi-widget";
import { GoalProgressBars } from "@/components/dashboard/goal-progress/goal-progress-bars";
import { ScrollToTop } from "@/components/layout/scroll-to-top";
import { FathomNudgeBanner } from "@/components/fathom/fathom-nudge-banner";
import { useFathomAutoSync } from "@/lib/fathom/use-fathom-sync";

function getGreeting(tz: string): string {
  const h = getHours(toZonedDate(new Date(), tz));
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

interface RepMetrics {
  targets: { dealsPerMonth: number; callsPerDay: number; revenueTarget: number };
  dealsWon: number;
  revenueWon: number;
  callsToday: number;
  activityBars: { date: string; calls: number }[];
  pipelineOpps: PipelineOpp[];
  commissionPct: number;
  commissionThisWeek: number;
  commissionThisMonth: number;
  commissionThisYear: number;
}

interface RepDashboardProps {
  userId: string;
  userName: string;
  email: string;
  ghlUserId: string | null;
}

export function RepDashboard({ userId, userName, email, ghlUserId }: RepDashboardProps) {
  const tz = useUserTimezone();
  useFathomAutoSync();
  const today = format(toZonedDate(new Date(), tz), "EEEE, d MMMM yyyy");
  const firstName = userName.split(" ")[0];

  // Which fixed-period commission card has its breakdown drawer open
  const [commDetail, setCommDetail] = useState<{ start: string; end: string; label: string } | null>(null);

  const params = new URLSearchParams({ userId, email: email ?? "" });
  if (ghlUserId) params.set("ghlUserId", ghlUserId);

  const { data: summaryData } = useQuery<{ summary: { content: string } | null }>({
    queryKey: ["weekly-summary"],
    queryFn: () => fetch("/api/dashboard/weekly-summary").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const { data: metrics } = useQuery<RepMetrics>({
    queryKey: ["rep-metrics", userId],
    queryFn: () => fetch(`/api/kpi/rep-metrics?${params}`).then((r) => r.json()),
    staleTime: 60 * 1000,
    refetchInterval: 3 * 60 * 1000,
  });

  const targets = metrics?.targets ?? { dealsPerMonth: 5, callsPerDay: 15, revenueTarget: 0 };
  const activityBars = metrics?.activityBars ?? Array.from({ length: 7 }, (_, i) => ({
    date: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i],
    calls: 0,
  }));

  const salesContext = `Today: ${today}. Deals won this month: ${metrics?.dealsWon ?? 0} / ${targets.dealsPerMonth}. Calls today: ${metrics?.callsToday ?? 0} / ${targets.callsPerDay}.`;

  return (
    <div className="flex flex-col h-full p-6 gap-5 overflow-y-auto">
      <ScrollToTop />
      <FathomNudgeBanner />

      {/* Header */}
      <div>
        <h1
          className="text-2xl font-bold text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {getGreeting(tz)}, {firstName}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">{today}</p>
        {summaryData?.summary?.content && (
          <p className="text-sm text-foreground/75 leading-relaxed mt-3">
            {summaryData.summary.content}
          </p>
        )}
      </div>

      {/* Tasks strip — full width, above calls */}
      <TasksStrip />

      {/* Calls strip — full width */}
      <CallsStrip isAdmin={false} />

      {/* Conversations strip — awaiting reply */}
      <ConversationsStrip />

      {/* KPI widget — 3 pinned metrics with period toggle */}
      <KpiWidget
        role="rep"
        userId={userId}
        ghlUserId={ghlUserId}
        email={email}
      />

      {/* Goal progress bars — personal targets */}
      <GoalProgressBars />

      {/* Commission — fixed-period cards, each clickable into its breakdown */}
      {(() => {
        if ((metrics?.commissionPct ?? 0) <= 0) return null;
        const pct = metrics?.commissionPct ?? 0;
        const nowD = new Date();
        const ymd = (d: Date) => format(d, "yyyy-MM-dd");
        const endExcl = ymd(addDays(startOfDay(nowD), 1));
        const periodByKey: Record<string, { start: string; label: string }> = {
          comm_week: { start: ymd(startOfWeek(nowD, { weekStartsOn: 1 })), label: "This week" },
          comm_month: { start: ymd(startOfMonth(nowD)), label: "This month" },
          comm_year: { start: ymd(startOfYear(nowD)), label: "This year" },
        };
        const commMetrics: MetricDef[] = [
          { key: "comm_week", label: "This week", unit: "currency" },
          { key: "comm_month", label: "This month", unit: "currency" },
          { key: "comm_year", label: "This year", unit: "currency" },
        ];
        const sub = `at ${pct}% commission`;
        const commValues = {
          comm_week: { value: metrics?.commissionThisWeek ?? 0, sub },
          comm_month: { value: metrics?.commissionThisMonth ?? 0, sub },
          comm_year: { value: metrics?.commissionThisYear ?? 0, sub },
        };
        return (
          <MetricSection
            title="Commission"
            metrics={commMetrics}
            values={commValues}
            onMetricClick={(key) => {
              const p = periodByKey[key];
              if (p) setCommDetail({ start: p.start, end: endExcl, label: p.label });
            }}
          />
        );
      })()}

      {commDetail && (
        <KpiDetailSheet
          metric="commission"
          start={commDetail.start}
          end={commDetail.end}
          periodLabel={commDetail.label}
          userId={userId}
          ghlUserId={ghlUserId ?? undefined}
          email={email}
          onClose={() => setCommDetail(null)}
        />
      )}
    </div>
  );
}
