"use client";

import { useState, useEffect, useRef } from "react";
import { X, Send, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { QueueItem } from "@/app/api/inbox/queue/route";

interface ReplyModalProps {
  item: QueueItem;
  onSent: () => void;
  onClose: () => void;
}

const CHANNEL_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook:  "Facebook",
  tiktok:    "TikTok",
  email:     "Email",
  sms:       "SMS",
  whatsapp:  "WhatsApp",
  ghl:       "GHL",
};

function getChannelLabel(item: QueueItem): string {
  if (item.platform === "instagram") return "Instagram";
  if (item.platform === "facebook") return "Facebook";
  if (item.channel === "TikTok") return "TikTok";
  if (item.channel === "Meta") return "Facebook";
  const t = (item.type ?? "").toLowerCase();
  for (const [key, label] of Object.entries(CHANNEL_LABEL)) {
    if (t.includes(key)) return label;
  }
  return "GHL";
}

async function sendReply(item: QueueItem, text: string): Promise<void> {
  if (item.channel === "TikTok") {
    const res = await fetch(`/api/tiktok/conversations/${item.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error("Send failed");
    return;
  }

  if (item.channel === "Meta") {
    const res = await fetch(`/api/meta/conversations/${item.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        recipientId: item.recipientId ?? item.contactId,
        platform: item.platform ?? "facebook",
      }),
    });
    if (!res.ok) throw new Error("Send failed");
    return;
  }

  // GHL — determine send type
  const sendType =
    item.platform === "instagram" ? "TYPE_INSTAGRAM" :
    item.platform === "facebook"  ? "TYPE_FB" :
    item.type ?? "TYPE_SMS";

  const res = await fetch(`/api/ghl/conversations/${item.id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: text,
      type: sendType,
      contactId: item.contactId,
    }),
  });
  if (!res.ok) throw new Error("Send failed");
}

export function ReplyModal({ item, onSent, onClose }: ReplyModalProps) {
  const [draft, setDraft] = useState("");
  const [draftLoading, setDraftLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const channelLabel = getChannelLabel(item);

  // Auto-generate AI draft on open
  useEffect(() => {
    let cancelled = false;
    setDraftLoading(true);

    fetch("/api/inbox/queue/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactName: item.contactName,
        lastMessage: item.lastMessage,
        channel: item.channel,
        platform: item.platform,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.draft) {
          setDraft(data.draft);
          // Move cursor to end after draft loads
          requestAnimationFrame(() => {
            if (textareaRef.current) {
              textareaRef.current.selectionStart = textareaRef.current.value.length;
              textareaRef.current.selectionEnd = textareaRef.current.value.length;
              textareaRef.current.focus();
            }
          });
        }
      })
      .catch(() => {/* non-blocking — user can type manually */})
      .finally(() => { if (!cancelled) setDraftLoading(false); });

    return () => { cancelled = true; };
  }, [item]);

  // Focus textarea on open
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  async function handleSend() {
    if (!draft.trim() || sending) return;
    setError("");
    setSending(true);
    try {
      await sendReply(item, draft.trim());
      onSent();
    } catch {
      setError("Failed to send. Please try again.");
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend();
    if (e.key === "Escape") onClose();
  }

  const firstName = item.contactName.split(" ")[0];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.40)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-card border border-border rounded-[14px] w-full max-w-md shadow-2xl"
        style={{ animation: "scale-in 140ms cubic-bezier(0.16,1,0.3,1) forwards" }}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-border">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <p className="text-sm font-semibold text-foreground">{item.contactName}</p>
              <span className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                {channelLabel}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">Reply to this message</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-[6px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Quoted message */}
        {item.lastMessage && (
          <div className="px-5 pt-4">
            <div className="bg-muted/50 border border-border/60 rounded-[8px] px-3 py-2.5">
              <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wide mb-1">
                {firstName} said
              </p>
              <p className="text-[12.5px] text-muted-foreground leading-snug line-clamp-3 italic">
                &ldquo;{item.lastMessage}&rdquo;
              </p>
            </div>
          </div>
        )}

        {/* Reply textarea */}
        <div className="px-5 pt-4 pb-1">
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={4}
              placeholder={draftLoading ? "Generating smart reply…" : "Type a reply…"}
              disabled={sending}
              className={cn(
                "w-full text-sm px-3 py-2.5 border border-border rounded-[8px]",
                "bg-background text-foreground placeholder:text-muted-foreground",
                "resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50",
                "transition-colors disabled:opacity-60"
              )}
            />
            {draftLoading && (
              <div className="absolute top-2.5 right-3 flex items-center gap-1 text-[11px] text-muted-foreground/60">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Generating…</span>
              </div>
            )}
          </div>

          {/* AI badge — shows after draft loads */}
          {!draftLoading && draft && (
            <div className="flex items-center gap-1 mt-1.5 text-[10.5px] text-muted-foreground/60">
              <Sparkles className="w-3 h-3" />
              <span>AI draft — edit before sending</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4">
          {error && (
            <p className="text-xs text-destructive mb-3">{error}</p>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={sending}
              className="flex-1 py-2.5 text-sm font-medium text-foreground border border-border rounded-[7px] hover:bg-muted transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={!draft.trim() || sending}
              className={cn(
                "flex-1 py-2.5 text-sm font-semibold rounded-[7px] flex items-center justify-center gap-2 transition-all",
                "bg-primary text-primary-foreground hover:bg-primary/90",
                (!draft.trim() || sending) && "opacity-50 cursor-not-allowed"
              )}
            >
              {sending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  Send Reply
                </>
              )}
            </button>
          </div>
          <p className="text-center text-[10px] text-muted-foreground/40 mt-2">⌘↵ to send</p>
        </div>
      </div>

      <style jsx global>{`
        @keyframes scale-in {
          from { opacity: 0; transform: scale(0.96) translateY(4px); }
          to   { opacity: 1; transform: scale(1)    translateY(0); }
        }
      `}</style>
    </div>
  );
}
