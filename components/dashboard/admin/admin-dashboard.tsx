"use client";

import { Suspense } from "react";
import { format, getHours } from "date-fns";
import { AdminKpiStrip } from "./admin-kpi-strip";
import { TeamPerformanceGrid } from "./team-performance-grid";
import { PipelineHealthPanel } from "./pipeline-health-panel";
import { TasksStrip } from "@/components/dashboard/tasks-strip/tasks-strip";
import { CallsStrip } from "@/components/dashboard/calls-strip/calls-strip";
import { FollowUpQueue } from "@/components/dashboard/follow-up-queue";
import { AiCopilotPanel } from "@/components/dashboard/ai-copilot-panel";
import { ConversationsStrip } from "@/components/dashboard/conversations-strip/conversations-strip";
import { KpiWidget } from "@/components/dashboard/kpi-widget/kpi-widget";
import { ScrollToTop } from "@/components/layout/scroll-to-top";

function getGreeting(): string {
  const h = getHours(new Date());
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
  const today = format(new Date(), "EEEE, d MMMM yyyy");
  const firstName = userName.split(" ")[0] || "";

  const salesContext = `Today: ${today}.`;

  return (
    <div className="flex flex-col h-full p-6 gap-5 overflow-y-auto">
      <ScrollToTop />
      {/* Header */}
      <div>
        <h1
          className="text-2xl font-bold text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {getGreeting()}{firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">{today}</p>
      </div>

      {/* Admin KPI strip — Cash / Spend / Calls / Leads */}
      <AdminKpiStrip />

      {/* Tasks strip — full width, above calls */}
      <TasksStrip />

      {/* Calls strip — full width */}
      <CallsStrip isAdmin={true} />

      {/* Conversations strip — awaiting reply */}
      <ConversationsStrip />

      {/* KPI widget — 3 pinned metrics with period toggle */}
      <KpiWidget role="admin" userId={userId} />

      {/* Second row: Follow-up queue — full width */}
      <Suspense fallback={<Skeleton className="h-40" />}>
        <FollowUpQueue />
      </Suspense>

      {/* Third row: Team grid + Pipeline health */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5">
        <TeamPerformanceGrid />
        <PipelineHealthPanel />
      </div>

      {/* AI Copilot */}
      <div className="flex-1 min-h-[320px]">
        <AiCopilotPanel salesContext={salesContext} />
      </div>
    </div>
  );
}
