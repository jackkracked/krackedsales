"use client";

import { ListTodo, Layers, ClipboardCheck, MessageSquare, CalendarPlus } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Quick actions, in the header of whatever they belong to.
 *
 * WHY THE HEADER
 * Jack, 2026-09-22: "they're not always in view, which doesn't really make them quick
 * actions". They used to sit part-way down a scrolling panel, so on a laptop they were below
 * the fold and invisible. An action you have to hunt for is not quick.
 *
 * WHY NOT A DROPDOWN
 * A menu costs a click to open and a click to choose, which makes four short, safe actions
 * SLOWER than the tiles they replace. Menus earn their place at roughly six or more items, or
 * when an action is destructive enough to want a deliberate extra step. Neither applies here.
 * Identity on the left, actions on the right, always visible, is what Linear, Stripe and
 * Intercom converge on for exactly this job.
 *
 * Labels stay at normal widths because "Task", "Demo", "Audit", "Book" are single short words
 * and icon-only would force a tooltip hunt. Below `sm` they collapse to icons, where the
 * tooltip is the reasonable trade for the space.
 */
export type QuickActionKey = "task" | "demo" | "audit" | "message" | "book";

export interface QuickAction {
  key: QuickActionKey;
  label: string;
  onClick: () => void;
}

const ICONS: Record<QuickActionKey, typeof ListTodo> = {
  task: ListTodo,
  demo: Layers,
  audit: ClipboardCheck,
  message: MessageSquare,
  book: CalendarPlus,
};

export function QuickActionsBar({
  actions,
  className,
  compact = false,
}: {
  actions: QuickAction[];
  className?: string;
  /**
   * Icon-only, for columns too narrow to host labels.
   *
   * The inbox sidebar is 320px and the Instagram panel 288px, and both already spend that
   * width on an avatar and an editable name. Four labelled buttons do not fit, and a
   * viewport `sm:` breakpoint cannot help because the CONTAINER is narrow on a large screen.
   * So those two get icons with tooltips, in a bar pinned to the bottom of the panel where
   * they are always in view — same component, same behaviour, honest about the space.
   */
  compact?: boolean;
}) {
  if (actions.length === 0) return null;

  return (
    // ONE object, not four loose chips.
    //
    // Four separately-bordered buttons floating in a header read as unanchored — Jack,
    // 2026-09-22: "these also look lost". A single container with dividers makes them a
    // recognisable action group belonging to the record, which is how Linear and Notion
    // handle the same job.
    //
    // `shrink-0` so a long contact name can never squeeze the actions out.
    <div
      className={cn(
        "flex shrink-0 items-center overflow-hidden rounded-[9px] border border-border bg-card",
        "divide-x divide-border",
        className,
      )}
    >
      {actions.map(({ key, label, onClick }) => {
        const Icon = ICONS[key];
        return (
          <button
            key={key}
            type="button"
            onClick={onClick}
            title={label}
            aria-label={label}
            data-r10n-quick-action={key}
            className={cn(
              "inline-flex h-8 items-center justify-center gap-1.5",
              "text-[12px] font-medium text-muted-foreground transition-colors",
              "hover:bg-muted/70 hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset",
              compact ? "flex-1 px-0" : "px-3",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {/* Label hides where there is no room; the title attribute carries it instead. */}
            {!compact && <span className="hidden sm:inline">{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
