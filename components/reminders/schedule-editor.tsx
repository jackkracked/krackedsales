"use client";

import { Plus, X, Clock } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { ScheduleStep } from "@/lib/reminders/defaults";

const ORD = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th", "11th", "12th"];

function anchorPhrase(anchor: "sent" | "due"): string {
  return anchor === "due" ? "after it's due" : "after it's sent";
}

export function ScheduleEditor({
  schedule,
  anchor,
  onChange,
}: {
  schedule: ScheduleStep[];
  anchor: "sent" | "due";
  onChange: (next: ScheduleStep[]) => void;
}) {
  function update(i: number, delayDays: number) {
    const next = schedule.map((s, idx) => (idx === i ? { ...s, delayDays: Math.max(0, Math.min(365, delayDays)) } : s));
    onChange(next);
  }
  function remove(i: number) {
    onChange(schedule.filter((_, idx) => idx !== i));
  }
  function add() {
    const last = schedule[schedule.length - 1]?.delayDays ?? 0;
    onChange([...schedule, { delayDays: last + 3, anchor }]);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Schedule</span>
      </div>

      {schedule.length === 0 ? (
        <p className="text-sm text-muted-foreground/70">No reminders scheduled. Add one below.</p>
      ) : (
        <ol className="flex flex-wrap items-stretch gap-2">
          {schedule.map((step, i) => (
            <li
              key={i}
              className="group relative flex items-center gap-2 rounded-[8px] border border-border bg-muted/40 py-2 pl-3 pr-2"
            >
              <span className="text-xs font-semibold text-muted-foreground">{ORD[i] ?? `#${i + 1}`}</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={step.delayDays}
                  onChange={(e) => update(i, parseInt(e.target.value, 10) || 0)}
                  aria-label={`${ORD[i] ?? `Step ${i + 1}`} reminder delay in days`}
                  className="w-12 rounded-[6px] border border-border bg-background px-2 py-1 text-center text-sm font-semibold tabular-nums text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
                <span className="text-sm text-muted-foreground">
                  {step.delayDays === 1 ? "day" : "days"} {anchorPhrase(anchor)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Remove ${ORD[i] ?? `step ${i + 1}`} reminder`}
                className="ml-1 rounded-[5px] p-1 text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ol>
      )}

      <button
        type="button"
        onClick={add}
        disabled={schedule.length >= 12}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-[8px] border border-dashed border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors",
          "hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40",
        )}
      >
        <Plus className="h-3.5 w-3.5" />
        Add reminder
      </button>
    </div>
  );
}
