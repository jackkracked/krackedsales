"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  addWeeks, subWeeks, addMonths, subMonths, addDays, subDays,
  format, isSameDay, isSameMonth, isToday,
  eachDayOfInterval, eachWeekOfInterval,
  parseISO, getHours, getMinutes, differenceInMinutes,
} from "date-fns";
import { ChevronLeft, ChevronRight, Plus, Calendar } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useUserTimezone } from "@/providers/timezone-provider";
import { toZonedDate, isTodayInTz } from "@/lib/utils/timezone";
import { EventPanel } from "./event-panel";
import { BookCallDrawer } from "./book-call-drawer";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string | null;
  start: { dateTime?: string | null; date?: string | null };
  end: { dateTime?: string | null; date?: string | null };
  repEmail: string;
  repId?: string;
  contactId?: string | null;
  hangoutLink?: string | null;
  attendees: { email?: string | null; displayName?: string | null }[];
  googleNotConfigured?: boolean;
  source?: "ghl" | "google";
  appointmentStatus?: string;
}

interface TeamMember {
  id: string;
  name: string;
  email: string;
  ghlUserId: string | null;
  color: string;
}

type ViewMode = "week" | "month" | "day";

// ─── Constants ────────────────────────────────────────────────────────────────

const HOUR_START = 0;   // midnight
const HOUR_END   = 24;  // midnight (full day)
const HOUR_COUNT = HOUR_END - HOUR_START;
const HOUR_PX    = 64;
const GRID_HEIGHT = HOUR_COUNT * HOUR_PX; // 1024px

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getWeekStart(date: Date): Date {
  return startOfWeek(date, { weekStartsOn: 1 }); // Monday
}

function getWeekEnd(date: Date): Date {
  return endOfWeek(date, { weekStartsOn: 1 });
}

/** Convert a CalendarEvent start.dateTime to a Date, or null for all-day events */
function eventStart(ev: CalendarEvent): Date | null {
  if (ev.start.dateTime) return parseISO(ev.start.dateTime);
  return null;
}

function eventEnd(ev: CalendarEvent): Date | null {
  if (ev.end.dateTime) return parseISO(ev.end.dateTime);
  return null;
}

/** Top offset in px for time grid (relative to HOUR_START) */
function topPx(date: Date): number {
  const h = getHours(date) - HOUR_START;
  const m = getMinutes(date);
  return h * HOUR_PX + (m / 60) * HOUR_PX;
}

/** Height in px for an event duration */
function heightPx(start: Date, end: Date): number {
  const mins = differenceInMinutes(end, start);
  return Math.max(28, (mins / 60) * HOUR_PX);
}

/** Current time top offset (clamped to grid) */
function nowTopPx(): number {
  const now = new Date();
  const h = getHours(now) - HOUR_START;
  const m = getMinutes(now);
  return h * HOUR_PX + (m / 60) * HOUR_PX;
}

function formatHour(h: number): string {
  if (h === 0 || h === 24) return "12am";
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

function rangeLabel(view: ViewMode, date: Date, tz: string): string {
  if (view === "month") return format(toZonedDate(date, tz), "MMMM yyyy");
  if (view === "day")   return format(toZonedDate(date, tz), "EEEE, MMM d, yyyy");
  const ws = getWeekStart(date);
  const we = getWeekEnd(date);
  if (isSameMonth(ws, we)) {
    return `${format(toZonedDate(ws, tz), "MMM d")} – ${format(toZonedDate(we, tz), "d, yyyy")}`;
  }
  return `${format(toZonedDate(ws, tz), "MMM d")} – ${format(toZonedDate(we, tz), "MMM d, yyyy")}`;
}

// ─── Event block ─────────────────────────────────────────────────────────────

function EventBlock({
  event,
  color,
  onClick,
  tz,
}: {
  event: CalendarEvent;
  color: string;
  onClick: () => void;
  tz: string;
}) {
  const start = eventStart(event);
  const end   = eventEnd(event);
  if (!start || !end) return null;

  const top    = topPx(start);
  const height = heightPx(start, end);

  // Clamp to grid
  if (top + height < 0 || top > GRID_HEIGHT) return null;

  const timeLabel = `${format(toZonedDate(start, tz), "h:mma")}`;
  const isGoogle = event.source === "google";

  return (
    <button
      onClick={onClick}
      title={event.summary}
      className={cn(
        "absolute left-1 right-1 overflow-hidden rounded-[6px] border-l-2 px-1.5 py-0.5 text-left cursor-pointer hover:brightness-95 transition-all z-10",
        isGoogle && "opacity-40 border-dashed"
      )}
      style={{
        top,
        height: Math.min(height, GRID_HEIGHT - top),
        borderLeftColor: color,
        backgroundColor: `${color}18`,
      }}
    >
      <p className="text-[11px] font-semibold text-foreground leading-tight truncate">
        {event.summary}
      </p>
      {height >= 44 && (
        <p className="text-[10px] text-muted-foreground leading-tight">{timeLabel}</p>
      )}
    </button>
  );
}

// ─── Conflict types ─────────────────────────────────────────────────────────

interface ConflictBlock {
  start: string; // ISO datetime
  end: string;   // ISO datetime
}

// ─── Week / Day view ──────────────────────────────────────────────────────────

function TimeGrid({
  days,
  events,
  repColors,
  conflicts,
  onEventClick,
  onEmptyClick,
  tz,
}: {
  days: Date[];
  events: CalendarEvent[];
  repColors: Record<string, string>;
  conflicts: ConflictBlock[];
  onEventClick: (ev: CalendarEvent) => void;
  onEmptyClick: (date: Date, hour: number, minute: number) => void;
  tz: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [nowTop, setNowTop] = useState(nowTopPx());

  // Scroll to current time on mount
  useEffect(() => {
    if (scrollRef.current) {
      const target = Math.max(0, nowTopPx() - 120);
      scrollRef.current.scrollTop = target;
    }
  }, []);

  // Update now-line every minute
  useEffect(() => {
    const timer = setInterval(() => setNowTop(nowTopPx()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const showNowLine = isTodayInTz(days[0], tz) || days.some((d) => isTodayInTz(d, tz));

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
      <div className="flex">
        {/* Time labels column */}
        <div className="w-14 shrink-0 relative" style={{ height: GRID_HEIGHT }}>
          {Array.from({ length: HOUR_COUNT }, (_, i) => (
            <div
              key={i}
              className="absolute left-0 right-0 flex items-start justify-end pr-2"
              style={{ top: i * HOUR_PX - 8, height: HOUR_PX }}
            >
              <span className="text-[10px] text-muted-foreground/60 select-none">
                {i === 0 ? "" : formatHour(HOUR_START + i)}
              </span>
            </div>
          ))}
        </div>

        {/* Day columns */}
        {days.map((day, colIdx) => {
          const dayEvents = events.filter((ev) => {
            const s = eventStart(ev);
            return s && isSameDay(s, day);
          });

          const dayConflicts = conflicts.filter((c) => {
            const s = parseISO(c.start);
            return isSameDay(s, day);
          });

          function handleDayClick(e: React.MouseEvent<HTMLDivElement>) {
            // Only fire on the grid background, not on event buttons
            if ((e.target as HTMLElement).closest("button")) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const offsetY = e.clientY - rect.top;
            const rawHour = HOUR_START + offsetY / HOUR_PX;
            // Round to nearest 15 minutes
            const totalMinutes = Math.round((rawHour * 60) / 15) * 15;
            const hour = Math.floor(totalMinutes / 60);
            const minute = totalMinutes % 60;
            onEmptyClick(day, hour, minute);
          }

          return (
            <div
              key={colIdx}
              className={cn(
                "flex-1 relative border-l border-border/40 cursor-pointer",
                isTodayInTz(day, tz) && "bg-primary/[0.025]"
              )}
              style={{ height: GRID_HEIGHT }}
              onClick={handleDayClick}
            >
              {/* Hour lines */}
              {Array.from({ length: HOUR_COUNT }, (_, i) => (
                <div
                  key={i}
                  className="absolute left-0 right-0 border-t border-border/25"
                  style={{ top: i * HOUR_PX }}
                />
              ))}

              {/* Conflict busy blocks */}
              {dayConflicts.map((c, ci) => {
                const cStart = parseISO(c.start);
                const cEnd = parseISO(c.end);
                const cTop = topPx(cStart);
                const cHeight = heightPx(cStart, cEnd);
                if (cTop + cHeight < 0 || cTop > GRID_HEIGHT) return null;
                return (
                  <div
                    key={`conflict-${ci}`}
                    className="absolute left-0 right-0 bg-destructive/[0.08] pointer-events-none z-[1]"
                    style={{
                      top: Math.max(0, cTop),
                      height: Math.min(cHeight, GRID_HEIGHT - Math.max(0, cTop)),
                    }}
                  />
                );
              })}

              {/* Events */}
              {dayEvents.map((ev) => (
                <EventBlock
                  key={ev.id}
                  event={ev}
                  color={repColors[ev.repId ?? ""] ?? repColors[ev.repEmail] ?? "#6366f1"}
                  onClick={() => onEventClick(ev)}
                  tz={tz}
                />
              ))}

              {/* Current time line */}
              {showNowLine && isTodayInTz(day, tz) && nowTop >= 0 && nowTop <= GRID_HEIGHT && (
                <div
                  className="absolute left-0 right-0 z-20 pointer-events-none"
                  style={{ top: nowTop }}
                >
                  <div className="relative flex items-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-rose-500 -ml-0.5 shrink-0" />
                    <div className="flex-1 h-px bg-rose-500" />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Month view ───────────────────────────────────────────────────────────────

function MonthGrid({
  currentDate,
  events,
  repColors,
  onEventClick,
  onDayClick,
  tz,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  repColors: Record<string, string>;
  onEventClick: (ev: CalendarEvent) => void;
  onDayClick: (date: Date) => void;
  tz: string;
}) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd   = endOfMonth(currentDate);

  const weeks = eachWeekOfInterval(
    { start: monthStart, end: monthEnd },
    { weekStartsOn: 1 }
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Day header row */}
      <div className="grid grid-cols-7 border-b border-border shrink-0">
        {DAY_LABELS.map((d) => (
          <div key={d} className="py-2 text-center text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {d}
          </div>
        ))}
      </div>

      {/* Weeks */}
      <div className="flex-1 min-h-0 flex flex-col">
        {weeks.map((weekStart, wi) => {
          const weekDays = eachDayOfInterval({
            start: weekStart,
            end: addDays(weekStart, 6),
          });

          return (
            <div key={wi} className="flex-1 grid grid-cols-7 border-b border-border/40 min-h-0">
              {weekDays.map((day, di) => {
                const dayEvents = events.filter((ev) => {
                  const s = eventStart(ev);
                  return s ? isSameDay(s, day) : ev.start.date === format(day, "yyyy-MM-dd");
                });
                const visible = dayEvents.slice(0, 3);
                const overflow = dayEvents.length - 3;
                const inMonth = isSameMonth(day, currentDate);

                function handleMonthDayClick(e: React.MouseEvent<HTMLDivElement>) {
                  if ((e.target as HTMLElement).closest("button")) return;
                  onDayClick(day);
                }

                return (
                  <div
                    key={di}
                    onClick={handleMonthDayClick}
                    className={cn(
                      "min-h-0 p-1.5 border-l border-border/25 first:border-l-0 cursor-pointer overflow-hidden",
                      !inMonth && "bg-muted/20"
                    )}
                  >
                    {/* Date number */}
                    <div className="flex items-center justify-center mb-1">
                      <span
                        className={cn(
                          "w-6 h-6 flex items-center justify-center rounded-full text-xs",
                          isTodayInTz(day, tz)
                            ? "bg-primary text-white font-bold ring-2 ring-primary/30"
                            : inMonth
                            ? "text-foreground font-medium"
                            : "text-muted-foreground/40"
                        )}
                      >
                        {format(day, "d")}
                      </span>
                    </div>

                    {/* Events */}
                    <div className="space-y-0.5">
                      {visible.map((ev) => {
                        const color = repColors[ev.repId ?? ""] ?? repColors[ev.repEmail] ?? "#6366f1";
                        const isGoogle = ev.source === "google";
                        return (
                          <button
                            key={ev.id}
                            onClick={() => onEventClick(ev)}
                            title={ev.summary}
                            className={cn(
                              "w-full text-left px-1.5 py-0.5 rounded text-[10px] font-medium truncate leading-tight",
                              isGoogle && "opacity-40"
                            )}
                            style={{
                              backgroundColor: `${color}20`,
                              borderLeft: `2px ${isGoogle ? "dashed" : "solid"} ${color}`,
                              color: "inherit",
                            }}
                          >
                            {ev.summary}
                          </button>
                        );
                      })}
                      {overflow > 0 && (
                        <p className="text-[10px] text-muted-foreground px-1">
                          +{overflow} more
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Day column headers ───────────────────────────────────────────────────────

function DayHeaders({ days, tz }: { days: Date[]; tz: string }) {
  return (
    <div className="flex border-b border-border shrink-0">
      <div className="w-14 shrink-0" /> {/* align with time labels */}
      {days.map((day, i) => (
        <div
          key={i}
          className={cn(
            "flex-1 py-2 text-center border-l border-border/40",
            isTodayInTz(day, tz) && "bg-primary/[0.025]"
          )}
        >
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {format(toZonedDate(day, tz), "EEE")}
          </p>
          <p
            className={cn(
              "text-sm font-bold mt-0.5",
              isTodayInTz(day, tz) ? "text-primary" : "text-foreground"
            )}
          >
            {format(toZonedDate(day, tz), "d")}
          </p>
        </div>
      ))}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function CalendarClient() {
  const tz = useUserTimezone();
  const [view, setView]                       = useState<ViewMode>("week");
  const [currentDate, setCurrentDate]         = useState<Date>(new Date());
  const [activeReps, setActiveReps]           = useState<string[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [bookCallOpen, setBookCallOpen]       = useState(false);
  const [bookCallInitialDate, setBookCallInitialDate]       = useState<string | undefined>();
  const [bookCallInitialStartTime, setBookCallInitialStartTime] = useState<string | undefined>();

  // ── Date range for queries ────────────────────────────────────────────────
  const { since, until, days } = useMemo(() => {
    if (view === "day") {
      const s = new Date(currentDate);
      s.setHours(0, 0, 0, 0);
      const e = new Date(currentDate);
      e.setHours(23, 59, 59, 999);
      return { since: s.toISOString(), until: e.toISOString(), days: [currentDate] };
    }
    if (view === "month") {
      const s = startOfMonth(currentDate);
      const e = endOfMonth(currentDate);
      return {
        since: s.toISOString(),
        until: e.toISOString(),
        days: eachDayOfInterval({ start: s, end: e }),
      };
    }
    // week
    const ws = getWeekStart(currentDate);
    const we = getWeekEnd(currentDate);
    return {
      since: ws.toISOString(),
      until: we.toISOString(),
      days: eachDayOfInterval({ start: ws, end: we }),
    };
  }, [view, currentDate]);

  // ── Fetch team members ────────────────────────────────────────────────────
  const { data: teamData } = useQuery<{ members: TeamMember[] }>({
    queryKey: ["calendar-team"],
    queryFn: () => fetch("/api/calendar/team").then((r) => r.json()),
    staleTime: 5 * 60_000,
  });

  const members = teamData?.members ?? [];

  // Seed activeReps once members load (using member id as the key)
  useEffect(() => {
    if (members.length > 0 && activeReps.length === 0) {
      setActiveReps(members.map((m) => m.id));
    }
  }, [members]); // eslint-disable-line react-hooks/exhaustive-deps

  // Color map: both repId (ghlUserId) and repEmail can be used to look up color
  const repColors = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const m of members) {
      map[m.email] = m.color;
      if (m.ghlUserId) map[m.ghlUserId] = m.color;
      map[m.id] = m.color;
    }
    return map;
  }, [members]);

  // ── Fetch events ──────────────────────────────────────────────────────────
  const activeMembers = members.filter((m) => activeReps.includes(m.id));
  const emailsParam = activeMembers.map((m) => m.email).join(",");
  const userIdsParam = activeMembers.map((m) => m.ghlUserId).filter(Boolean).join(",");

  const { data: eventsData, isLoading: eventsLoading } = useQuery<{
    events: CalendarEvent[];
    googleNotConfigured?: boolean;
  }>({
    queryKey: ["calendar-events", emailsParam, userIdsParam, since, until],
    queryFn: () => {
      const params = new URLSearchParams({ since, until });
      if (emailsParam) params.set("emails", emailsParam);
      if (userIdsParam) params.set("userIds", userIdsParam);
      return fetch(`/api/calendar/events?${params.toString()}`).then((r) => r.json());
    },
    enabled: activeReps.length > 0,
    staleTime: 60_000,
  });

  // Filter events to only show those assigned to selected reps.
  // GHL returns ALL events from calendars where a user is a team member,
  // including shared calendars — so we filter client-side by repId.
  const activeGhlIds = new Set(activeMembers.map((m) => m.ghlUserId).filter(Boolean));
  const events = (eventsData?.events ?? []).filter((ev) => {
    // If no rep filter or event has no repId, show it
    if (activeGhlIds.size === 0 || !ev.repId) return true;
    return activeGhlIds.has(ev.repId);
  });
  const googleNotConfig   = eventsData?.googleNotConfigured ?? false;

  // ── Fetch conflicts (only when exactly one rep selected) ─────────────────
  const singleMember = activeReps.length === 1
    ? members.find((m) => m.id === activeReps[0])
    : null;
  const singleRepEmail = singleMember?.email ?? null;

  const { data: conflictsData } = useQuery<{ conflicts: ConflictBlock[] }>({
    queryKey: ["calendar-conflicts", singleRepEmail, since, until],
    queryFn: () =>
      fetch(
        `/api/calendar/conflicts?repEmail=${encodeURIComponent(singleRepEmail!)}&since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`
      ).then((r) => r.json()),
    enabled: !!singleRepEmail && view !== "month",
    staleTime: 60_000,
  });

  const conflicts = conflictsData?.conflicts ?? [];

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId]
  );

  // ── Navigation ────────────────────────────────────────────────────────────
  function navigate(dir: "prev" | "next") {
    setCurrentDate((d) => {
      if (view === "week")  return dir === "prev" ? subWeeks(d, 1) : addWeeks(d, 1);
      if (view === "month") return dir === "prev" ? subMonths(d, 1) : addMonths(d, 1);
      return dir === "prev" ? subDays(d, 1) : addDays(d, 1);
    });
  }

  function goToday() {
    setCurrentDate(new Date());
  }

  function toggleRep(memberId: string) {
    setActiveReps((prev) =>
      prev.includes(memberId) ? prev.filter((e) => e !== memberId) : [...prev, memberId]
    );
  }

  /** Open BookCallDrawer pre-filled from a clicked time slot */
  function openBookCallAt(date: Date, hour: number, minute: number) {
    const dateStr = format(date, "yyyy-MM-dd");
    const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    setBookCallInitialDate(dateStr);
    setBookCallInitialStartTime(timeStr);
    setBookCallOpen(true);
  }

  /** Open BookCallDrawer pre-filled from a month day click (default 9:00 AM) */
  function openBookCallForDay(date: Date) {
    setBookCallInitialDate(format(date, "yyyy-MM-dd"));
    setBookCallInitialStartTime("09:00");
    setBookCallOpen(true);
  }

  // Week day columns for header (always Mon–Sun)
  const weekDays = useMemo(() => {
    if (view === "week") return eachDayOfInterval({ start: getWeekStart(currentDate), end: getWeekEnd(currentDate) });
    if (view === "day") return [currentDate];
    return [];
  }, [view, currentDate]);

  // ── Google not configured notice ──────────────────────────────────────────
  if (!eventsLoading && googleNotConfig) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 p-8 text-center">
        <Calendar className="w-10 h-10 text-border" />
        <p className="text-sm font-semibold text-foreground">
          Google Workspace not connected
        </p>
        <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">
          Connect Google Workspace to view your team&apos;s calendar. Set{" "}
          <code className="bg-muted px-1 py-0.5 rounded text-[11px]">GOOGLE_SERVICE_ACCOUNT_EMAIL</code>{" "}
          and{" "}
          <code className="bg-muted px-1 py-0.5 rounded text-[11px]">GOOGLE_SERVICE_ACCOUNT_KEY</code>{" "}
          in your environment.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 border-b border-border h-12 shrink-0">

        {/* Left: navigation */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => navigate("prev")}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Previous"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => navigate("next")}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Next"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={goToday}
            className="ml-1 px-2.5 py-1 text-xs font-medium border border-border rounded-[7px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Today
          </button>
        </div>

        {/* Center: range label */}
        <div className="flex-1 flex justify-center">
          <span
            className="text-sm font-semibold text-foreground"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {rangeLabel(view, currentDate, tz)}
          </span>
        </div>

        {/* Right: rep pills + view switcher + book */}
        <div className="flex items-center gap-2">

          {/* Rep filter pills */}
          {members.length > 0 && (
            <div className="flex items-center gap-1.5">
              {members.map((m) => {
                const active = activeReps.includes(m.id);
                return (
                  <button
                    key={m.id}
                    onClick={() => toggleRep(m.id)}
                    title={m.email}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all",
                      active
                        ? "border-transparent text-foreground"
                        : "border-border text-muted-foreground opacity-50 hover:opacity-80"
                    )}
                    style={active ? { backgroundColor: `${m.color}18`, borderColor: `${m.color}40` } : {}}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: m.color }}
                    />
                    {m.name.split(" ")[0]}
                  </button>
                );
              })}
            </div>
          )}

          {/* View switcher */}
          <div className="flex items-center border border-border rounded-[8px] overflow-hidden text-xs font-medium">
            {(["week", "month", "day"] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "px-3 py-1.5 capitalize transition-colors",
                  view === v
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                {v}
              </button>
            ))}
          </div>

          {/* Book call */}
          <button
            onClick={() => {
              setBookCallInitialDate(undefined);
              setBookCallInitialStartTime(undefined);
              setBookCallOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-[8px] hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Book Call
          </button>
        </div>
      </div>

      {/* ── Calendar grid ─────────────────────────────────────────────────── */}
      {view === "month" ? (
        <MonthGrid
          currentDate={currentDate}
          events={events}
          repColors={repColors}
          onEventClick={(ev) => setSelectedEventId(ev.id)}
          onDayClick={openBookCallForDay}
          tz={tz}
        />
      ) : (
        <>
          <DayHeaders days={weekDays} tz={tz} />
          {eventsLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-2">
                <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                <p className="text-xs text-muted-foreground">Loading events…</p>
              </div>
            </div>
          ) : (
            <TimeGrid
              days={weekDays}
              events={events}
              repColors={repColors}
              conflicts={conflicts}
              onEventClick={(ev) => setSelectedEventId(ev.id)}
              onEmptyClick={openBookCallAt}
              tz={tz}
            />
          )}
        </>
      )}

      {/* ── Event panel ───────────────────────────────────────────────────── */}
      <EventPanel
        event={selectedEvent}
        repColors={repColors}
        userCalendars={members.map((m) => ({
          id: m.id,
          repName: m.name,
          repEmail: m.email,
          color: m.color,
        }))}
        onClose={() => setSelectedEventId(null)}
        onBook={() => { setSelectedEventId(null); setBookCallOpen(true); }}
        onCancelled={() => setSelectedEventId(null)}
      />

      {/* ── Book call drawer ──────────────────────────────────────────────── */}
      <BookCallDrawer
        open={bookCallOpen}
        onClose={() => {
          setBookCallOpen(false);
          setBookCallInitialDate(undefined);
          setBookCallInitialStartTime(undefined);
        }}
        onBooked={() => {
          // Trigger refetch by invalidating — react-query will auto-refetch on next render
          setBookCallOpen(false);
          setBookCallInitialDate(undefined);
          setBookCallInitialStartTime(undefined);
        }}
        initialDate={bookCallInitialDate}
        initialStartTime={bookCallInitialStartTime}
      />
    </div>
  );
}
