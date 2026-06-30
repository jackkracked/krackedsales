"use client";

import { cn } from "@/lib/utils/cn";
import { formatMessageTime } from "@/lib/utils/date";
import { MessageSquare, Mail, CornerUpLeft } from "lucide-react";
import { InstagramIcon, FacebookIcon } from "@/components/shared/channel-icon";
import { Avatar } from "@/components/ui/avatar";
import type { GHLConversation } from "@/lib/ghl/types";

function cleanPreview(body: string | undefined): string {
  if (!body?.trim()) return "No messages yet";
  const trimmed = body.trim();
  if (/^\[?https?:\/\/storage\.googleapis\.com\//i.test(trimmed)) return "📎 Attachment";
  const stripped = trimmed
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\[https?:\/\/[^\]]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped || "📎 Attachment";
}

const CHANNEL_ICONS: Record<string, React.ElementType> = {
  TYPE_SMS: MessageSquare,
  TYPE_EMAIL: Mail,
  TYPE_INSTAGRAM: InstagramIcon,
  TYPE_FB: FacebookIcon,
};

// Small channel glyph tint, badged onto the avatar.
const CHANNEL_BADGE: Record<string, string> = {
  TYPE_SMS: "bg-primary text-primary-foreground",
  TYPE_EMAIL: "bg-foreground text-background",
  TYPE_INSTAGRAM: "bg-pink-500 text-white",
  TYPE_FB: "bg-blue-500 text-white",
};

function ContactAvatar({ name, channelType }: { name: string; channelType?: string }) {
  const Icon = channelType ? CHANNEL_ICONS[channelType] : undefined;
  const badge = channelType ? CHANNEL_BADGE[channelType] : undefined;
  return (
    <div className="relative shrink-0">
      <Avatar name={name} size={40} />
      {Icon && (
        <span data-r10n-convo-channelbadge className={cn("absolute -bottom-0.5 -right-0.5 w-[15px] h-[15px] rounded-full flex items-center justify-center ring-2 ring-card", badge)}>
          <Icon className="w-2 h-2" />
        </span>
      )}
    </div>
  );
}

interface ConversationListProps {
  conversations: GHLConversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ConversationList({ conversations, selectedId, onSelect }: ConversationListProps) {
  if (conversations.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-muted-foreground px-4 text-center">
        No conversations found
      </div>
    );
  }

  return (
    <div data-r10n-convo-list className="flex flex-col overflow-y-auto flex-1 px-2 py-2">
      {conversations.map((conv) => {
        const isSelected = conv.id === selectedId;
        const displayType = conv.lastMessageType && CHANNEL_ICONS[conv.lastMessageType] ? conv.lastMessageType : conv.type;
        const hasUnread = conv.unreadCount > 0;
        // Client sent the last message and we've already read it → quietly flag reply-debt.
        const awaitingReply = !hasUnread && conv.lastMessageDirection === "inbound";
        const name = conv.fullName || conv.phone || conv.email || "Unknown";

        return (
          <button
            key={conv.id}
            data-r10n-convo-row
            data-selected={isSelected}
            data-unread={hasUnread}
            onClick={() => onSelect(conv.id)}
            className={cn(
              "group relative flex items-start gap-3 px-2.5 py-2.5 rounded-[10px] text-left w-full transition-colors duration-100",
              isSelected
                ? "bg-primary/[0.07]"
                : hasUnread
                ? "hover:bg-primary/[0.04]"
                : "hover:bg-muted/50",
            )}
          >
            {/* Selection indicator (not a border-stripe) */}
            {isSelected && <span data-r10n-convo-marker className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-full bg-primary" />}

            <ContactAvatar name={name} channelType={displayType} />

            <div className="flex-1 min-w-0 pt-0.5">
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span data-r10n-convo-name className={cn("text-sm truncate", hasUnread ? "font-bold text-foreground" : "font-medium text-foreground/90")}>
                  {name}
                </span>
                <span data-r10n-convo-time className={cn("text-[11px] shrink-0 tabular-nums", hasUnread ? "text-primary font-semibold" : "text-muted-foreground")}>
                  {conv.lastMessageDate ? formatMessageTime(conv.lastMessageDate) : ""}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {awaitingReply && <CornerUpLeft data-r10n-convo-awaiticon className="w-3 h-3 text-amber-500 shrink-0" />}
                <span data-r10n-convo-preview className={cn("text-xs truncate flex-1 leading-snug", hasUnread ? "text-foreground/80 font-medium" : "text-muted-foreground")}>
                  {cleanPreview(conv.lastMessageBody)}
                </span>
                {hasUnread && (
                  <span data-r10n-convo-unread className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center shrink-0 tabular-nums">
                    {conv.unreadCount > 9 ? "9+" : conv.unreadCount}
                  </span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
