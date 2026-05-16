"use client";

import { differenceInDays, differenceInHours, differenceInMinutes } from "date-fns";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { QueueItem } from "@/app/api/inbox/queue/route";

/** Short relative time: "just now", "23m", "4h", "2d" */
function shortRelativeTime(date: Date): string {
  const now = new Date();
  const days = differenceInDays(now, date);
  if (days >= 1) return `${days}d ago`;
  const hours = differenceInHours(now, date);
  if (hours >= 1) return `${hours}h ago`;
  const mins = differenceInMinutes(now, date);
  if (mins >= 1) return `${mins}m ago`;
  return "just now";
}

interface ConversationTileProps {
  item: QueueItem;
  onReply: () => void;
}

const CHANNEL_BADGE: Record<string, { label: string; className: string }> = {
  sms:       { label: "SMS",       className: "bg-slate-100 text-slate-600 border-slate-200" },
  email:     { label: "Email",     className: "bg-primary/8 text-primary border-primary/15" },
  instagram: { label: "Instagram", className: "bg-rose-50 text-rose-600 border-rose-200" },
  facebook:  { label: "Facebook",  className: "bg-blue-50 text-blue-600 border-blue-200" },
  tiktok:    { label: "TikTok",    className: "bg-slate-800 text-white border-slate-700" },
  whatsapp:  { label: "WhatsApp",  className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  ghl:       { label: "GHL",       className: "bg-muted text-muted-foreground border-border" },
};

function getChannelKey(item: QueueItem): string {
  if (item.platform === "instagram") return "instagram";
  if (item.platform === "facebook") return "facebook";
  if (item.channel === "TikTok") return "tiktok";
  if (item.channel === "Meta") return "facebook";
  const t = (item.type ?? "").toLowerCase();
  if (t.includes("email")) return "email";
  if (t.includes("instagram")) return "instagram";
  if (t.includes("fb") || t.includes("facebook")) return "facebook";
  if (t.includes("whatsapp")) return "whatsapp";
  if (t.includes("sms") || t.includes("phone")) return "sms";
  return "ghl";
}

export function ConversationTile({ item, onReply }: ConversationTileProps) {
  const channelKey = getChannelKey(item);
  const badge = CHANNEL_BADGE[channelKey] ?? CHANNEL_BADGE.ghl;
  const timeAgo = shortRelativeTime(new Date(item.updatedAt));

  const urgency =
    item.staleDays >= 3 ? "high" :
    item.staleDays >= 1 ? "mid" : "low";

  // Guard against literal "undefined" string from API
  const preview = item.lastMessage && item.lastMessage !== "undefined"
    ? item.lastMessage
    : null;

  return (
    <div
      className={cn(
        "group relative w-[200px] flex flex-col rounded-[12px] border bg-card p-3.5 select-none",
        "transition-shadow duration-150 hover:shadow-md",
        urgency === "high" && "border-destructive/30 bg-destructive/[0.015]",
        urgency === "mid"  && "border-amber-400/40 bg-amber-50/20",
        urgency === "low"  && "border-border"
      )}
    >
      {/* Top row: badge + time — both stay on one line */}
      <div className="flex items-center gap-1.5 mb-2.5 min-w-0">
        <span
          className={cn(
            "shrink-0 text-[10px] font-semibold px-1.5 py-[3px] rounded-[5px] border leading-none uppercase tracking-wide",
            badge.className
          )}
        >
          {badge.label}
        </span>
        <span
          className={cn(
            "text-[10px] tabular-nums truncate ml-auto",
            urgency === "high" ? "text-destructive font-medium" :
            urgency === "mid"  ? "text-amber-600" :
            "text-muted-foreground/60"
          )}
        >
          {timeAgo}
        </span>
      </div>

      {/* Contact name */}
      <p className="text-[13.5px] font-semibold text-foreground truncate leading-snug mb-1.5">
        {item.contactName}
      </p>

      {/* Last message — fixed height, proper ellipsis via line-clamp */}
      <div className="flex-1 overflow-hidden min-h-0">
        <p className="text-[11.5px] text-muted-foreground leading-[1.45] line-clamp-4">
          {preview ?? <span className="italic opacity-50">No message preview</span>}
        </p>
      </div>

      {/* Reply button */}
      <div className="flex justify-end mt-2.5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onReply();
          }}
          className={cn(
            "flex items-center gap-1 text-[11.5px] font-semibold transition-colors",
            "px-2 py-1.5 rounded-[6px]",
            urgency === "high"
              ? "text-destructive hover:bg-destructive/8"
              : "text-primary hover:bg-primary/8"
          )}
        >
          Reply
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
