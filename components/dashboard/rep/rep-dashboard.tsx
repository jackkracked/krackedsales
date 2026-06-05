"use client";

import { useQuery } from "@tanstack/react-query";
import { format, getHours } from "date-fns";
import { useUserTimezone } from "@/providers/timezone-provider";
import { toZonedDate } from "@/lib/utils/timezone";
import { TodaysFocus } from "./todays-focus";
import { GoingColdWidget, type PipelineOpp } from "./going-cold-widget";
import { TasksStrip } from "@/components/dashboard/tasks-strip/tasks-strip";
import { CallsStrip } from "@/components/dashboard/calls-strip/calls-strip";
import { AiCopilotPanel } from "@/components/dashboard/ai-copilot-panel";
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

      {/* Commission row — only shown when a commission % is set */}
      {(metrics?.commissionPct ?? 0) > 0 && (
        <div className="grid grid-cols-3 gap-5">
          {[
            { label: "Commission this week", value: metrics?.commissionThisWeek ?? 0 },
            { label: "Commission this month", value: metrics?.commissionThisMonth ?? 0 },
            { label: "Commission this year", value: metrics?.commissionThisYear ?? 0 },
          ].map((card) => (
            <div
              key={card.label}
              className="bg-card border border-border rounded-[10px] px-5 py-4 flex flex-col gap-1"
            >
              <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground/70">
                {card.label}
              </p>
              <p className="text-2xl font-bold text-foreground tabular-nums" style={{ fontFamily: "var(--font-heading)" }}>
                ${card.value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </p>
              <p className="text-[11px] text-muted-foreground">
                at {metrics!.commissionPct}% commission
              </p>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
