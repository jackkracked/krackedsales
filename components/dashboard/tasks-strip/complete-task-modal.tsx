"use client";

import { useState } from "react";
import { X, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { Task } from "./task-tile";

interface CompleteTaskModalProps {
  task: Task;
  onConfirm: (notes: string | null) => Promise<void>;
  onCancel: () => void;
}

export function CompleteTaskModal({ task, onConfirm, onCancel }: CompleteTaskModalProps) {
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleConfirm() {
    setSaving(true);
    try {
      await onConfirm(notes.trim() || null);
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleConfirm();
    if (e.key === "Escape") onCancel();
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-card border border-border rounded-[12px] w-full max-w-sm shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-border">
          <div className="flex-1 min-w-0 pr-3">
            <div className="flex items-center gap-2 mb-0.5">
              <CheckCircle2 className="w-[15px] h-[15px] text-emerald-600 shrink-0" />
              <span className="text-sm font-semibold text-foreground">Mark Complete</span>
            </div>
            <p className="text-[12px] text-muted-foreground truncate">{task.title}</p>
          </div>
          <button
            onClick={onCancel}
            className="shrink-0 p-1 rounded-[6px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
              Completion Note
              <span className="ml-1.5 font-normal normal-case tracking-normal text-muted-foreground/50">optional</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add a completion note…"
              rows={3}
              autoFocus
              className="w-full text-sm px-3 py-2.5 border border-border rounded-[7px] bg-background text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-colors"
            />
            {task.contactName && (
              <p className="text-[11px] text-muted-foreground/60">
                Will be logged to {task.contactName}&apos;s record in GHL.
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="flex-1 py-2.5 text-sm font-medium text-foreground border border-border rounded-[7px] hover:bg-muted transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={saving}
              className={cn(
                "flex-1 py-2.5 text-sm font-semibold rounded-[7px] transition-all flex items-center justify-center gap-2",
                "bg-emerald-600 text-white hover:bg-emerald-700",
                saving && "opacity-80 cursor-not-allowed"
              )}
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Mark Complete"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
