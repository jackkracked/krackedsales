"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  Inbox, RefreshCw, CheckCircle2, ArrowLeft, Sparkles,
  MessageSquare, Send,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useMessages } from "@/lib/hooks/use-conversations";
import { MessageThread } from "./message-thread";
import { ReplyComposer } from "./reply-composer";
import type { QueueItem } from "@/app/api/inbox/queue/route";

interface QueueResponse {
  items: QueueItem[];
  total: number;
}

// ── Channel badge ──────────────────────────────────────────────────────────────

function channelBadge(item: QueueItem) {
  if (item.platform === "instagram") return { label: "IG", className: "bg-pink-50 dark:bg-pink-950/20 text-pink-600 dark:text-pink-400 ring-1 ring-pink-200/60 dark:ring-pink-800/40" };
  if (item.platform === "facebook") return { label: "FB", className: "bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 ring-1 ring-blue-200/60 dark:ring-blue-800/40" };
  if (item.channel === "TikTok") return { label: "TT", className: "bg-slate-50 dark:bg-slate-950/20 text-slate-600 dark:text-slate-400 ring-1 ring-slate-200/60 dark:ring-slate-800/40" };
  return { label: "GHL", className: "bg-muted text-muted-foreground ring-1 ring-border" };
}

function staleColor(days: number) {
  if (days === 0) return "text-emerald-600";
  if (days <= 1) return "text-amber-500";
  if (days <= 3) return "text-amber-600";
  return "text-red-500 font-semibold";
}

function staleLabel(days: number) {
  if (days === 0) return "Today";
  return `${days}d`;
}

// ── Conversation list item ─────────────────────────────────────────────────────

function QueueListItem({
  item,
  isSelected,
  onSelect,
}: {
  item: QueueItem;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const badge = channelBadge(item);
  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full text-left px-4 py-3 border-b border-border/60 last:border-0 transition-colors",
        isSelected ? "bg-primary/[0.06] border-l-2 border-l-primary" : "hover:bg-muted/30"
      )}
    >
      <div className="flex items-center gap-2 mb-0.5">
        <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold shrink-0", badge.className)}>
          {badge.label}
        </span>
        <span className="text-[13px] font-semibold text-foreground truncate flex-1">
          {item.contactName}
        </span>
        <span className={cn("text-xs tabular-nums shrink-0", staleColor(item.staleDays))}>
          {staleLabel(item.staleDays)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground truncate pl-[34px]">
        {item.lastMessage || "No preview"}
      </p>
    </button>
  );
}

// ── GHL thread panel ───────────────────────────────────────────────────────────

function GHLThreadPanel({ item }: { item: QueueItem }) {
  const { data: messagesData, isLoading } = useMessages(item.id);
  const messages = messagesData?.messages ?? [];

  // Infer channel from last message type
  const lastMsgType = messages[messages.length - 1]?.messageType ?? "TYPE_SMS";
  const defaultChannel = lastMsgType.startsWith("TYPE_EMAIL")
    ? "TYPE_EMAIL"
    : lastMsgType.startsWith("TYPE_INSTAGRAM")
    ? "TYPE_INSTAGRAM"
    : lastMsgType.startsWith("TYPE_FB")
    ? "TYPE_FB"
    : "TYPE_SMS";

  if (isLoading) {
    return (
      <div className="flex items-center justify-center flex-1 text-sm text-muted-foreground gap-2">
        <RefreshCw className="w-4 h-4 animate-spin" />
        Loading thread…
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto min-h-0">
        <MessageThread messages={messages} />
      </div>
      <div className="shrink-0 border-t border-border">
        <ReplyComposer
          conversationId={item.id}
          contactId={item.contactId ?? ""}
          defaultChannelType={defaultChannel}
        />
      </div>
    </>
  );
}

// ── Meta / TikTok thread panel ─────────────────────────────────────────────────

interface ExternalMessage {
  id: string;
  speaker?: string;
  text: string;
  direction: "inbound" | "outbound";
  createdAt: string;
}

function ExternalThreadPanel({ item }: { item: QueueItem }) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);

  const apiPath = item.channel === "Meta"
    ? `/api/meta/conversations/${item.id}/messages`
    : `/api/tiktok/conversations/${item.id}/messages`;

  const { data, isLoading } = useQuery<{ messages?: ExternalMessage[]; entries?: ExternalMessage[] }>({
    queryKey: ["queue-thread", item.id],
    queryFn: () => fetch(apiPath).then((r) => r.json()),
    staleTime: 30_000,
  });

  // Normalise response shape: Meta returns `messages`, TikTok returns `messages` too
  const rawMessages: ExternalMessage[] = (data?.messages ?? []) as ExternalMessage[];

  // AI draft
  useQuery<{ draft: string }>({
    queryKey: ["reply-draft", item.id],
    queryFn: () =>
      fetch("/api/inbox/queue/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactName: item.contactName,
          lastMessage: item.lastMessage,
          channel: item.channel,
          platform: item.platform,
        }),
      }).then((r) => r.json()),
    enabled: !draftLoaded,
    staleTime: 5 * 60 * 1000,
    select: (d) => {
      if (d.draft && !draftLoaded) {
        setDraft(d.draft);
        setDraftLoaded(true);
      }
      return d;
    },
  });

  async function handleSend() {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      const endpoint = item.channel === "Meta"
        ? `/api/meta/conversations/${item.id}/messages`
        : `/api/tiktok/conversations/${item.id}/messages`;
      const body = item.channel === "Meta"
        ? { recipientId: item.id, text: draft, platform: item.platform ?? "facebook" }
        : { text: draft };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) setSent(true);
    } finally {
      setSending(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center flex-1 text-sm text-muted-foreground gap-2">
        <RefreshCw className="w-4 h-4 animate-spin" />
        Loading thread…
      </div>
    );
  }

  return (
    <>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-3">
        {rawMessages.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-6">No messages loaded</p>
        )}
        {rawMessages.map((m, i) => {
          const isOut = m.direction === "outbound";
          return (
            <div key={m.id ?? i} className={cn("flex", isOut ? "justify-end" : "justify-start")}>
              <div className={cn(
                "max-w-[75%] px-3 py-2 rounded-[10px] text-sm",
                isOut
                  ? "bg-primary text-primary-foreground rounded-br-sm"
                  : "bg-muted text-foreground rounded-bl-sm"
              )}>
                <p>{m.text}</p>
                {m.createdAt && (
                  <p className={cn("text-[10px] mt-1", isOut ? "text-primary-foreground/60" : "text-muted-foreground/60")}>
                    {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true })}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Compose */}
      {sent ? (
        <div className="shrink-0 border-t border-border px-4 py-3 flex items-center gap-2 text-xs text-emerald-600">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Message sent
        </div>
      ) : (
        <div className="shrink-0 border-t border-border px-4 py-3 space-y-2">
          {!draftLoaded && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Sparkles className="w-3 h-3 animate-pulse text-primary" />
              Generating draft…
            </div>
          )}
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="Write a reply…"
            className="w-full text-sm border border-border rounded-[7px] px-3 py-2 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/40"
          />
          <div className="flex items-center justify-between">
            {draftLoaded && (
              <span className="text-[11px] text-muted-foreground/60 flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5 text-primary/50" /> AI draft
              </span>
            )}
            <button
              onClick={handleSend}
              disabled={!draft.trim() || sending}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-[7px] text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {sending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ── Thread panel switcher ──────────────────────────────────────────────────────

function ThreadPanel({ item, onBack }: { item: QueueItem; onBack: () => void }) {
  const badge = channelBadge(item);
  return (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-border">
        <button
          onClick={onBack}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors lg:hidden"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold", badge.className)}>
          {badge.label}
        </span>
        <span className="text-[13px] font-semibold text-foreground truncate">{item.contactName}</span>
      </div>

      {item.channel === "GHL" ? (
        <GHLThreadPanel item={item} />
      ) : (
        <ExternalThreadPanel item={item} />
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ReplyQueue() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "thread">("list");
  const queryClient = useQueryClient();

  const { data, isPending, isFetching } = useQuery<QueueResponse>({
    queryKey: ["inbox-queue"],
    queryFn: () => fetch("/api/inbox/queue").then((r) => r.json()),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const items = data?.items ?? [];
  const selectedItem = items.find((i) => i.id === selectedId) ?? null;

  function selectItem(item: QueueItem) {
    setSelectedId(item.id);
    setMobileView("thread");
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left: queue list ── */}
      <div className={cn(
        "flex flex-col border-r border-border bg-card",
        "w-full lg:w-80 xl:w-96 shrink-0",
        mobileView === "thread" ? "hidden lg:flex" : "flex"
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Inbox className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[13px] font-semibold text-foreground">Reply Queue</span>
            {data && data.total > 0 && (
              <span className="min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
                {data.total}
              </span>
            )}
          </div>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ["inbox-queue"] })}
            disabled={isFetching}
            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {isPending ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-4 py-3 flex gap-3 border-b border-border/60">
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 bg-muted/60 rounded animate-pulse w-28" />
                  <div className="h-2.5 bg-muted/40 rounded animate-pulse w-48" />
                </div>
              </div>
            ))
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16">
              <CheckCircle2 className="w-8 h-8 text-emerald-500/50" />
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">All caught up</p>
                <p className="text-xs text-muted-foreground mt-0.5">No conversations awaiting reply</p>
              </div>
            </div>
          ) : (
            items.map((item) => (
              <QueueListItem
                key={item.id}
                item={item}
                isSelected={selectedId === item.id}
                onSelect={() => selectItem(item)}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Right: thread + compose ── */}
      <div className={cn(
        "flex-1 flex flex-col min-h-0",
        mobileView === "list" ? "hidden lg:flex" : "flex"
      )}>
        {selectedItem ? (
          <ThreadPanel
            item={selectedItem}
            onBack={() => setMobileView("list")}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <MessageSquare className="w-8 h-8 text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium text-foreground">Select a conversation</p>
              <p className="text-xs text-muted-foreground mt-0.5">Click any item to view the thread and reply</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
