"use client";

import { useQuery } from "@tanstack/react-query";
import { format, getHours } from "date-fns";
import { useUserTimezone } from "@/providers/timezone-provider";
import { toZonedDate } from "@/lib/utils/timezone";
import { PipelineHealthPanel } from "./pipeline-health-panel";
import { TasksStrip } from "@/components/dashboard/tasks-strip/tasks-strip";
import { CallsStrip } from "@/components/dashboard/calls-strip/calls-strip";
import { AiCopilotPanel } from "@/components/dashboard/ai-copilot-panel";
import { ConversationsStrip } from "@/components/dashboard/conversations-strip/conversations-strip";
import { KpiWidget } from "@/components/dashboard/kpi-widget/kpi-widget";
import { GoalProgressBars } from "@/components/dashboard/goal-progress/goal-progress-bars";
import { RepPerformanceLeaderboard } from "@/components/dashboard/rep-performance/rep-performance-leaderboard";
import { ScrollToTop } from "@/components/layout/scroll-to-top";
import { FathomNudgeBanner } from "@/components/fathom/fathom-nudge-banner";
import { useFathomAutoSync } from "@/lib/fathom/use-fathom-sync";

function getGreeting(tz: string): string {
  const h = getHours(toZonedDate(new Date(), tz));
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-[10px] bg-muted/60 ${className ?? ""}`} />;
}

interface AdminDashboardProps {
  userId: string;
  userName: string;
  ghlUserId: string | null;
}

export function AdminDashboard({ userId, userName }: AdminDashboardProps) {
  const tz = useUserTimezone();
  useFathomAutoSync();
  const today = format(toZonedDate(new Date(), tz), "EEEE, d MMMM yyyy");
  const firstName = userName.split(" ")[0] || "";

  const { data: summaryData } = useQuery<{ summary: { content: string } | null }>({
    queryKey: ["weekly-summary"],
    queryFn: () => fetch("/api/dashboard/weekly-summary").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="flex flex-col h-full p-6 gap-5 overflow-y-auto">
      <ScrollToTop />
      <FathomNudgeBanner />

      {/* Header + Weekly Summary */}
      <div>
        <h1
          className="text-2xl font-bold text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {getGreeting(tz)}{firstName ? `, ${firstName}` : ""}
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
      <CallsStrip isAdmin={true} />

      {/* Conversations strip — awaiting reply */}
      <ConversationsStrip />

      {/* KPI widget — 3 pinned metrics with period toggle */}
      <KpiWidget role="admin" userId={userId} />

      {/* Goal progress bars — 4 bars showing team targets */}
      <GoalProgressBars />

      {/* Rep performance leaderboard */}
      <RepPerformanceLeaderboard />

      {/* Pipeline health */}
      <PipelineHealthPanel />

    </div>
  );
}
