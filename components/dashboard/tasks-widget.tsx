"use client";

import { useState, useEffect } from "react";
import { ListTodo, Circle, CheckCircle2, CalendarDays, X, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { format } from "date-fns";
import { useUserTimezone } from "@/providers/timezone-provider";
import { toZonedDate, isTodayInTz, isPastInTz } from "@/lib/utils/timezone";
import { useTasksStore, type Task } from "@/store/tasks-store";
import { CreateTaskModal } from "@/components/shared/create-task-modal";

// ─── Due badge ────────────────────────────────────────────────────────────────

function DueBadge({ dueDate }: { dueDate: string | null }) {
  const tz = useUserTimezone();
  if (!dueDate) return null;
  const d = new Date(dueDate);
  const overdue = isPastInTz(d, tz) && !isTodayInTz(d, tz);
  const today = isTodayInTz(d, tz);

  return (
    <span className={cn(
      "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
      overdue ? "bg-destructive/10 text-destructive" :
      today    ? "bg-amber-50 text-amber-700" :
                 "bg-muted text-muted-foreground"
    )}>
      {overdue ? "Overdue" : today ? "Today" : format(toZonedDate(d, tz), "d MMM")}
    </span>
  );
}

// ─── Task detail modal ────────────────────────────────────────────────────────

function TaskDetailModal({ task, onClose }: { task: Task; onClose: () => void }) {
  const tz = useUserTimezone();
  const { completeTask, deleteTask } = useTasksStore();

  function handleComplete() {
    completeTask(task.id);
    onClose();
  }

  function handleDelete() {
    deleteTask(task.id);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-[12px] w-full max-w-sm shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-border">
          <div className="flex-1 min-w-0 pr-3">
            <p className="text-sm font-semibold text-foreground leading-snug">{task.title}</p>
            {task.contactName && (
              <p className="text-xs text-muted-foreground mt-0.5">{task.contactName}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 rounded-[6px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Details */}
        <div className="px-5 py-4 space-y-3">
          {task.dueDate && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Due</p>
              <div className="flex items-center gap-2">
                <p className="text-sm text-foreground">
                  {format(toZonedDate(new Date(task.dueDate), tz), "EEEE, d MMMM yyyy")}
                </p>
                <DueBadge dueDate={task.dueDate} />
              </div>
            </div>
          )}

          {task.notes && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Notes</p>
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{task.notes}</p>
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Created</p>
            <p className="text-sm text-muted-foreground">
              {format(toZonedDate(new Date(task.createdAt), tz), "d MMM yyyy 'at' HH:mm")}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="px-5 pb-5 flex gap-2">
          <button
            onClick={handleDelete}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-destructive border border-destructive/20 rounded-[7px] hover:bg-destructive/5 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
          <button
            onClick={handleComplete}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold bg-primary text-primary-foreground rounded-[7px] hover:bg-primary/90 transition-colors"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Mark Complete
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main widget ──────────────────────────────────────────────────────────────

export function TasksWidget() {
  const { tasks, completeTask } = useTasksStore();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  // Map of taskId → timeout handle for undo grace period
  const [undoing, setUndoing] = useState<Record<string, ReturnType<typeof setTimeout>>>({});
  const [completing, setCompleting] = useState<Set<string>>(new Set());

  const pending = tasks
    .filter((t) => !t.completed)
    .sort((a, b) => {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });

  function handleCheckClick(e: React.MouseEvent, taskId: string) {
    e.stopPropagation();
    // Already in grace period — ignore double-click
    if (completing.has(taskId)) return;

    // Enter strikethrough/undo state
    setCompleting((prev) => new Set([...prev, taskId]));

    const timeout = setTimeout(() => {
      completeTask(taskId);
      setCompleting((prev) => { const s = new Set(prev); s.delete(taskId); return s; });
      setUndoing((prev) => { const u = { ...prev }; delete u[taskId]; return u; });
    }, 3000);

    setUndoing((prev) => ({ ...prev, [taskId]: timeout }));
  }

  function handleUndo(e: React.MouseEvent, taskId: string) {
    e.stopPropagation();
    clearTimeout(undoing[taskId]);
    setUndoing((prev) => { const u = { ...prev }; delete u[taskId]; return u; });
    setCompleting((prev) => { const s = new Set(prev); s.delete(taskId); return s; });
  }

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => { Object.values(undoing).forEach(clearTimeout); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="bg-card border border-border rounded-[10px] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <h3
            className="text-sm font-semibold text-foreground flex items-center gap-1.5"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <ListTodo className="w-3.5 h-3.5 text-muted-foreground" />
            Tasks
          </h3>
          <div className="flex items-center gap-2">
            {pending.length > 0 && (
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {pending.length}
              </span>
            )}
            <button
              onClick={() => setShowCreate(true)}
              className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
            >
              + Add
            </button>
          </div>
        </div>

        {/* Task list */}
        <div className="overflow-y-auto flex-1">
          {pending.length === 0 ? (
            <div className="py-8 text-center">
              <CalendarDays className="w-6 h-6 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">No pending tasks</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {pending.map((task) => {
                const isCompleting = completing.has(task.id);
                return (
                  <div
                    key={task.id}
                    onClick={() => !isCompleting && setSelectedTask(task)}
                    className={cn(
                      "relative flex items-start gap-3 px-4 py-3 transition-colors overflow-hidden",
                      isCompleting
                        ? "opacity-50 bg-muted/20"
                        : "hover:bg-muted/30 cursor-pointer"
                    )}
                  >
                    {isCompleting && (
                      <span
                        className="absolute bottom-0 left-0 h-[2px] bg-primary/40"
                        style={{ animation: "task-countdown 3s linear forwards" }}
                      />
                    )}
                    {/* Checkbox */}
                    <button
                      onClick={(e) => handleCheckClick(e, task.id)}
                      className={cn(
                        "mt-0.5 shrink-0 transition-colors",
                        isCompleting ? "text-green-600" : "text-muted-foreground hover:text-primary"
                      )}
                    >
                      {isCompleting
                        ? <CheckCircle2 className="w-4 h-4" />
                        : <Circle className="w-4 h-4" />
                      }
                    </button>

                    <div className="flex-1 min-w-0">
                      <p className={cn(
                        "text-sm font-medium text-foreground leading-snug",
                        isCompleting && "line-through text-muted-foreground"
                      )}>
                        {task.title}
                      </p>
                      {task.contactName && !isCompleting && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{task.contactName}</p>
                      )}
                      {isCompleting ? (
                        <button
                          onClick={(e) => handleUndo(e, task.id)}
                          className="text-[11px] font-medium text-primary hover:text-primary/80 transition-colors mt-0.5"
                        >
                          Undo
                        </button>
                      ) : (
                        task.dueDate && (
                          <div className="mt-1">
                            <DueBadge dueDate={task.dueDate} />
                          </div>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {showCreate && <CreateTaskModal onClose={() => setShowCreate(false)} />}
      {selectedTask && <TaskDetailModal task={selectedTask} onClose={() => setSelectedTask(null)} />}
    </>
  );
}
