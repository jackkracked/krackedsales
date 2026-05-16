"use client";

import { Check, X } from "lucide-react";
import { format, isPast, isToday, differenceInCalendarDays } from "date-fns";
import { cn } from "@/lib/utils/cn";

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  dueDate: string | null;
  contactId: string | null;
  contactName: string | null;
  opportunityId: string | null;
  opportunityName: string | null;
  completed: boolean;
  userId: string | null;
  userName: string | null;
  priority: string;
  createdAt: string;
}

interface TaskTileProps {
  task: Task;
  checked: boolean;
  completing: boolean;
  onClick: () => void;
  onCheck: (e: React.MouseEvent) => void;
  onRequestComplete: (e: React.MouseEvent) => void;
  onCancelCheck: (e: React.MouseEvent) => void;
}

type DateStatus = "overdue" | "today" | "upcoming" | "none";

function getDateStatus(dueDate: string | null): DateStatus {
  if (!dueDate) return "none";
  const d = new Date(dueDate);
  if (isToday(d)) return "today";
  if (isPast(d)) return "overdue";
  return "upcoming";
}

function overdueText(dueDate: string): string {
  const days = differenceInCalendarDays(new Date(), new Date(dueDate));
  if (days === 1) return "Yesterday";
  if (days <= 6) return `${days}d ago`;
  return "Overdue";
}

const PRIORITY_DOT: Record<string, string> = {
  high: "bg-destructive",
  medium: "bg-amber-500",
};

export function TaskTile({
  task,
  checked,
  completing,
  onClick,
  onCheck,
  onRequestComplete,
  onCancelCheck,
}: TaskTileProps) {
  const status = getDateStatus(task.dueDate);
  const dot = PRIORITY_DOT[task.priority];

  return (
    <div
      onClick={onClick}
      className={cn(
        "relative h-[108px] flex items-stretch rounded-[10px] border bg-card cursor-pointer select-none overflow-hidden",
        "transition-all duration-200",
        !completing && "hover:shadow-sm",
        completing && "opacity-40 scale-[0.97] pointer-events-none",
        checked && "shadow-sm",
        status === "overdue" && "border-destructive/25 bg-destructive/[0.02]",
        status === "today" && "border-amber-400/50 bg-amber-50/25",
        (status === "upcoming" || status === "none") && "border-border"
      )}
    >
      {/* Circle */}
      <div className="flex items-center justify-center w-14 shrink-0">
        <button
          onClick={onCheck}
          aria-label={checked ? "Uncheck" : "Select to complete"}
          className={cn(
            "w-[26px] h-[26px] rounded-full border-2 flex items-center justify-center",
            "transition-all duration-150",
            checked
              ? "border-emerald-500 bg-emerald-500 text-white scale-[1.08]"
              : status === "overdue"
              ? "border-destructive/30 hover:border-destructive hover:bg-destructive/5"
              : status === "today"
              ? "border-amber-400/50 hover:border-amber-500 hover:bg-amber-50"
              : "border-border hover:border-primary/60 hover:bg-primary/5"
          )}
        >
          {checked && <Check className="w-3.5 h-3.5" strokeWidth={2.5} />}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col justify-center py-3 pr-2 gap-0.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {dot && <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dot)} />}
          <p className="text-[13.5px] font-semibold text-foreground truncate leading-snug">
            {task.title}
          </p>
        </div>
        {task.contactName && (
          <p className="text-[11.5px] text-muted-foreground truncate">
            {task.contactName}
          </p>
        )}
        {task.notes && (
          <p className="text-[11px] text-muted-foreground/60 line-clamp-2 leading-snug">
            {task.notes}
          </p>
        )}
      </div>

      {/* Right column — cross-fades between date info and action buttons */}
      <div
        className={cn(
          "relative flex flex-col items-center justify-center w-[68px] shrink-0 border-l overflow-hidden",
          checked
            ? "border-emerald-500/30 bg-emerald-50/60"
            : status === "overdue" ? "border-destructive/15" : "border-border/50"
        )}
        style={{ transition: "background-color 180ms ease, border-color 180ms ease" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Date — fades out when checked */}
        <div
          className="flex flex-col items-center gap-0 pointer-events-none"
          style={{
            opacity: checked ? 0 : 1,
            transition: "opacity 150ms ease",
          }}
        >
          {task.dueDate ? (
            <>
              <span
                className={cn(
                  "text-[17px] font-bold tabular-nums leading-none",
                  status === "overdue" && "text-destructive",
                  status === "today" && "text-amber-600",
                  status === "upcoming" && "text-foreground"
                )}
              >
                {format(new Date(task.dueDate), "d")}
              </span>
              <span className="text-[9.5px] uppercase tracking-wide text-muted-foreground mt-0.5">
                {format(new Date(task.dueDate), "EEE")}
              </span>
              <span
                className={cn(
                  "text-[8.5px] font-semibold mt-1 px-1.5 py-[2px] rounded-full uppercase tracking-wide",
                  status === "overdue" && "bg-destructive/10 text-destructive",
                  status === "today" && "bg-amber-100 text-amber-700",
                  status === "upcoming" && "bg-muted text-muted-foreground"
                )}
              >
                {status === "overdue"
                  ? overdueText(task.dueDate)
                  : status === "today"
                  ? "Today"
                  : format(new Date(task.dueDate), "MMM")}
              </span>
            </>
          ) : (
            <span className="text-[11px] text-muted-foreground/30">—</span>
          )}
        </div>

        {/* Action buttons — fades in when checked */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-2"
          style={{
            opacity: checked ? 1 : 0,
            transition: "opacity 150ms ease",
            pointerEvents: checked ? "auto" : "none",
          }}
        >
          <button
            onClick={onRequestComplete}
            className="flex flex-col items-center gap-0.5 group"
          >
            <span className="w-6 h-6 rounded-full bg-emerald-600 flex items-center justify-center group-hover:bg-emerald-700 transition-colors">
              <Check className="w-3 h-3 text-white" strokeWidth={2.5} />
            </span>
            <span className="text-[10px] font-semibold text-emerald-700 leading-none">
              Complete
            </span>
          </button>

          <button
            onClick={onCancelCheck}
            className="text-[9.5px] text-muted-foreground hover:text-foreground transition-colors leading-none mt-0.5"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
