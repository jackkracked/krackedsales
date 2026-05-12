"use client";

import { Suspense } from "react";
import { format, getHours } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { AdminKpiStrip } from "./admin-kpi-strip";
import { TeamPerformanceGrid } from "./team-performance-grid";
import { PipelineHealthPanel } from "./pipeline-health-panel";
import { CalendarWidget } from "@/components/dashboard/calendar-widget";
import { FollowUpQueue } from "@/components/dashboard/follow-up-queue";
import { TasksWidget } from "@/components/dashboard/tasks-widget";
import { AiCopilotPanel } from "@/components/dashboard/ai-copilot-panel";
import type { GHLCalendarEvent } from "@/lib/ghl/types";

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
  userName: string;
  ghlUserId: string | null;
}

export function AdminDashboard({ userName, ghlUserId }: AdminDashboardProps) {
  const today = format(new Date(), "EEEE, d MMMM yyyy");
  const firstName = userName.split(" ")[0] || "";

  // Calendar events fetched client-side — no longer blocks page render
  const { data: calendarData } = useQuery<{ events: GHLCalendarEvent[] }>({
    queryKey: ["calendar-today", ghlUserId],
    queryFn: () => fetch("/api/ghl/calendar").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const calendarEvents = calendarData?.events ?? [];
  const salesContext = `Today: ${today}. Calendar events: ${calendarEvents.length}.`;

  return (
    <div className="flex flex-col h-full p-6 gap-5 overflow-y-auto">
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

      {/* Second row: Follow-up queue + Tasks + Calendar */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_260px_260px] gap-5">
        <Suspense fallback={<Skeleton className="h-40" />}>
          <FollowUpQueue />
        </Suspense>
        <TasksWidget />
        <CalendarWidget events={calendarEvents} />
      </div>

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
