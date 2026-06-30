"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckSquare, CheckCircle2, Plus, ArrowRight } from "lucide-react";
import Link from "next/link";
import { TaskTile, type Task } from "./task-tile";
import { useUserTimezone } from "@/providers/timezone-provider";
import { isTodayInTz, isPastInTz } from "@/lib/utils/timezone";
import { TaskDrawer } from "./task-drawer";
import { CreateTaskModal } from "@/components/shared/create-task-modal";
import { CompleteTaskModal } from "./complete-task-modal";

function statusOrder(t: Task, tz: string): number {
  if (!t.dueDate) return 3;
  const d = new Date(t.dueDate);
  if (isTodayInTz(d, tz)) return 1;
  if (isPastInTz(d, tz)) return 0;
  return 2;
}

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

function sortTasks(list: Task[], tz: string): Task[] {
  return [...list].sort((a, b) => {
    const so = statusOrder(a, tz) - statusOrder(b, tz);
    if (so !== 0) return so;
    const po = (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1);
    if (po !== 0) return po;
    if (a.dueDate && b.dueDate) {
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    }
    return 0;
  });
}

export function TasksStrip() {
  const tz = useUserTimezone();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // Completion flow state
  const [checkedTaskId, setCheckedTaskId] = useState<string | null>(null);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [completionTask, setCompletionTask] = useState<Task | null>(null);

  const { data, isLoading } = useQuery<{ tasks: Task[] }>({
    queryKey: ["tasks"],
    queryFn: () => fetch("/api/tasks").then((r) => r.json()),
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
  });

  const tasks = sortTasks(data?.tasks ?? [], tz);

  // ── Circle click: toggle checked state ──────────────────────────────────
  function handleCheck(task: Task, e: React.MouseEvent) {
    e.stopPropagation();
    setCheckedTaskId((prev) => (prev === task.id ? null : task.id));
  }

  function handleCancelCheck(e: React.MouseEvent) {
    e.stopPropagation();
    setCheckedTaskId(null);
  }

  // ── Complete button: open modal or complete instantly ───────────────────
  function handleRequestComplete(task: Task, e: React.MouseEvent) {
    e.stopPropagation();
    if (task.contactId) {
      // Has a linked contact: prompt for notes first
      setCompletionTask(task);
    } else {
      // No contact: complete immediately, no modal
      void doComplete(task, null);
    }
  }

  // ── Core completion logic ───────────────────────────────────────────────
  async function doComplete(task: Task, completionNotes: string | null) {
    setCheckedTaskId(null);
    setCompletionTask(null);
    setCompletingTaskId(task.id);

    try {
      // Mark task complete in DB
      await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: true }),
      });

      // Post note to GHL contact record (fire-and-forget, don't block UX)
      if (task.contactId) {
        const noteBody = completionNotes
          ? `✅ Task completed: ${task.title}\n\n${completionNotes}`
          : `✅ Task completed: ${task.title}`;

        fetch(`/api/ghl/contacts/${task.contactId}/notes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: noteBody, contactName: task.contactName }),
        }).catch(console.error);
      }

      // Optimistically remove tile after fade animation
      setTimeout(() => {
        queryClient.setQueryData<{ tasks: Task[] }>(["tasks"], (prev) => {
          if (!prev) return prev;
          return { tasks: prev.tasks.filter((t) => t.id !== task.id) };
        });
        if (selectedTask?.id === task.id) setSelectedTask(null);
        setCompletingTaskId(null);
      }, 380);
    } catch {
      setCompletingTaskId(null);
    }
  }

  function handleUpdate(updated: Task) {
    queryClient.setQueryData<{ tasks: Task[] }>(["tasks"], (prev) => {
      if (!prev) return prev;
      return { tasks: prev.tasks.map((t) => (t.id === updated.id ? updated : t)) };
    });
    setSelectedTask(updated);
  }

  function handleDrawerComplete(taskId: string) {
    queryClient.setQueryData<{ tasks: Task[] }>(["tasks"], (prev) => {
      if (!prev) return prev;
      return { tasks: prev.tasks.filter((t) => t.id !== taskId) };
    });
    if (selectedTask?.id === taskId) setSelectedTask(null);
  }

  return (
    <>
      <div data-r10n-card className="bg-card border border-border rounded-[10px] p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CheckSquare data-r10n-section-icon className="w-4 h-4 text-muted-foreground" />
            <h3
              data-r10n-section-title
              className="text-sm font-semibold text-foreground"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Tasks
            </h3>
            {tasks.length > 0 && (
              <span data-r10n-count className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {tasks.length}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/tasks"
              className="text-xs font-medium text-muted-foreground hover:text-foreground border border-border rounded-[7px] px-2.5 py-1.5 hover:bg-muted transition-colors flex items-center gap-1.5"
            >
              See all
              <ArrowRight className="w-3 h-3" />
            </Link>
            <button
              onClick={() => setShowCreate(true)}
              className="text-xs font-medium text-muted-foreground hover:text-foreground border border-border rounded-[7px] px-2.5 py-1.5 hover:bg-muted transition-colors flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-[108px] w-[320px] shrink-0 rounded-[10px] bg-muted/40 animate-pulse"
              />
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-7 text-center">
            <CheckCircle2 className="w-7 h-7 text-primary/25 mb-2" />
            <p className="text-sm font-medium text-foreground">All caught up</p>
            <p className="text-xs text-muted-foreground mt-0.5">No pending tasks.</p>
          </div>
        ) : (
          <>
            {/* Desktop: horizontal scroll */}
            <div
              className="hidden sm:flex gap-3 overflow-x-auto scroll-smooth pb-2"
              style={{ scrollbarWidth: "thin" }}
            >
              {tasks.map((task) => (
                <div key={task.id} className="shrink-0 w-[320px]">
                  <TaskTile
                    task={task}
                    checked={checkedTaskId === task.id}
                    completing={completingTaskId === task.id}
                    onClick={() => {
                      setCheckedTaskId(null);
                      setSelectedTask(task);
                    }}
                    onCheck={(e) => handleCheck(task, e)}
                    onRequestComplete={(e) => handleRequestComplete(task, e)}
                    onCancelCheck={handleCancelCheck}
                  />
                </div>
              ))}
            </div>

            {/* Mobile: vertical stack */}
            <div className="flex flex-col gap-2 sm:hidden">
              {tasks.map((task) => (
                <TaskTile
                  key={task.id}
                  task={task}
                  checked={checkedTaskId === task.id}
                  completing={completingTaskId === task.id}
                  onClick={() => {
                    setCheckedTaskId(null);
                    setSelectedTask(task);
                  }}
                  onCheck={(e) => handleCheck(task, e)}
                  onRequestComplete={(e) => handleRequestComplete(task, e)}
                  onCancelCheck={handleCancelCheck}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Task detail drawer */}
      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onComplete={handleDrawerComplete}
          onUpdate={handleUpdate}
        />
      )}

      {/* Create task modal */}
      {showCreate && (
        <CreateTaskModal
          onClose={() => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ["tasks"] });
          }}
        />
      )}

      {/* Completion notes modal */}
      {completionTask && (
        <CompleteTaskModal
          task={completionTask}
          onConfirm={(notes) => doComplete(completionTask, notes)}
          onCancel={() => {
            setCompletionTask(null);
            setCheckedTaskId(null);
          }}
        />
      )}
    </>
  );
}
