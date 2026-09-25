"use client";

import { cn } from "@/lib/utils/cn";
import { formatMessageTime } from "@/lib/utils/date";
import { CornerUpLeft } from "lucide-react";
import { ContactAvatar, CHANNEL_ICONS } from "@/components/inbox/channel-avatar";
import { SelectCheckbox } from "@/components/inbox/select-checkbox";
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

interface ConversationListProps {
  conversations: GHLConversation[];
  /** The currently OPEN conversation (thread shown on the right). */
  selectedId: string | null;
  onSelect: (id: string, e?: React.MouseEvent) => void;
  /** Multi-select set of conversation ids. */
  checkedIds: Set<string>;
  /** Toggle a row's checkbox. `e` carries shiftKey for range-select. */
  onToggleCheck: (id: string, e: React.MouseEvent) => void;
  /** True when ≥1 conversation is selected — reveals every row's checkbox. */
  selectionActive: boolean;
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  checkedIds,
  onToggleCheck,
  selectionActive,
}: ConversationListProps) {
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
        const isOpen = conv.id === selectedId;
        const isChecked = checkedIds.has(conv.id);
        const showCheckbox = selectionActive || isChecked;
        const displayType = conv.lastMessageType && CHANNEL_ICONS[conv.lastMessageType] ? conv.lastMessageType : conv.type;
        const hasUnread = conv.unreadCount > 0;
        // Client sent the last message and we've already read it → quietly flag reply-debt.
        const awaitingReply = !hasUnread && conv.lastMessageDirection === "inbound";
        const name = conv.fullName || conv.phone || conv.email || "Unknown";

        return (
          <div
            key={conv.id}
            role="button"
            tabIndex={0}
            data-r10n-convo-row
            data-selected={isOpen}
            data-checked={isChecked}
            data-unread={hasUnread}
            onClick={(e) => onSelect(conv.id, e)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(conv.id);
              }
            }}
            className={cn(
              "group relative flex items-start gap-3 px-2.5 py-2.5 rounded-[10px] text-left w-full cursor-pointer transition-colors duration-100 outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
              isOpen
                ? "bg-primary/[0.07]"
                : isChecked
                ? "bg-primary/[0.05]"
                : hasUnread
                ? "hover:bg-primary/[0.04]"
                : "hover:bg-muted/50",
            )}
          >
            {/* Selection indicator (not a border-stripe) */}
            {isOpen && <span data-r10n-convo-marker className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-full bg-primary" />}

            {/* Leading slot: avatar ↔ checkbox crossfade (checkbox on hover, or always in selection mode) */}
            <div className="relative w-10 h-10 shrink-0">
              <div
                className={cn(
                  "absolute inset-0 transition-opacity duration-150 ease-out",
                  showCheckbox ? "opacity-0 pointer-events-none" : "opacity-100 group-hover:opacity-0",
                )}
              >
                <ContactAvatar name={name} channelType={displayType} avatarUrl={conv.avatarUrl} />
              </div>
              <div
                className={cn(
                  "absolute inset-0 flex items-center justify-center transition-opacity duration-150 ease-out",
                  showCheckbox ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
              >
                <SelectCheckbox
                  checked={isChecked}
                  onChange={(_next, e) => onToggleCheck(conv.id, e)}
                  aria-label={`Select conversation with ${name}`}
                />
              </div>
            </div>

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
                {conv.starred && (
                  <svg data-r10n-convo-star viewBox="0 0 24 24" className="w-3 h-3 shrink-0 fill-amber-400 text-amber-400" aria-hidden>
                    <path d="M12 .587l3.668 7.431 8.2 1.192-5.934 5.784 1.401 8.169L12 18.896l-7.335 3.867 1.401-8.169L.132 9.21l8.2-1.192z" />
                  </svg>
                )}
                {hasUnread && (
                  <span data-r10n-convo-unread className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center shrink-0 tabular-nums">
                    {conv.unreadCount > 9 ? "9+" : conv.unreadCount}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
