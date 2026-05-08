"use client";

import { cn } from "@/lib/utils/cn";
import { formatMessageTime } from "@/lib/utils/date";
import { MessageSquare, Mail } from "lucide-react";
import { InstagramIcon, FacebookIcon } from "@/components/shared/channel-icon";
import type { GHLConversation } from "@/lib/ghl/types";

function cleanPreview(body: string | undefined): string {
  if (!body?.trim()) return "No messages yet";
  const trimmed = body.trim();
  // GHL wraps storage URLs in brackets: [https://storage.googleapis.com/...]
  if (/^\[?https?:\/\/storage\.googleapis\.com\//i.test(trimmed)) return "📎 Attachment";
  // Strip HTML tags (emails often have full HTML in lastMessageBody)
  let stripped = trimmed
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    // Remove GHL [url] and [url][url] patterns
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

const CHANNEL_COLORS: Record<string, string> = {
  TYPE_SMS: "text-primary",
  TYPE_EMAIL: "text-muted-foreground",
  TYPE_INSTAGRAM: "text-pink-500",
  TYPE_FB: "text-blue-500",
};

function ContactAvatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-semibold shrink-0">
      {initials || "?"}
    </div>
  );
}

interface ConversationListProps {
  conversations: GHLConversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
}: ConversationListProps) {
  if (conversations.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-muted-foreground px-4 text-center">
        No conversations found
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-border overflow-y-auto flex-1">
      {conversations.map((conv) => {
        const isSelected = conv.id === selectedId;
        // Prefer lastMessageType for icon (e.g. TYPE_PHONE conversations that last messaged via email)
        const displayType = conv.lastMessageType && CHANNEL_ICONS[conv.lastMessageType]
          ? conv.lastMessageType
          : conv.type;
        const Icon = CHANNEL_ICONS[displayType] ?? MessageSquare;
        const iconColor = CHANNEL_COLORS[displayType] ?? "text-muted-foreground";
        const hasUnread = conv.unreadCount > 0;

        return (
          <button
            key={conv.id}
            onClick={() => onSelect(conv.id)}
            className={cn(
              "flex items-center gap-3 px-4 py-3 text-left w-full transition-colors duration-100",
              "hover:bg-muted/40",
              isSelected && "bg-primary/5 border-l-2 border-l-primary"
            )}
          >
            {/* Avatar */}
            <ContactAvatar name={conv.fullName ?? conv.phone ?? conv.email ?? "?"} />

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1 mb-0.5">
                <span className={cn(
                  "text-sm truncate",
                  hasUnread ? "font-semibold text-foreground" : "font-medium text-foreground"
                )}>
                  {conv.fullName || conv.phone || conv.email || "Unknown"}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {conv.lastMessageDate ? formatMessageTime(conv.lastMessageDate) : ""}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Icon className={cn("w-3 h-3 shrink-0", iconColor)} />
                <span className={cn(
                  "text-xs truncate flex-1",
                  hasUnread ? "text-foreground" : "text-muted-foreground"
                )}>
                  {cleanPreview(conv.lastMessageBody)}
                </span>
                {hasUnread && (
                  <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
