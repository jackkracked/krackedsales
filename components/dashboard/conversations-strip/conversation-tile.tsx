"use client";

import { differenceInHours, differenceInMinutes } from "date-fns";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { QueueItem } from "@/app/api/inbox/queue/route";

const TEAL = "#1D9E75";
const RED = "#EF4444";

/** Short relative time: "just now", "23m", "4h", "2d" */
function shortRelativeTime(date: Date): string {
  const now = new Date();
  const hours = differenceInHours(now, date);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ago`;
  if (hours >= 1) return `${hours}h ago`;
  const mins = differenceInMinutes(now, date);
  if (mins >= 1) return `${mins}m ago`;
  return "just now";
}

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
  return "in";
}

const CHANNEL_BADGE: Record<string, { label: string; className: string }> = {
  sms:       { label: "SMS",      className: "bg-sky-100 text-sky-700" },
  email:     { label: "Email",    className: "bg-violet-100 text-violet-700" },
  instagram: { label: "IG",       className: "bg-pink-100 text-pink-700" },
  facebook:  { label: "FB",       className: "bg-blue-100 text-blue-700" },
  tiktok:    { label: "TikTok",   className: "bg-slate-100 text-slate-700" },
  whatsapp:  { label: "WA",       className: "bg-emerald-100 text-emerald-700" },
  in:        { label: "GHL",      className: "bg-muted text-muted-foreground" },
};

/** Derive 2-letter initials + consistent color from an assignee string */
function getRepAvatar(assignedTo: string): { initials: string; color: string } {
  const parts = assignedTo.trim().split(/\s+/).filter(Boolean);
  const initials = (parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0])
    : assignedTo.slice(0, 2)
  ).toUpperCase();

  // Hash initials to a color
  const colors = [
    { bg: "bg-teal-500",   text: "text-white" },
    { bg: "bg-blue-500",   text: "text-white" },
    { bg: "bg-amber-500",  text: "text-white" },
    { bg: "bg-purple-500", text: "text-white" },
    { bg: "bg-rose-500",   text: "text-white" },
    { bg: "bg-indigo-500", text: "text-white" },
  ];
  const idx = (initials.charCodeAt(0) + (initials.charCodeAt(1) || 0)) % colors.length;
  return { initials, color: `${colors[idx].bg} ${colors[idx].text}` };
}

interface ConversationTileProps {
  item: QueueItem;
  onReply: () => void;
  isLoading?: boolean;
}

export function ConversationTile({ item, onReply, isLoading }: ConversationTileProps) {
  const channelKey = getChannelKey(item);
  const badge = CHANNEL_BADGE[channelKey] ?? CHANNEL_BADGE.in;
  const timeAgo = shortRelativeTime(new Date(item.updatedAt));

  // Late = over 24h without response
  const isLate = differenceInHours(new Date(), new Date(item.updatedAt)) >= 24;

  // Default theme keeps the literal teal/red. Under r10n these inline styles read
  // --r10n-convo-accent (set per state on the tile) and fall back to the literal,
  // so the default render is byte-for-byte identical while r10n calms them.
  const dotColor  = `var(--r10n-convo-accent, ${isLate ? RED : TEAL})`;
  const timeColor = `var(--r10n-convo-accent, ${isLate ? RED : TEAL})`;

  const preview = item.lastMessage && item.lastMessage !== "undefined"
    ? item.lastMessage
    : null;

  const rep = item.assignedTo ? getRepAvatar(item.assignedTo) : null;

  return (
    <button
      onClick={onReply}
      disabled={isLoading}
      data-r10n-convo-tile
      data-late={isLate ? "true" : "false"}
      className={cn(
        "group relative w-[210px] h-[190px] flex flex-col rounded-[12px] bg-card p-3.5 select-none text-left",
        "transition-all duration-150 hover:shadow-md",
        isLoading ? "opacity-70 cursor-wait" : "",
        isLate ? "border border-destructive/40" : "border border-border"
      )}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center rounded-[12px] bg-card/80 z-10">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
        </div>
      )}
      {/* Top row: badge + dot + time */}
      <div className="flex items-center gap-1.5 mb-2.5 min-w-0">
        <span
          data-r10n-convo-channel
          className={cn(
            "shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full leading-none uppercase tracking-widest",
            badge.className
          )}
        >
          {badge.label}
        </span>

        {/* Status dot */}
        <span
          data-r10n-convo-dot
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: dotColor }}
        />

        {/* Timestamp */}
        <span
          data-r10n-convo-time
          className="text-[10px] font-bold tabular-nums truncate ml-auto"
          style={{ color: timeColor }}
        >
          {timeAgo}
        </span>
      </div>

      {/* Contact name */}
      <p className="text-[13.5px] font-medium text-foreground truncate leading-snug mb-1.5">
        {item.contactName}
      </p>

      {/* Message preview */}
      <div className="flex-1 overflow-hidden min-h-0 mb-3">
        <p className="text-[11.5px] font-medium text-foreground/70 leading-[1.45] line-clamp-3">
          {preview ?? <span className="italic opacity-40">No message preview</span>}
        </p>
      </div>

      {/* Bottom row */}
      <div className="flex items-end justify-between mt-auto pt-2 border-t border-border/50">
        <span data-r10n-convo-await className="text-[10.5px] text-muted-foreground font-medium">
          Awaiting reply
        </span>

        {rep && (
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground">
              Rep
            </span>
            <div className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold",
              rep.color
            )}>
              {rep.initials}
            </div>
          </div>
        )}
      </div>
    </button>
  );
}
