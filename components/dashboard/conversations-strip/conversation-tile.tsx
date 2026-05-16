"use client";

import { formatDistanceToNow } from "date-fns";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { QueueItem } from "@/app/api/inbox/queue/route";

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
  const timeAgo = formatDistanceToNow(new Date(item.updatedAt), { addSuffix: true });

  const urgency =
    item.staleDays >= 3 ? "high" :
    item.staleDays >= 1 ? "mid" : "low";

  return (
    <div
      className={cn(
        "group relative h-[190px] w-[200px] flex flex-col rounded-[12px] border bg-card p-4 select-none",
        "transition-shadow duration-150 hover:shadow-md",
        urgency === "high" && "border-destructive/30 bg-destructive/[0.015]",
        urgency === "mid"  && "border-amber-400/40 bg-amber-50/20",
        urgency === "low"  && "border-border"
      )}
    >
      {/* Top row: badge + time */}
      <div className="flex items-center justify-between mb-3">
        <span
          className={cn(
            "text-[10px] font-semibold px-1.5 py-[3px] rounded-[5px] border leading-none uppercase tracking-wide",
            badge.className
          )}
        >
          {badge.label}
        </span>
        <span
          className={cn(
            "text-[10px] tabular-nums",
            urgency === "high" ? "text-destructive font-medium" :
            urgency === "mid"  ? "text-amber-600" :
            "text-muted-foreground/60"
          )}
        >
          {timeAgo}
        </span>
      </div>

      {/* Contact name */}
      <p className="text-[14px] font-semibold text-foreground truncate leading-snug mb-1.5">
        {item.contactName}
      </p>

      {/* Last message */}
      <p className="text-[12px] text-muted-foreground leading-snug line-clamp-3 flex-1">
        {item.lastMessage || <span className="italic opacity-50">No message preview</span>}
      </p>

      {/* Reply button */}
      <div className="flex justify-end mt-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onReply();
          }}
          className={cn(
            "flex items-center gap-1 text-[12px] font-semibold transition-colors",
            "px-2.5 py-1.5 rounded-[6px]",
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
