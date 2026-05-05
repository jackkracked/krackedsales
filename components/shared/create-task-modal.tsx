"use client";

import { useState } from "react";
import { X, ListTodo, CheckCircle2 } from "lucide-react";
import { useTasksStore } from "@/store/tasks-store";
import { format } from "date-fns";

interface CreateTaskModalProps {
  contactId?: string;
  contactName?: string;
  opportunityId?: string;
  onClose: () => void;
}

export function CreateTaskModal({
  contactId,
  contactName,
  opportunityId,
  onClose,
}: CreateTaskModalProps) {
  const addTask = useTasksStore((s) => s.addTask);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [error, setError] = useState("");
  const [created, setCreated] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError("Title is required"); return; }

    addTask({
      title: title.trim(),
      notes: notes.trim() || null,
      dueDate: dueDate || null,
      contactId: contactId ?? null,
      contactName: contactName ?? null,
      opportunityId: opportunityId ?? null,
    });

    setCreated(true);
    setTimeout(onClose, 1200);
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
    >
      <div className="bg-card border border-border rounded-[12px] w-full max-w-md shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <ListTodo className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Create Task</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-[6px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {contactName && (
            <div className="text-xs text-muted-foreground bg-muted/40 border border-border/60 rounded-[7px] px-3 py-2">
              Linked to <span className="font-medium text-foreground">{contactName}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Task Title <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => { setTitle(e.target.value); setError(""); }}
              placeholder="e.g. Follow up on proposal"
              autoFocus
              className="w-full text-sm px-3 py-2.5 border border-border rounded-[7px] bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Due Date
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full text-sm px-3 py-2.5 border border-border rounded-[7px] bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional details…"
              rows={3}
              className="w-full text-sm px-3 py-2.5 border border-border rounded-[7px] bg-background text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-colors"
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={created}
              className="flex-1 py-2.5 text-sm font-medium text-foreground border border-border rounded-[7px] hover:bg-muted transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={created}
              className={`flex-1 py-2.5 text-sm font-semibold rounded-[7px] transition-all duration-300 flex items-center justify-center gap-2 ${
                created
                  ? "bg-green-600 text-white"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              }`}
            >
              {created ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Task Created
                </>
              ) : (
                "Create Task"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
