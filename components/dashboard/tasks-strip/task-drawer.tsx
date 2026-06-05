"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  X,
  Calendar,
  Flag,
  ExternalLink,
  Trash2,
  CheckCircle2,
  Loader2,
  Link2Off,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils/cn";
import { useUserTimezone } from "@/providers/timezone-provider";
import { toZonedDate, isTodayInTz, isPastInTz } from "@/lib/utils/timezone";
import type { Task } from "./task-tile";
import { ActivityTab } from "@/components/activity/activity-tab";
import { OpportunityModal } from "@/components/pipeline/opportunity-modal";
import type { GHLOpportunity } from "@/lib/ghl/types";

interface TaskDrawerProps {
  task: Task;
  onClose: () => void;
  onComplete: (taskId: string) => void;
  onUpdate: (task: Task) => void;
}

const PRIORITIES = [
  {
    value: "high",
    label: "High",
    active: "text-destructive border-destructive/40 bg-destructive/5",
  },
  {
    value: "medium",
    label: "Medium",
    active: "text-amber-600 border-amber-400/50 bg-amber-50/60",
  },
  {
    value: "low",
    label: "Low",
    active: "text-muted-foreground border-border bg-muted/40",
  },
] as const;

type DateStatus = "overdue" | "today" | "upcoming" | "none";

function getDateStatus(dueDate: string | null, tz: string): DateStatus {
  if (!dueDate) return "none";
  const d = new Date(dueDate);
  if (isTodayInTz(d, tz)) return "today";
  if (isPastInTz(d, tz)) return "overdue";
  return "upcoming";
}

export function TaskDrawer({ task, onClose, onComplete, onUpdate }: TaskDrawerProps) {
  const tz = useUserTimezone();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [dueDate, setDueDate] = useState(
    task.dueDate ? task.dueDate.slice(0, 10) : ""
  );
  const [priority, setPriority] = useState(task.priority);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [cardOpp, setCardOpp] = useState<GHLOpportunity | null>(null);
  const [cardStageName, setCardStageName] = useState("");
  const [cardLoading, setCardLoading] = useState(false);

  const status = getDateStatus(dueDate || null, tz);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const patch = useCallback(
    async (fields: Partial<Task>) => {
      setSaving(true);
      try {
        const res = await fetch(`/api/tasks/${task.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fields),
        });
        const { task: updated } = await res.json();
        onUpdate(updated);
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
      } finally {
        setSaving(false);
      }
    },
    [task.id, onUpdate, queryClient]
  );

  async function handleTitleBlur() {
    const trimmed = title.trim();
    if (trimmed && trimmed !== task.title) {
      await patch({ title: trimmed });
    }
  }

  async function handleNotesBlur() {
    const val = notes || null;
    if (val !== task.notes) {
      await patch({ notes: val });
    }
  }

  async function handleDueDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setDueDate(val);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await patch({ dueDate: val ? new Date(val).toISOString() : null } as any);
  }

  async function handlePriority(p: string) {
    if (p === priority) return;
    setPriority(p);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await patch({ priority: p } as any);
  }

  async function handleComplete() {
    setCompleting(true);
    try {
      await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: true }),
      });
      onComplete(task.id);
      onClose();
    } catch {
      setCompleting(false);
    }
  }

  async function handleDelete() {
    await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    onComplete(task.id);
    onClose();
  }

  const [noOpp, setNoOpp] = useState(false);

  async function openOpportunityCard() {
    if (!task.contactId) return;
    setNoOpp(false);
    setCardLoading(true);
    try {
      const params = new URLSearchParams({ name: task.contactName ?? "" });
      const res = await fetch(`/api/ghl/contacts/${task.contactId}/opportunity?${params}`);
      const data = await res.json();
      if (data.opportunity) {
        setCardOpp(data.opportunity);
        setCardStageName(data.stageName ?? "");
      } else {
        setNoOpp(true);
      }
    } finally {
      setCardLoading(false);
    }
  }

  const createdLabel = format(toZonedDate(new Date(task.createdAt), tz), "d MMM yyyy");

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-foreground/15 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={cn(
          "fixed right-0 top-0 bottom-0 z-50 flex flex-col",
          "w-full sm:w-[420px]",
          "bg-card border-l border-border shadow-2xl",
          "animate-slide-in-right"
        )}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-border shrink-0">
          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              className="w-full text-[15px] font-semibold text-foreground bg-transparent border-none outline-none focus:ring-0 p-0 placeholder:text-muted-foreground/40"
              placeholder="Task title"
            />
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {task.userName && `${task.userName} · `}Created {createdLabel}
              {task.contactName && ` · ${task.contactName}`}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {saving && <Loader2 className="w-3.5 h-3.5 text-muted-foreground/50 animate-spin" />}
            <button
              onClick={onClose}
              className="p-1.5 rounded-[6px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {/* Due date + Priority */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            {/* Due date */}
            <div className="flex items-center gap-2">
              <Calendar
                className={cn(
                  "w-3.5 h-3.5 shrink-0",
                  status === "overdue" && "text-destructive",
                  status === "today" && "text-amber-500",
                  (status === "upcoming" || status === "none") && "text-muted-foreground"
                )}
              />
              <input
                type="date"
                value={dueDate}
                onChange={handleDueDateChange}
                className={cn(
                  "text-[12.5px] font-medium bg-transparent border-none outline-none cursor-pointer",
                  status === "overdue" && "text-destructive",
                  status === "today" && "text-amber-600",
                  status === "upcoming" && "text-foreground",
                  !dueDate && "text-muted-foreground"
                )}
              />
            </div>

            {/* Priority */}
            <div className="flex items-center gap-1.5">
              <Flag className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <div className="flex gap-1">
                {PRIORITIES.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => handlePriority(p.value)}
                    className={cn(
                      "text-[11px] font-medium px-2 py-0.5 rounded-full border transition-all",
                      priority === p.value
                        ? p.active
                        : "text-muted-foreground/60 border-border/40 hover:bg-muted/50 hover:text-muted-foreground"
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Linked opportunity */}
          <div>
            <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground/50 mb-2">
              Linked Opportunity
            </p>
            {task.opportunityId ? (
              <div className="flex items-center justify-between p-3 rounded-[8px] bg-muted/20 border border-border/60">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-foreground truncate">
                    {task.opportunityName ?? task.contactName ?? "Linked opportunity"}
                  </p>
                  {task.contactName && task.opportunityName &&
                    task.contactName !== task.opportunityName && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {task.contactName}
                    </p>
                  )}
                  {noOpp && (
                    <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                      No opportunity in GHL for this contact
                    </p>
                  )}
                </div>
                {task.contactId && !noOpp && (
                  <button
                    onClick={openOpportunityCard}
                    disabled={cardLoading}
                    className="shrink-0 ml-3 flex items-center gap-1 text-[12px] font-medium text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
                  >
                    {cardLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ExternalLink className="w-3.5 h-3.5" />
                    )}
                    Open
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground/60 bg-muted/10 border border-border/40 rounded-[8px] px-3 py-2.5">
                <Link2Off className="w-3.5 h-3.5 shrink-0" />
                No opportunity linked
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground/50 mb-2">
              Notes
            </p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={handleNotesBlur}
              rows={4}
              placeholder="Add notes..."
              className="w-full text-[13px] text-foreground bg-muted/15 border border-border/60 rounded-[8px] px-3 py-2.5 resize-none outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary placeholder:text-muted-foreground/30 transition-colors leading-relaxed"
            />
          </div>

          {/* Activity */}
          <div>
            <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground/50 mb-2">
              Activity
            </p>
            <ActivityTab entityType="task" entityId={task.id} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 py-4 border-t border-border shrink-0">
          {!showDeleteConfirm ? (
            <>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium text-destructive border border-destructive/20 rounded-[7px] hover:bg-destructive/5 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
              <button
                onClick={handleComplete}
                disabled={completing}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[12px] font-semibold bg-primary text-primary-foreground rounded-[7px] hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                {completing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                Mark Complete
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 px-3 py-2 text-[12px] font-medium border border-border rounded-[7px] hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 px-3 py-2 text-[12px] font-semibold bg-destructive text-destructive-foreground rounded-[7px] hover:bg-destructive/90 transition-colors"
              >
                Yes, delete
              </button>
            </>
          )}
        </div>
      </div>

      {/* Opportunity modal triggered from Open button */}
      {cardOpp && (
        <OpportunityModal
          opportunity={cardOpp}
          stageName={cardStageName}
          onClose={() => setCardOpp(null)}
        />
      )}
    </>
  );
}
