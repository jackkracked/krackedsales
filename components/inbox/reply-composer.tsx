"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import { useSendMessage } from "@/lib/hooks/use-conversations";
import { useInboxStore } from "@/store/inbox-store";
import { Send } from "lucide-react";

const CHANNEL_TYPE_LABELS: Record<string, string> = {
  TYPE_SMS: "SMS",
  TYPE_EMAIL: "Email",
  TYPE_INSTAGRAM: "Instagram",
  TYPE_FB: "Facebook",
};

interface ReplyComposerProps {
  conversationId: string;
  contactId: string;
  defaultChannelType?: string;
}

export function ReplyComposer({ conversationId, contactId, defaultChannelType = "TYPE_SMS" }: ReplyComposerProps) {
  const [channelType, setChannelType] = useState(defaultChannelType);
  const sendMessage = useSendMessage();
  const { replyDraft, setReplyDraft, clearReplyDraft } = useInboxStore();

  const draft = replyDraft[conversationId] ?? "";

  function handleSend() {
    if (!draft.trim() || sendMessage.isPending) return;

    sendMessage.mutate(
      { conversationId, message: draft.trim(), type: channelType, contactId },
      { onSuccess: () => clearReplyDraft(conversationId) }
    );
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="border-t border-border p-4 bg-card">
      {/* Channel selector */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-muted-foreground">Via:</span>
        <select
          value={channelType}
          onChange={(e) => setChannelType(e.target.value)}
          className="text-xs border border-border rounded-md px-2 py-1 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          {Object.entries(CHANNEL_TYPE_LABELS).map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground ml-auto">⌘↵ to send</span>
      </div>

      {/* Textarea + send button */}
      <div className="flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setReplyDraft(conversationId, e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a reply…"
          rows={2}
          className={cn(
            "flex-1 resize-none text-sm px-3 py-2.5 border border-border rounded-[7px]",
            "bg-background text-foreground placeholder:text-muted-foreground",
            "focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary",
            "transition-colors"
          )}
        />
        <button
          onClick={handleSend}
          disabled={!draft.trim() || sendMessage.isPending}
          className={cn(
            "p-2.5 rounded-[7px] bg-primary text-primary-foreground transition-colors",
            (!draft.trim() || sendMessage.isPending)
              ? "opacity-50 cursor-not-allowed"
              : "hover:bg-primary/90"
          )}
          aria-label="Send message"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

      {sendMessage.isError && (
        <p className="text-xs text-destructive mt-1">
          {(sendMessage.error as Error)?.message ?? "Failed to send. Try again."}
        </p>
      )}
    </div>
  );
}
