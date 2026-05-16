"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckSquare, CheckCircle2, Plus } from "lucide-react";
import { isPast, isToday } from "date-fns";
import { TaskTile, type Task } from "./task-tile";
import { TaskDrawer } from "./task-drawer";
import { CreateTaskModal } from "@/components/shared/create-task-modal";
import { CompleteTaskModal } from "./complete-task-modal";

function statusOrder(t: Task): number {
  if (!t.dueDate) return 3;
  const d = new Date(t.dueDate);
  if (isToday(d)) return 1;
  if (isPast(d)) return 0;
  return 2;
}

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

function sortTasks(list: Task[]): Task[] {
  return [...list].sort((a, b) => {
    const so = statusOrder(a) - statusOrder(b);
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

  const tasks = sortTasks(data?.tasks ?? []);

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
      <div className="bg-card border border-border rounded-[10px] p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CheckSquare className="w-4 h-4 text-muted-foreground" />
            <h3
              className="text-sm font-semibold text-foreground"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Tasks
            </h3>
            {tasks.length > 0 && (
              <span className="text-[10px] font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded-full tabular-nums">
                {tasks.length}
              </span>
            )}
          </div>

          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1 text-[12px] font-medium text-primary hover:text-primary/80 transition-colors px-2 py-1 rounded-[6px] hover:bg-primary/5"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
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
              className="hidden sm:flex gap-3 overflow-x-auto scroll-smooth pb-1"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
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
