import { Suspense } from "react";
import { getSessionUser } from "@/lib/auth/session";
import { ghl, locationId } from "@/lib/ghl/client";
import { format } from "date-fns";
import type { GHLCalendarEvent } from "@/lib/ghl/types";
import { AdminDashboard } from "@/components/dashboard/admin/admin-dashboard";
import { RepDashboard } from "@/components/dashboard/rep/rep-dashboard";

// Existing non-role-aware dashboard (fallback while session loads or for unknown roles)
import { MetricCard } from "@/components/dashboard/metric-card";
import { CalendarWidget } from "@/components/dashboard/calendar-widget";
import { AiCopilotPanel } from "@/components/dashboard/ai-copilot-panel";
import { FollowUpQueue } from "@/components/dashboard/follow-up-queue";
import { TasksWidget } from "@/components/dashboard/tasks-widget";
import { clickup, demoListId } from "@/lib/clickup/client";
import { mapStageToBucket, getStageRiskDays } from "@/lib/utils/demo-stage";
import { fromClickUpTimestamp } from "@/lib/utils/date";
import { isToday, isThisWeek, differenceInDays, getHours } from "date-fns";
import type { GHLOpportunity } from "@/lib/ghl/types";
import type { ClickUpTasksResponse } from "@/lib/clickup/types";

export const metadata = { title: "Dashboard — Kracked Sales" };

// ─── Shared data fetchers ─────────────────────────────────────────────────────

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

async function fetchCalendarEvents(ghlUserId: string): Promise<GHLCalendarEvent[]> {
  try {
    const data = await ghl.get<{ events: GHLCalendarEvent[] }>(
      `/calendars/events?locationId=${locationId()}&userId=${ghlUserId}&startTime=${new Date().setHours(0,0,0,0)}&endTime=${new Date().setHours(23,59,59,999)}`
    );
    return data.events ?? [];
  } catch {
    return [];
  }
}

async function getBaseMetrics() {
  const results = await Promise.allSettled([
    getAllOpportunities(),
    ghl.get<{ events: GHLCalendarEvent[] }>(
      `/calendars/events?locationId=${locationId()}&userId=yi2pnZ49sp6z8OIAezdA&startTime=${new Date().setHours(0,0,0,0)}&endTime=${new Date().setHours(23,59,59,999)}`
    ),
    clickup.get<ClickUpTasksResponse>(
      `/list/${demoListId()}/task?include_closed=true&subtasks=false&order_by=created&reverse=true`
    ),
  ]);

  const opportunities = results[0].status === "fulfilled" ? results[0].value : [];
  const calendarEvents = results[1].status === "fulfilled" ? results[1].value.events ?? [] : [];
  const demoTasks = results[2].status === "fulfilled" ? results[2].value.tasks ?? [] : [];

  const newLeadsToday = opportunities.filter((o) => isToday(new Date(o.createdAt))).length;
  const newLeadsThisWeek = opportunities.filter((o) =>
    isThisWeek(new Date(o.createdAt), { weekStartsOn: 1 })
  ).length;

  const emailDemos = demoTasks.filter(
    (t) => !t.parent && t.name.toLowerCase().includes(": email demo")
  );

  const demosInProgress = emailDemos.filter(
    (t) => mapStageToBucket(t.status.status) === "IN_PROGRESS"
  ).length;

  const demosSentThisWeek = emailDemos.filter(
    (t) =>
      mapStageToBucket(t.status.status) === "DEMO_SENT" &&
      isThisWeek(fromClickUpTimestamp(t.date_updated), { weekStartsOn: 1 })
  ).length;

  const demosAtRisk = emailDemos.filter((t) => {
    const bucket = mapStageToBucket(t.status.status);
    if (bucket !== "IN_PROGRESS") return false;
    const updated = fromClickUpTimestamp(t.date_updated);
    if (!updated) return false;
    const daysInStage = differenceInDays(new Date(), updated);
    return daysInStage > getStageRiskDays(t.status.status);
  }).length;

  return {
    newLeadsToday, newLeadsThisWeek, demosInProgress, demosSentThisWeek, demosAtRisk,
    calendarEvents,
  };
}

function getGreeting(): string {
  const h = getHours(new Date());
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// ─── Fallback dashboard (no role data available) ──────────────────────────────

async function FallbackDashboard() {
  const data = await getBaseMetrics().catch(() => ({
    newLeadsToday: 0, newLeadsThisWeek: 0, demosInProgress: 0,
    demosSentThisWeek: 0, demosAtRisk: 0, calendarEvents: [],
  }));

  const today = format(new Date(), "EEEE, d MMMM yyyy");
  const greeting = getGreeting();

  return (
    <div className="flex flex-col h-full p-6 gap-5 overflow-y-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
          {greeting}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">{today}</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="New Leads Today" value={data.newLeadsToday} trend={{ value: `${data.newLeadsThisWeek} this week`, direction: "flat" }} />
        <MetricCard label="Demos In Progress" value={data.demosInProgress} subtitle="across all stages" />
        <MetricCard label="Demos Sent This Week" value={data.demosSentThisWeek} accent="green" />
        <MetricCard label="Demos At Risk" value={data.demosAtRisk} subtitle={data.demosAtRisk === 0 ? "all on track" : "over stage target"} accent={data.demosAtRisk > 0 ? "gold" : "default"} />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_260px_260px] gap-5">
        <Suspense fallback={<div className="h-40 bg-card border border-border rounded-[10px] animate-pulse" />}>
          <FollowUpQueue />
        </Suspense>
        <TasksWidget />
        <CalendarWidget events={data.calendarEvents} />
      </div>
      <div className="flex-1 min-h-[320px]">
        <AiCopilotPanel salesContext={`Today: ${today}. Leads today: ${data.newLeadsToday}. Demos in progress: ${data.demosInProgress}.`} />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const user = await getSessionUser().catch(() => null);

  // Unknown user — show generic dashboard
  if (!user) {
    return <FallbackDashboard />;
  }

  const today = format(new Date(), "EEEE, d MMMM yyyy");
  const calendarGhlUserId = user.ghlUserId ?? "yi2pnZ49sp6z8OIAezdA";

  const calendarEvents = await fetchCalendarEvents(calendarGhlUserId).catch(() => []);

  if (user.role === "rep") {
    return (
      <RepDashboard
        userId={user.id}
        userName={user.name}
        email={user.email}
        ghlUserId={user.ghlUserId ?? null}
        calendarEvents={calendarEvents}
      />
    );
  }

  // Admin (or any other role) gets the full admin view
  const baseMetrics = await getBaseMetrics().catch(() => ({
    newLeadsToday: 0, newLeadsThisWeek: 0, demosInProgress: 0,
    demosSentThisWeek: 0, demosAtRisk: 0, calendarEvents: [],
  }));

  const salesContext = `Today: ${today}. Leads today: ${baseMetrics.newLeadsToday}. This week: ${baseMetrics.newLeadsThisWeek}. Demos in progress: ${baseMetrics.demosInProgress}. Demos sent this week: ${baseMetrics.demosSentThisWeek}. At risk: ${baseMetrics.demosAtRisk}.`;

  return (
    <AdminDashboard
      userName={user.name}
      calendarEvents={calendarEvents.length > 0 ? calendarEvents : baseMetrics.calendarEvents}
      salesContext={salesContext}
    />
  );
}
