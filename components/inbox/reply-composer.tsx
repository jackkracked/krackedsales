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

  const canSend = !!draft.trim() && !sendMessage.isPending;

  return (
    <div className="border-t border-border bg-card px-4 py-3 shrink-0">
      <div className="rounded-[14px] border border-border bg-background transition-all focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15 focus-within:shadow-[0_4px_16px_-10px_rgba(15,58,92,0.35)]">
        <textarea
          value={draft}
          onChange={(e) => setReplyDraft(conversationId, e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a reply…"
          rows={2}
          className="w-full resize-none bg-transparent px-3.5 pt-3 pb-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none leading-relaxed"
        />
        <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Via</span>
            <select
              value={channelType}
              onChange={(e) => setChannelType(e.target.value)}
              className="text-[11px] font-medium text-foreground bg-muted/70 rounded-[7px] pl-2 pr-1.5 py-1 border-0 outline-none cursor-pointer hover:bg-muted transition-colors"
            >
              {Object.entries(CHANNEL_TYPE_LABELS).map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="text-[10px] text-muted-foreground/55 tabular-nums">⌘↵</span>
            <button
              onClick={handleSend}
              disabled={!canSend}
              className={cn(
                "flex items-center gap-1.5 pl-3 pr-3.5 py-1.5 rounded-[9px] text-sm font-semibold transition-all active:scale-[0.97]",
                canSend
                  ? "bg-primary text-primary-foreground hover:bg-[#0c3251] shadow-[0_4px_12px_-8px_rgba(15,58,92,0.5)]"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
            >
              {sendMessage.isPending ? "Sending…" : <>Send <Send className="w-3.5 h-3.5" /></>}
            </button>
          </div>
        </div>
      </div>

      {sendMessage.isError && (
        <p className="text-xs text-destructive mt-1.5 px-1">
          {(sendMessage.error as Error)?.message ?? "Failed to send. Try again."}
        </p>
      )}
    </div>
  );
}
