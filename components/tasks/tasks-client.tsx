"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  LayoutGrid,
  List,
  Columns3,
  Check,
  Calendar,
  User,
  Clock,
  AlertTriangle,
  X,
  ChevronDown,
  ChevronRight,
  Loader2,
  ListTodo,
  Users,
  Trash2,
  CalendarClock,
} from "lucide-react";
import {
  format,
  isPast,
  isToday,
  isTomorrow,
  isThisWeek,
  startOfWeek,
  endOfWeek,
  addWeeks,
  isWithinInterval,
} from "date-fns";
import { cn } from "@/lib/utils/cn";
import { useUserTimezone } from "@/providers/timezone-provider";
import { toZonedDate, isTodayInTz, isPastInTz } from "@/lib/utils/timezone";
import { Avatar } from "@/components/ui/avatar";
import { CreateTaskModal } from "@/components/shared/create-task-modal";
import { TaskDrawer } from "@/components/dashboard/tasks-strip/task-drawer";
import { CompleteTaskModal } from "@/components/dashboard/tasks-strip/complete-task-modal";
import type { Task } from "@/components/dashboard/tasks-strip/task-tile";

// ─── Types ───────────────────────────────────────────────────────────────────

type ViewMode = "tiles" | "list" | "board";
type FilterTab = "all" | "today" | "overdue" | "high" | "completed";

interface TaskGroup {
  key: string;
  label: string;
  color?: string;
  tasks: Task[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isOverdue(t: Task, tz: string): boolean {
  if (!t.dueDate || t.completed) return false;
  return isPastInTz(new Date(t.dueDate), tz) && !isTodayInTz(new Date(t.dueDate), tz);
}

function isDueToday(t: Task, tz: string): boolean {
  if (!t.dueDate || t.completed) return false;
  return isTodayInTz(new Date(t.dueDate), tz);
}

function isDueTomorrow(t: Task): boolean {
  if (!t.dueDate || t.completed) return false;
  return isTomorrow(new Date(t.dueDate));
}

function isDueThisWeek(t: Task, tz: string): boolean {
  if (!t.dueDate || t.completed) return false;
  const d = new Date(t.dueDate);
  return isThisWeek(d, { weekStartsOn: 1 }) && !isTodayInTz(d, tz) && !isTomorrow(d) && !isPastInTz(d, tz);
}

function isDueNextWeek(t: Task): boolean {
  if (!t.dueDate || t.completed) return false;
  const d = new Date(t.dueDate);
  const nextWeekStart = startOfWeek(addWeeks(new Date(), 1), { weekStartsOn: 1 });
  const nextWeekEnd = endOfWeek(addWeeks(new Date(), 1), { weekStartsOn: 1 });
  return isWithinInterval(d, { start: nextWeekStart, end: nextWeekEnd });
}

function isCompletedThisWeek(t: Task): boolean {
  if (!t.completed) return false;
  const ref = t.dueDate ? new Date(t.dueDate) : new Date(t.createdAt);
  return isThisWeek(ref, { weekStartsOn: 1 });
}

function groupTasks(tasks: Task[], tz: string): TaskGroup[] {
  const buckets: Record<string, Task[]> = {
    overdue: [],
    today: [],
    tomorrow: [],
    thisWeek: [],
    nextWeek: [],
    later: [],
    noDate: [],
  };

  for (const t of tasks) {
    if (t.completed) continue;
    if (!t.dueDate) { buckets.noDate.push(t); continue; }
    if (isOverdue(t, tz)) { buckets.overdue.push(t); continue; }
    if (isDueToday(t, tz)) { buckets.today.push(t); continue; }
    if (isDueTomorrow(t)) { buckets.tomorrow.push(t); continue; }
    if (isDueThisWeek(t, tz)) { buckets.thisWeek.push(t); continue; }
    if (isDueNextWeek(t)) { buckets.nextWeek.push(t); continue; }
    buckets.later.push(t);
  }

  const groups: TaskGroup[] = [];
  if (buckets.overdue.length) groups.push({ key: "overdue", label: "Overdue", color: "text-rose-500", tasks: buckets.overdue });
  if (buckets.today.length) groups.push({ key: "today", label: "Today", color: "text-amber-600", tasks: buckets.today });
  if (buckets.tomorrow.length) groups.push({ key: "tomorrow", label: "Tomorrow", tasks: buckets.tomorrow });
  if (buckets.thisWeek.length) groups.push({ key: "thisWeek", label: "This Week", tasks: buckets.thisWeek });
  if (buckets.nextWeek.length) groups.push({ key: "nextWeek", label: "Next Week", tasks: buckets.nextWeek });
  if (buckets.later.length) groups.push({ key: "later", label: "Later", tasks: buckets.later });
  if (buckets.noDate.length) groups.push({ key: "noDate", label: "No Date", tasks: buckets.noDate });

  return groups;
}

const PRIORITY_DOT: Record<string, string> = {
  high: "bg-red-500",
  medium: "bg-amber-400",
  low: "bg-muted-foreground/40",
};

function urgencyColor(dueDate: string | null, completed: boolean, tz: string): string {
  if (completed || !dueDate) return "text-muted-foreground";
  const d = new Date(dueDate);
  if (isTodayInTz(d, tz)) return "text-amber-600";
  if (isPastInTz(d, tz)) return "text-rose-500";
  return "text-muted-foreground";
}

function dueDateLabel(dueDate: string, tz: string): string {
  const d = new Date(dueDate);
  if (isTodayInTz(d, tz)) return "Today";
  if (isTomorrow(d)) return "Tomorrow";
  return format(toZonedDate(d, tz), "EEE, MMM d");
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TasksClient() {
  const tz = useUserTimezone();
  const queryClient = useQueryClient();

  // State
  const [view, setView] = useState<ViewMode>("tiles");
  const [filter, setFilter] = useState<FilterTab>("all");
  const [teamView, setTeamView] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [completionTask, setCompletionTask] = useState<Task | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [bulkActioning, setBulkActioning] = useState(false);

  // Determine what status to fetch based on filter
  const apiStatus = filter === "completed" ? "completed" : "all";

  // Fetch tasks
  const { data, isLoading } = useQuery<{ tasks: Task[] }>({
    queryKey: ["tasks-page", teamView ? "team" : "my", apiStatus],
    queryFn: async () => {
      const params = new URLSearchParams({
        view: teamView ? "team" : "my",
        status: apiStatus,
      });
      const res = await fetch(`/api/tasks?${params}`);
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const allTasks = data?.tasks ?? [];

  // Client-side filtering for tabs
  const filteredTasks = useMemo(() => {
    switch (filter) {
      case "today":
        return allTasks.filter((t) => !t.completed && isDueToday(t, tz));
      case "overdue":
        return allTasks.filter((t) => isOverdue(t, tz));
      case "high":
        return allTasks.filter((t) => !t.completed && t.priority === "high");
      case "completed":
        return allTasks.filter((t) => t.completed);
      default:
        return allTasks.filter((t) => !t.completed);
    }
  }, [allTasks, filter, tz]);

  // Stats
  const stats = useMemo(() => {
    const incomplete = allTasks.filter((t) => !t.completed);
    return {
      overdue: incomplete.filter((t) => isOverdue(t, tz)).length,
      today: incomplete.filter((t) => isDueToday(t, tz)).length,
      thisWeek: incomplete.filter((t) => t.dueDate && isThisWeek(new Date(t.dueDate), { weekStartsOn: 1 })).length,
      completedThisWeek: allTasks.filter(isCompletedThisWeek).length,
    };
  }, [allTasks, tz]);

  // Grouped tasks for tile/board views
  const groups = useMemo(() => groupTasks(filteredTasks, tz), [filteredTasks, tz]);

  // Keyboard shortcut: Cmd+N
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        setShowCreate(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // ── Selection ────────────────────────────────────────────────────────────

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  // ── Completion flow ──────────────────────────────────────────────────────

  const doComplete = useCallback(async (task: Task, completionNotes: string | null) => {
    setCompletionTask(null);

    try {
      await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: true }),
      });

      if (task.contactId) {
        const noteBody = completionNotes
          ? `Task completed: ${task.title}\n\n${completionNotes}`
          : `Task completed: ${task.title}`;
        fetch(`/api/ghl/contacts/${task.contactId}/notes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: noteBody, contactName: task.contactName }),
        }).catch(console.error);
      }

      queryClient.invalidateQueries({ queryKey: ["tasks-page"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    } catch (err) {
      console.error("Failed to complete task", err);
    }
  }, [queryClient]);

  function requestComplete(task: Task) {
    if (task.contactId) {
      setCompletionTask(task);
    } else {
      doComplete(task, null);
    }
  }

  // ── Bulk actions ─────────────────────────────────────────────────────────

  async function bulkComplete() {
    setBulkActioning(true);
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) =>
          fetch(`/api/tasks/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ completed: true }),
          })
        )
      );
      clearSelection();
      queryClient.invalidateQueries({ queryKey: ["tasks-page"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    } finally {
      setBulkActioning(false);
    }
  }

  async function bulkDelete() {
    if (!confirm(`Delete ${selectedIds.size} task${selectedIds.size > 1 ? "s" : ""}? This cannot be undone.`)) return;
    setBulkActioning(true);
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) =>
          fetch(`/api/tasks/${id}`, { method: "DELETE" })
        )
      );
      clearSelection();
      queryClient.invalidateQueries({ queryKey: ["tasks-page"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    } finally {
      setBulkActioning(false);
    }
  }

  // ── Drawer handlers ──────────────────────────────────────────────────────

  function handleDrawerComplete(taskId: string) {
    queryClient.invalidateQueries({ queryKey: ["tasks-page"] });
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    if (selectedTask?.id === taskId) setSelectedTask(null);
  }

  function handleDrawerUpdate(updated: Task) {
    queryClient.setQueryData<{ tasks: Task[] }>(
      ["tasks-page", teamView ? "team" : "my", apiStatus],
      (prev) => {
        if (!prev) return prev;
        return { tasks: prev.tasks.map((t) => (t.id === updated.id ? updated : t)) };
      }
    );
    setSelectedTask(updated);
  }

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const FILTERS: { key: FilterTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "today", label: "Due Today" },
    { key: "overdue", label: "Overdue" },
    { key: "high", label: "High Priority" },
    { key: "completed", label: "Completed" },
  ];

  return (
    <>
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="shrink-0 px-6 pt-6 pb-0">
          <div className="flex items-start justify-between mb-5">
            <div>
              <h1
                className="text-xl font-bold text-foreground tracking-tight"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                Tasks
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Your command center for everything that needs doing
              </p>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground rounded-[8px] hover:bg-primary/90 transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" />
              New Task
            </button>
          </div>

          {/* Stats bar */}
          <div className="flex gap-3 mb-5">
            <StatCard
              label="Overdue"
              value={stats.overdue}
              color="text-rose-600"
              bg="bg-red-50 border-red-200"
              onClick={() => setFilter("overdue")}
            />
            <StatCard
              label="Due Today"
              value={stats.today}
              color="text-amber-600"
              bg="bg-amber-50 border-amber-200"
              onClick={() => setFilter("today")}
            />
            <StatCard
              label="This Week"
              value={stats.thisWeek}
              color="text-foreground"
              bg="bg-card border-border"
              onClick={() => setFilter("all")}
            />
            <StatCard
              label="Completed"
              value={stats.completedThisWeek}
              color="text-emerald-600"
              bg="bg-emerald-50 border-emerald-200"
              onClick={() => setFilter("completed")}
            />
          </div>

          {/* Filter tabs + View toggle */}
          <div className="flex items-center justify-between gap-4 pb-4 border-b border-border">
            <div className="flex items-center gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => { setFilter(f.key); clearSelection(); }}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-[7px] transition-colors",
                    filter === f.key
                      ? "bg-foreground/8 text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  {f.label}
                </button>
              ))}

              {/* Team toggle */}
              <div className="ml-3 pl-3 border-l border-border">
                <button
                  onClick={() => { setTeamView(!teamView); clearSelection(); }}
                  className={cn(
                    "flex items-center gap-1.5 border rounded-[7px] px-3 py-1 text-xs font-medium transition-colors",
                    teamView
                      ? "border-primary/30 bg-primary/5 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  <Users className="w-3 h-3" />
                  Team
                </button>
              </div>
            </div>

            {/* View toggle */}
            <div className="flex items-center border border-border rounded-[8px] overflow-hidden">
              {([
                { key: "tiles" as ViewMode, icon: LayoutGrid },
                { key: "list" as ViewMode, icon: List },
                { key: "board" as ViewMode, icon: Columns3 },
              ]).map(({ key, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setView(key)}
                  className={cn(
                    "p-1.5 transition-colors",
                    view === key
                      ? "bg-foreground/8 text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Main content area */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
            </div>
          ) : filteredTasks.length === 0 ? (
            <EmptyState filter={filter} />
          ) : view === "tiles" ? (
            <TilesView
              groups={filter === "completed" ? [{ key: "completed", label: "Completed", tasks: filteredTasks }] : groups}
              teamView={teamView}
              selectedIds={selectedIds}
              collapsedGroups={collapsedGroups}
              onToggleGroup={toggleGroup}
              onToggleSelect={toggleSelect}
              onClickTask={setSelectedTask}
              onRequestComplete={requestComplete}
            />
          ) : view === "list" ? (
            <ListView
              tasks={filteredTasks}
              teamView={teamView}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onClickTask={setSelectedTask}
              onRequestComplete={requestComplete}
            />
          ) : (
            <BoardView
              tasks={filteredTasks}
              teamView={teamView}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onClickTask={setSelectedTask}
              onRequestComplete={requestComplete}
            />
          )}
        </div>

        {/* Floating bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 bg-card border border-border shadow-xl rounded-[10px] px-4 py-2.5">
            <span className="text-xs font-semibold text-foreground tabular-nums">
              {selectedIds.size} selected
            </span>
            <div className="w-px h-4 bg-border" />
            <button
              onClick={bulkComplete}
              disabled={bulkActioning}
              className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 hover:text-emerald-700 transition-colors disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              Complete
            </button>
            <button
              onClick={bulkDelete}
              disabled={bulkActioning}
              className="flex items-center gap-1.5 text-xs font-medium text-rose-500 hover:text-rose-600 transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
            <div className="w-px h-4 bg-border" />
            <button
              onClick={clearSelection}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Modals & Drawer */}
      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onComplete={handleDrawerComplete}
          onUpdate={handleDrawerUpdate}
        />
      )}

      {showCreate && (
        <CreateTaskModal
          onClose={() => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ["tasks-page"] });
            queryClient.invalidateQueries({ queryKey: ["tasks"] });
          }}
        />
      )}

      {completionTask && (
        <CompleteTaskModal
          task={completionTask}
          onConfirm={(notes) => doComplete(completionTask, notes)}
          onCancel={() => setCompletionTask(null)}
        />
      )}
    </>
  );
}

// ─── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({ label, value, color, bg, onClick }: { label: string; value: number; color: string; bg: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={cn("flex-1 rounded-[10px] border p-4 transition-all", bg, onClick && "cursor-pointer hover:shadow-sm hover:scale-[1.02]")}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn("text-2xl font-bold tabular-nums mt-1", color)}
        style={{ fontFamily: "var(--font-heading)" }}
      >
        {value}
      </p>
    </div>
  );
}

// ─── Empty State ─────────────────────────────────────────────────────────────

function EmptyState({ filter }: { filter: FilterTab }) {
  const messages: Record<FilterTab, { icon: React.ElementType; title: string; sub: string }> = {
    all: { icon: ListTodo, title: "No open tasks", sub: "Create a task to get started" },
    today: { icon: Calendar, title: "Nothing due today", sub: "You're all clear for today" },
    overdue: { icon: AlertTriangle, title: "No overdue tasks", sub: "You're right on schedule" },
    high: { icon: AlertTriangle, title: "No high priority tasks", sub: "Nothing urgent right now" },
    completed: { icon: Check, title: "No completed tasks yet", sub: "Completed tasks will appear here" },
  };
  const m = messages[filter];
  const Icon = m.icon;
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <Icon className="w-8 h-8 text-muted-foreground/20 mb-3" />
      <p className="text-sm font-semibold text-foreground">{m.title}</p>
      <p className="text-xs text-muted-foreground mt-1">{m.sub}</p>
    </div>
  );
}

// ─── Task Tile (for Tiles + Board views) ─────────────────────────────────────

function TaskCard({
  task,
  teamView,
  selected,
  onToggleSelect,
  onClick,
  onRequestComplete,
}: {
  task: Task;
  teamView: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onClick: (t: Task) => void;
  onRequestComplete: (t: Task) => void;
}) {
  const tz = useUserTimezone();
  const overdue = isOverdue(task, tz);
  const today = isDueToday(task, tz);

  return (
    <div
      onClick={() => onClick(task)}
      className={cn(
        "bg-card border rounded-[10px] p-4 cursor-pointer transition-all group relative",
        "hover:shadow-sm hover:border-primary/30",
        overdue && "border-red-200 bg-red-50/30",
        today && !overdue && "border-amber-200 bg-amber-50/30",
        !overdue && !today && "border-border",
        selected && "ring-2 ring-primary/30"
      )}
    >
      {/* Top row: priority + due date */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className={cn("w-2 h-2 rounded-full shrink-0", PRIORITY_DOT[task.priority] ?? PRIORITY_DOT.medium)} />
          <span className="text-[10px] font-medium text-muted-foreground capitalize">{task.priority}</span>
        </div>
        {task.dueDate && (
          <span className={cn("text-[10px] font-semibold uppercase tracking-wide", urgencyColor(task.dueDate, task.completed, tz))}>
            {dueDateLabel(task.dueDate, tz)}
          </span>
        )}
      </div>

      {/* Title row: checkbox slides in + complete circle + title */}
      <div className="flex items-start gap-0 mb-2">
        {/* Bulk select checkbox — slides in on hover */}
        <div className={cn(
          "overflow-hidden transition-all duration-150 flex items-center shrink-0 pt-0.5",
          selected ? "w-6 opacity-100" : "w-0 opacity-0 group-hover:w-6 group-hover:opacity-100"
        )}>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleSelect(task.id); }}
            className={cn(
              "w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors",
              selected ? "bg-primary border-primary text-primary-foreground" : "border-border hover:border-primary/50"
            )}
          >
            {selected && <Check className="w-2.5 h-2.5" strokeWidth={3} />}
          </button>
        </div>
        {/* Complete circle */}
        {!task.completed && (
          <button
            onClick={(e) => { e.stopPropagation(); onRequestComplete(task); }}
            className="w-[18px] h-[18px] rounded-full border-2 border-border/60 hover:border-emerald-500 hover:bg-emerald-50 flex items-center justify-center transition-colors shrink-0 mr-2 mt-0.5"
            title="Mark complete"
          >
            <Check className="w-2 h-2 text-transparent group-hover:text-emerald-500/50" />
          </button>
        )}
        <p className="text-sm font-semibold text-foreground leading-tight line-clamp-2">
          {task.title}
        </p>
      </div>

      {/* Contact */}
      {task.contactName && (
        <div className="flex items-center gap-1 mb-1">
          <User className="w-3 h-3 text-muted-foreground/50" />
          <span className="text-xs text-muted-foreground truncate">{task.contactName}</span>
        </div>
      )}

      {/* Notes */}
      {task.notes && (
        <p className="text-xs text-muted-foreground/70 line-clamp-1 italic mb-2">
          {task.notes}
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center gap-2 mt-auto">
        {teamView && task.userName && (
          <Avatar name={task.userName} size={20} variant="rep" />
        )}
        {task.opportunityId && (
          <span className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
            <CalendarClock className="w-3 h-3" />
            Linked to opportunity
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Tiles View ──────────────────────────────────────────────────────────────

function TilesView({
  groups,
  teamView,
  selectedIds,
  collapsedGroups,
  onToggleGroup,
  onToggleSelect,
  onClickTask,
  onRequestComplete,
}: {
  groups: TaskGroup[];
  teamView: boolean;
  selectedIds: Set<string>;
  collapsedGroups: Set<string>;
  onToggleGroup: (key: string) => void;
  onToggleSelect: (id: string) => void;
  onClickTask: (t: Task) => void;
  onRequestComplete: (t: Task) => void;
}) {
  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const collapsed = collapsedGroups.has(group.key);
        return (
          <div key={group.key}>
            <button
              onClick={() => onToggleGroup(group.key)}
              className="flex items-center gap-2 mb-3 group/header"
            >
              {collapsed ? (
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
              )}
              <span className={cn(
                "text-xs font-semibold uppercase tracking-wide",
                group.color ?? "text-muted-foreground"
              )}>
                {group.label}
              </span>
              <span className="bg-muted px-2 py-0.5 rounded-full text-xs text-muted-foreground tabular-nums">
                {group.tasks.length}
              </span>
            </button>
            {!collapsed && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {group.tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    teamView={teamView}
                    selected={selectedIds.has(task.id)}
                    onToggleSelect={onToggleSelect}
                    onClick={onClickTask}
                    onRequestComplete={onRequestComplete}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── List View ───────────────────────────────────────────────────────────────

function ListView({
  tasks,
  teamView,
  selectedIds,
  onToggleSelect,
  onClickTask,
  onRequestComplete,
}: {
  tasks: Task[];
  teamView: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onClickTask: (t: Task) => void;
  onRequestComplete: (t: Task) => void;
}) {
  const tz = useUserTimezone();
  return (
    <div className="bg-card border border-border rounded-[10px] overflow-hidden">
      {/* Table header */}
      <div className="grid grid-cols-[1fr_160px_80px_120px_100px_100px] items-center px-4 py-2 border-b border-border bg-muted/30 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        <span>Title</span>
        <span>Contact</span>
        <span>Priority</span>
        <span>Due Date</span>
        {teamView && <span>Assignee</span>}
        <span>Created</span>
      </div>

      {/* Rows */}
      {tasks.map((task) => {
        const selected = selectedIds.has(task.id);
        return (
          <div
            key={task.id}
            onClick={() => onClickTask(task)}
            className={cn(
              "grid grid-cols-[1fr_160px_80px_120px_100px_100px] items-center px-4 py-2 border-b border-border/50 cursor-pointer transition-colors hover:bg-muted/20 group",
              selected && "bg-primary/5"
            )}
          >
            {/* Title with inline checkbox + complete circle */}
            <div className="flex items-center gap-0 min-w-0 pr-3">
              {/* Checkbox slides in on hover */}
              <div className={cn(
                "overflow-hidden transition-all duration-150 flex items-center shrink-0",
                selected ? "w-6 opacity-100" : "w-0 opacity-0 group-hover:w-6 group-hover:opacity-100"
              )}>
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleSelect(task.id); }}
                  className={cn(
                    "w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0",
                    selected ? "bg-primary border-primary text-primary-foreground" : "border-border hover:border-primary/50"
                  )}
                >
                  {selected && <Check className="w-2.5 h-2.5" strokeWidth={3} />}
                </button>
              </div>
              {!task.completed && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRequestComplete(task); }}
                  className="w-4 h-4 rounded-full border border-border hover:border-emerald-500 flex items-center justify-center transition-colors shrink-0 mr-2"
                >
                  <Check className="w-2 h-2 text-transparent group-hover:text-emerald-400" />
                </button>
              )}
              <span className={cn("text-sm font-medium truncate", task.completed && "line-through text-muted-foreground")}>
                {task.title}
              </span>
            </div>

            {/* Contact */}
            <span className="text-xs text-muted-foreground truncate">
              {task.contactName ?? "—"}
            </span>

            {/* Priority */}
            <div className="flex items-center gap-1.5">
              <span className={cn("w-2 h-2 rounded-full", PRIORITY_DOT[task.priority] ?? PRIORITY_DOT.medium)} />
              <span className="text-xs text-muted-foreground capitalize">{task.priority}</span>
            </div>

            {/* Due date */}
            <span className={cn("text-xs font-medium", urgencyColor(task.dueDate, task.completed, tz))}>
              {task.dueDate ? dueDateLabel(task.dueDate, tz) : "—"}
            </span>

            {/* Assignee */}
            {teamView && (
              <span className="text-xs text-muted-foreground truncate">
                {task.userName ?? "—"}
              </span>
            )}

            {/* Created */}
            <span className="text-xs text-muted-foreground">
              {format(toZonedDate(new Date(task.createdAt), tz), "MMM d")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Board View ──────────────────────────────────────────────────────────────

function BoardView({
  tasks,
  teamView,
  selectedIds,
  onToggleSelect,
  onClickTask,
  onRequestComplete,
}: {
  tasks: Task[];
  teamView: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onClickTask: (t: Task) => void;
  onRequestComplete: (t: Task) => void;
}) {
  const tz = useUserTimezone();
  const columns = useMemo(() => {
    const cols: { key: string; label: string; color?: string; tasks: Task[] }[] = [
      { key: "overdue", label: "Overdue", color: "text-rose-500", tasks: [] },
      { key: "today", label: "Today", color: "text-amber-600", tasks: [] },
      { key: "thisWeek", label: "This Week", tasks: [] },
      { key: "later", label: "Later", tasks: [] },
    ];

    for (const t of tasks) {
      if (t.completed) continue;
      if (isOverdue(t, tz)) { cols[0].tasks.push(t); continue; }
      if (isDueToday(t, tz)) { cols[1].tasks.push(t); continue; }
      if (t.dueDate && isThisWeek(new Date(t.dueDate), { weekStartsOn: 1 })) { cols[2].tasks.push(t); continue; }
      cols[3].tasks.push(t);
    }
    return cols;
  }, [tasks, tz]);

  return (
    <div className="flex gap-4 overflow-x-auto pb-4" style={{ scrollbarWidth: "thin" }}>
      {columns.map((col) => (
        <div key={col.key} className="min-w-[280px] flex-1">
          {/* Column header */}
          <div className="flex items-center gap-2 mb-3">
            <span className={cn("text-xs font-semibold uppercase tracking-wide", col.color ?? "text-muted-foreground")}>
              {col.label}
            </span>
            <span className="bg-muted px-2 py-0.5 rounded-full text-xs text-muted-foreground tabular-nums">
              {col.tasks.length}
            </span>
          </div>

          {/* Cards */}
          <div className="space-y-2">
            {col.tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                teamView={teamView}
                selected={selectedIds.has(task.id)}
                onToggleSelect={onToggleSelect}
                onClick={onClickTask}
                onRequestComplete={onRequestComplete}
              />
            ))}
            {col.tasks.length === 0 && (
              <div className="border border-dashed border-border/60 rounded-[10px] py-8 text-center">
                <p className="text-xs text-muted-foreground/40">No tasks</p>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
