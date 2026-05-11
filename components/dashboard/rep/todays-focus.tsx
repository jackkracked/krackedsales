"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, MessageSquare, CheckSquare, Phone } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type FocusItemType = "followup" | "task" | "call";

interface FocusItem {
  id: string;
  type: FocusItemType;
  title: string;
  subtitle: string;
  href: string;
}

interface FollowUpRec {
  ghlContactId: string;
  oppId: string;
  type: string;
  reasoning: string;
  messagesJson: unknown[];
}

interface Task {
  id: string;
  title: string;
  contactName?: string;
  dueDate?: string;
}

const ICON: Record<FocusItemType, React.ElementType> = {
  followup: MessageSquare,
  task: CheckSquare,
  call: Phone,
};

const TYPE_LABEL: Record<FocusItemType, string> = {
  followup: "Follow-up",
  task: "Task",
  call: "Return call",
};

async function buildFocusItems(): Promise<FocusItem[]> {
  const items: FocusItem[] = [];

  const [followupsRes, tasksRes] = await Promise.allSettled([
    fetch("/api/follow-ups?limit=10").then((r) => r.json()),
    fetch("/api/tasks?limit=10").then((r) => r.json()),
  ]);

  if (followupsRes.status === "fulfilled") {
    const recs: FollowUpRec[] = followupsRes.value?.followups ?? [];
    for (const rec of recs.slice(0, 2)) {
      items.push({
        id: `fu-${rec.ghlContactId}`,
        type: "followup",
        title: rec.reasoning?.split(".")[0] ?? "Send follow-up",
        subtitle: `Contact ID: ${rec.ghlContactId}`,
        href: `/follow-ups`,
      });
    }
  }

  if (tasksRes.status === "fulfilled") {
    const tasks: Task[] = tasksRes.value?.tasks ?? [];
    for (const task of tasks.slice(0, 1)) {
      items.push({
        id: `task-${task.id}`,
        type: "task",
        title: task.title,
        subtitle: task.contactName ? `For ${task.contactName}` : "Open task",
        href: `/dashboard`,
      });
    }
  }

  return items.slice(0, 3);
}

function FocusItemRow({ item }: { item: FocusItem }) {
  const Icon = ICON[item.type];
  return (
    <a
      href={item.href}
      className="group flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
    >
      <div className="w-7 h-7 rounded-[6px] bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="w-3.5 h-3.5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate leading-tight">
          {item.title}
        </p>
        <p className="text-xs text-muted-foreground truncate leading-tight mt-0.5">
          {TYPE_LABEL[item.type]} · {item.subtitle}
        </p>
      </div>
      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
    </a>
  );
}

export function TodaysFocus() {
  const { data: items = [], isLoading } = useQuery<FocusItem[]>({
    queryKey: ["todays-focus"],
    queryFn: buildFocusItems,
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });

  return (
    <div className="bg-card border border-border rounded-[10px] overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h3
          className="text-sm font-semibold text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Today&apos;s Focus
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">Your top priorities right now</p>
      </div>

      <div className="divide-y divide-border">
        {isLoading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="w-7 h-7 bg-muted/60 rounded-[6px] animate-pulse shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 bg-muted/60 rounded animate-pulse w-48" />
                  <div className="h-2.5 bg-muted/40 rounded animate-pulse w-32" />
                </div>
              </div>
            ))
          : items.length === 0
          ? (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                Nothing urgent right now. Check back later.
              </div>
            )
          : items.map((item) => <FocusItemRow key={item.id} item={item} />)}
      </div>
    </div>
  );
}
