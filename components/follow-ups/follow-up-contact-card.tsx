"use client";

import { cn } from "@/lib/utils/cn";

export interface FollowUpItem {
  oppId: string;
  contactId: string;
  contactName: string;
  firstName: string;
  stageName: string;
  pipelineName?: string;
  zone: 1 | 2 | 3 | 4;
  daysInStage: number;
  daysSinceLastContact: number;
  totalFollowUpsSent: number;
  hasEverReplied: boolean;
  urgency: "overdue" | "due" | "upcoming";
  channel: string;
  recommendation: {
    id: string;
    type: string;
    reasoning: string;
    messages: unknown;
    status: string;
  } | null;
}

const ZONE_STAGE_LABELS: Record<number, { label: string; className: string }> = {
  1: { label: "Demo Sent", className: "bg-blue-50 text-blue-700" },
  2: { label: "No-Show", className: "bg-amber-50 text-amber-700" },
  3: { label: "Sale In Progress", className: "bg-purple-50 text-purple-700" },
  4: { label: "Sale In Progress", className: "bg-orange-50 text-orange-700" },
};

const URGENCY_DOT: Record<string, string> = {
  overdue: "bg-red-500",
  due: "bg-amber-400",
  upcoming: "bg-green-400",
};

function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

interface Props {
  item: FollowUpItem;
  isSelected: boolean;
  onSelect: (item: FollowUpItem) => void;
}

export function FollowUpContactCard({ item, isSelected, onSelect }: Props) {
  const badge = ZONE_STAGE_LABELS[item.zone];

  return (
    <button
      onClick={() => onSelect(item)}
      className={cn(
        "w-full text-left p-3 rounded-[10px] border transition-all duration-100",
        isSelected
          ? "border-primary/60 bg-primary/5 shadow-sm"
          : "border-border hover:border-primary/30 hover:bg-muted/20"
      )}
    >
      {/* Name + urgency */}
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <p className="text-sm font-semibold text-foreground truncate leading-tight">
          {item.contactName}
        </p>
        <span
          className={cn("w-2 h-2 rounded-full shrink-0", URGENCY_DOT[item.urgency])}
          title={item.urgency}
        />
      </div>

      {/* Stage badge + days since */}
      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
        <span
          className={cn(
            "inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium",
            badge.className
          )}
        >
          {badge.label}
          {item.zone === 4 && (
            <span className="ml-1 text-orange-500 font-semibold">·&nbsp;unresponsive</span>
          )}
        </span>
        <span className="text-xs text-muted-foreground">
          {item.daysSinceLastContact === 0
            ? "today"
            : `${item.daysSinceLastContact}d no contact`}
        </span>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground/60">
          {item.channel} ·{" "}
          {item.totalFollowUpsSent === 0
            ? "first follow-up"
            : `${item.totalFollowUpsSent} prior`}
        </span>
        {item.recommendation && (
          <span className="text-xs text-primary font-medium">AI ready</span>
        )}
      </div>
    </button>
  );
}
