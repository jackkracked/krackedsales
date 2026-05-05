"use client";

import { cn } from "@/lib/utils/cn";
import { Clock, MessageSquare, MessageCircle } from "lucide-react";
import { relativeTime } from "@/lib/utils/date";

export interface CommentLead {
  id: string;
  name: string;
  platform: "facebook" | "instagram";
  commentText: string;
  keyword: string;
  commentId?: string | null;
  postId?: string | null;
  commenterId?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  notes?: string | null;
  contactedAt?: string | null;
  createdAt: string;
}

interface CommentLeadCardProps {
  lead: CommentLead;
  isDragging?: boolean;
  onClick?: () => void;
  onMessageClick?: () => void;
}

export function CommentLeadCard({ lead, isDragging, onClick, onMessageClick }: CommentLeadCardProps) {
  const isFacebook = lead.platform === "facebook";
  const needsOutreach = !lead.contactedAt;

  const platformBadge = isFacebook
    ? { label: "FB", className: "bg-blue-50 text-blue-700" }
    : { label: "IG", className: "bg-pink-50 text-pink-700" };

  return (
    <div
      onClick={onClick}
      className={cn(
        "bg-card border rounded-[10px] p-3 cursor-pointer transition-all duration-150",
        "hover:shadow-sm",
        isFacebook
          ? "border-blue-200/60 hover:border-blue-300"
          : "border-pink-200/60 hover:border-pink-300",
        isDragging && "opacity-50 rotate-1 shadow-lg"
      )}
    >
      {/* Name */}
      <p className="text-sm font-semibold text-foreground leading-tight mb-1.5 line-clamp-1">
        {lead.name}
      </p>

      {/* Platform badge + Comment pill */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium", platformBadge.className)}>
          {platformBadge.label}
        </span>
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-medium bg-violet-50 text-violet-700">
          <MessageSquare className="w-2.5 h-2.5" />
          Comment
        </span>
      </div>

      {/* Comment preview */}
      <p className="text-xs text-muted-foreground italic mb-2 line-clamp-1">
        &ldquo;{lead.commentText}&rdquo;
      </p>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          {relativeTime(lead.createdAt)}
        </span>

        {needsOutreach && (
          <button
            onClick={(e) => { e.stopPropagation(); onMessageClick?.(); }}
            className="relative flex items-center justify-center w-6 h-6 rounded-full hover:bg-red-50 transition-colors group/reply"
            title="Needs outreach — click to message"
          >
            <MessageCircle className="w-3.5 h-3.5 text-muted-foreground/50 group-hover/reply:text-red-500 transition-colors" />
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 border-2 border-card animate-pulse" />
          </button>
        )}
      </div>
    </div>
  );
}
