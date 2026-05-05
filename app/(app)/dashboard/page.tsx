import { Suspense } from "react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { CalendarWidget } from "@/components/dashboard/calendar-widget";
import { AiCopilotPanel } from "@/components/dashboard/ai-copilot-panel";
import { FollowUpQueue } from "@/components/dashboard/follow-up-queue";
import { TasksWidget } from "@/components/dashboard/tasks-widget";
import { ghl, locationId } from "@/lib/ghl/client";
import { clickup, demoListId } from "@/lib/clickup/client";
import { mapStageToBucket, getStageRiskDays } from "@/lib/utils/demo-stage";
import { fromClickUpTimestamp } from "@/lib/utils/date";
import { isToday, isThisWeek, differenceInDays } from "date-fns";
import { format, getHours } from "date-fns";
import type { GHLCalendarEvent, GHLOpportunity } from "@/lib/ghl/types";
import type { ClickUpTasksResponse } from "@/lib/clickup/types";

export const metadata = { title: "Dashboard — Kracked Sales" };

// Paginate all GHL opportunities so leads metrics count every lead, not just first 100
async function getAllOpportunities(): Promise<GHLOpportunity[]> {
  const all: GHLOpportunity[] = [];
  const locId = locationId();
  for (let page = 1; page <= 20; page++) {
    const data = await ghl.get<{ opportunities: GHLOpportunity[] }>(
      `/opportunities/search?location_id=${locId}&limit=100&page=${page}`
    );
    const batch = data.opportunities ?? [];
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

// Fetch dashboard data server-side with graceful fallbacks
async function getDashboardData() {
  const results = await Promise.allSettled([
    // GHL: ALL opportunities, paginated
    getAllOpportunities(),
    // GHL: today's calendar — filtered to Gage Flesher's events
    ghl.get<{ events: GHLCalendarEvent[] }>(
      `/calendars/events?locationId=${locationId()}&userId=yi2pnZ49sp6z8OIAezdA&startTime=${new Date().setHours(0,0,0,0)}&endTime=${new Date().setHours(23,59,59,999)}`
    ),
    // ClickUp: top-level demo tasks — statuses live on parent tasks, not subtasks
    clickup.get<ClickUpTasksResponse>(
      `/list/${demoListId()}/task?include_closed=true&subtasks=false&order_by=created&reverse=true`
    ),
  ]);

  const opportunities = results[0].status === "fulfilled"
    ? results[0].value
    : [];

  const calendarEvents = results[1].status === "fulfilled"
    ? results[1].value.events ?? []
    : [];

  const demoTasks = results[2].status === "fulfilled"
    ? results[2].value.tasks ?? []
    : [];

  // Compute metrics — week always starts Monday
  const newLeadsToday = opportunities.filter((o) => isToday(new Date(o.createdAt))).length;
  const newLeadsThisWeek = opportunities.filter((o) => isThisWeek(new Date(o.createdAt), { weekStartsOn: 1 })).length;

  // Only count top-level "Email Demo" parent tasks — one per demo, status reflects current stage
  const emailDemos = demoTasks.filter(
    (t) => !t.parent && t.name.toLowerCase().includes(": email demo")
  );

  // Demos In Progress: Copy, Design, Copy Revision Needed, Design Revision Needed, Internal QA
  const demosInProgress = emailDemos.filter((t) =>
    mapStageToBucket(t.status.status) === "IN_PROGRESS"
  ).length;

  // Demos Sent This Week: moved to Scheduled/Live this week (by date_updated)
  const demosSentThisWeek = emailDemos.filter((t) =>
    mapStageToBucket(t.status.status) === "DEMO_SENT" &&
    isThisWeek(fromClickUpTimestamp(t.date_updated), { weekStartsOn: 1 })
  ).length;

  // Demos at risk: in-progress demos that have exceeded their stage target days
  const demosAtRisk = emailDemos.filter((t) => {
    const bucket = mapStageToBucket(t.status.status);
    if (bucket !== "IN_PROGRESS") return false;
    const updated = fromClickUpTimestamp(t.date_updated);
    if (!updated) return false;
    const daysInStage = differenceInDays(new Date(), updated);
    const riskDays = getStageRiskDays(t.status.status);
    return daysInStage > riskDays;
  }).length;

  return {
    newLeadsToday,
    newLeadsThisWeek,
    demosInProgress,
    demosSentThisWeek,
    demosAtRisk,
    calendarEvents,
  };
}

function getGreeting(): string {
  const h = getHours(new Date());
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage() {
  const data = await getDashboardData().catch(() => ({
    newLeadsToday: 0,
    newLeadsThisWeek: 0,
    demosInProgress: 0,
    demosSentThisWeek: 0,
    demosAtRisk: 0,
    calendarEvents: [],
  }));

  const today = format(new Date(), "EEEE, d MMMM yyyy");
  const greeting = getGreeting();

  return (
    <div className="flex flex-col h-full p-6 gap-5 overflow-y-auto">
      {/* Page header */}
      <div>
        <h1
          className="text-2xl font-bold text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {greeting}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">{today}</p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="New Leads Today"
          value={data.newLeadsToday}
          trend={{ value: `${data.newLeadsThisWeek} this week`, direction: "flat" }}
        />
        <MetricCard
          label="Demos In Progress"
          value={data.demosInProgress}
          subtitle="across all stages"
        />
        <MetricCard
          label="Demos Sent This Week"
          value={data.demosSentThisWeek}
          accent="green"
        />
        <MetricCard
          label="Demos At Risk"
          value={data.demosAtRisk}
          subtitle={data.demosAtRisk === 0 ? "all on track" : "over stage target"}
          accent={data.demosAtRisk > 0 ? "gold" : "default"}
        />
      </div>

      {/* Middle row: Reply Queue + Tasks + Calendar */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_260px_260px] gap-5">
        <Suspense fallback={<div className="h-40 bg-card border border-border rounded-[10px] animate-pulse" />}>
          <FollowUpQueue />
        </Suspense>
        <TasksWidget />
        <CalendarWidget events={data.calendarEvents} />
      </div>

      {/* AI Copilot — flex-1 takes remaining space */}
      <div className="flex-1 min-h-[320px]">
        <AiCopilotPanel salesContext={`Today's date: ${today}. New leads today: ${data.newLeadsToday}. New leads this week: ${data.newLeadsThisWeek}. Demos in progress: ${data.demosInProgress}. Demos sent this week: ${data.demosSentThisWeek}. Demos at risk (over stage target): ${data.demosAtRisk}. Calendar events today: ${data.calendarEvents.length}.`} />
      </div>
    </div>
  );
}
