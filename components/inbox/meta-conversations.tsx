"use client";

import React, { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { RefreshCw, Send } from "lucide-react";
import { cn } from "@/lib/utils/cn";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DmConversation = {
  source: "dm";
  id: string;
  platform: "facebook" | "instagram";
  participantName: string;
  participantId: string;
  lastMessage: string;
  updatedAt: string;
};

type CommentConversation = {
  source: "comment";
  id: string;
  platform: "facebook" | "instagram";
  participantName: string;
  participantId: string;
  lastMessage: string;
  updatedAt: string;
  keyword: string;
  commentText: string;
  commentId: string | null;
  postId: string | null;
};

type UnifiedConversation = DmConversation | CommentConversation;

interface MetaMessage {
  id: string;
  text: string;
  from: { id: string; name: string };
  createdAt: string;
  direction: "inbound" | "outbound";
  pending?: boolean;
}

// ---------------------------------------------------------------------------
// Platform icons
// ---------------------------------------------------------------------------

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="#1877F2" className={className} aria-hidden="true">
      <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.887v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
    </svg>
  );
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="ig-grad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#f09433" />
          <stop offset="25%" stopColor="#e6683c" />
          <stop offset="50%" stopColor="#dc2743" />
          <stop offset="75%" stopColor="#cc2366" />
          <stop offset="100%" stopColor="#bc1888" />
        </linearGradient>
      </defs>
      <path
        fill="url(#ig-grad)"
        d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Seen / unread tracking
// ---------------------------------------------------------------------------

const SEEN_KEY = "meta-seen-v2";
type SeenMap = Record<string, string>; // id → ISO timestamp when last marked read

function loadSeenMap(): SeenMap {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSeenMap(map: SeenMap) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(map));
  } catch {}
}

// ---------------------------------------------------------------------------
// API helpers — DM conversations
// ---------------------------------------------------------------------------

const CACHE_KEY = "meta-conversations-cache";
const CACHE_TS_KEY = "meta-conversations-cache-ts";

function readDmCache(): { conversations: DmConversation[] } | undefined {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function readDmCacheTimestamp(): number {
  try {
    const ts = localStorage.getItem(CACHE_TS_KEY);
    return ts ? parseInt(ts, 10) : 0;
  } catch {
    return 0;
  }
}

interface RawDmConversation {
  id: string;
  platform: "facebook" | "instagram";
  participantName: string;
  participantId: string;
  lastMessage: string;
  updatedAt: string;
}

async function fetchDmConversations(): Promise<{ conversations: DmConversation[] }> {
  const res = await fetch("/api/meta/conversations");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json();
  const conversations: DmConversation[] = (data.conversations ?? []).map(
    (c: RawDmConversation) => ({ ...c, source: "dm" as const })
  );
  const shaped = { conversations };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(shaped));
    localStorage.setItem(CACHE_TS_KEY, Date.now().toString());
  } catch {}
  return shaped;
}

// ---------------------------------------------------------------------------
// API helpers — comment leads
// ---------------------------------------------------------------------------

interface CommentLeadRow {
  id: string;
  name: string;
  platform: "facebook" | "instagram";
  keyword: string;
  commentText: string;
  commentId: string | null;
  postId: string | null;
  commenterId: string | null;
  createdAt: string;
}

async function fetchCommentLeads(): Promise<{ leads: CommentLeadRow[] }> {
  const res = await fetch("/api/comment-leads/inbox");
  if (!res.ok) throw new Error("Failed to fetch comment leads");
  return res.json();
}

// ---------------------------------------------------------------------------
// API helpers — messages
// ---------------------------------------------------------------------------

async function fetchMessages(id: string): Promise<{ messages: MetaMessage[] }> {
  const res = await fetch(`/api/meta/conversations/${id}/messages`);
  if (!res.ok) throw new Error("Failed to fetch messages");
  return res.json();
}

async function sendMessage(
  conversationId: string,
  recipientId: string,
  text: string,
  platform: "facebook" | "instagram"
): Promise<{ messageId: string }> {
  const res = await fetch(`/api/meta/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipientId, text, platform }),
  });
  if (!res.ok) throw new Error("Failed to send message");
  return res.json();
}

// ---------------------------------------------------------------------------
// ConversationRow
// ---------------------------------------------------------------------------

function ConversationRow({
  conversation,
  isSelected,
  unread,
  onSelect,
}: {
  conversation: UnifiedConversation;
  isSelected: boolean;
  unread: boolean;
  onSelect: () => void;
}) {
  const timeAgo = formatDistanceToNow(new Date(conversation.updatedAt), { addSuffix: true });

  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full text-left px-4 py-3 border-b border-border transition-colors border-l-2",
        isSelected
          ? "bg-primary/8 border-l-primary"
          : unread
          ? "bg-primary/[0.04] hover:bg-primary/[0.07] border-l-primary/40"
          : "hover:bg-muted/60 border-l-transparent"
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 shrink-0">
          {conversation.platform === "facebook" ? (
            <FacebookIcon className="w-4 h-4" />
          ) : (
            <InstagramIcon className="w-4 h-4" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className={cn("text-sm truncate", unread ? "font-bold text-foreground" : "font-medium text-foreground/80")}>
              {conversation.participantName}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className={cn("text-xs", unread ? "text-foreground/70 font-medium" : "text-muted-foreground")}>{timeAgo}</span>
              {unread && (
                <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
              )}
            </div>
          </div>
          <p className={cn("text-xs truncate mt-0.5", unread ? "text-foreground/75" : "text-muted-foreground")}>
            {conversation.lastMessage}
          </p>
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// ViewCommentNotification — system message for DM threads
// ---------------------------------------------------------------------------

const VIEW_COMMENT_RE = /^(You are responding to a user comment to a post on your Page\.) View comment\.\((.+)\)$/;

function ViewCommentNotification({ url, createdAt }: { url: string; createdAt: string }) {
  const timeAgo = formatDistanceToNow(new Date(createdAt), { addSuffix: true });
  return (
    <div className="self-center flex flex-col items-center gap-1.5 w-full max-w-sm px-2">
      <div className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-[10px] bg-muted/60 border border-border">
        <div className="w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0" />
        <p className="flex-1 text-xs text-muted-foreground leading-snug">
          This conversation started from a post comment
        </p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-xs font-medium text-primary hover:underline"
        >
          View →
        </a>
      </div>
      <span className="text-[10px] text-muted-foreground">{timeAgo}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MessageBubble
// ---------------------------------------------------------------------------

function MessageBubble({ message }: { message: MetaMessage }) {
  const isOutbound = message.direction === "outbound";
  const timeAgo = formatDistanceToNow(new Date(message.createdAt), { addSuffix: true });
  const viewCommentMatch = message.text.match(VIEW_COMMENT_RE);

  if (viewCommentMatch) {
    return <ViewCommentNotification url={viewCommentMatch[2]} createdAt={message.createdAt} />;
  }

  return (
    <div
      className={cn(
        "flex flex-col max-w-[70%] gap-1",
        isOutbound ? "self-end items-end" : "self-start items-start"
      )}
    >
      <div
        className={cn(
          "px-3 py-2 rounded-[10px] text-sm leading-relaxed break-words",
          isOutbound
            ? "bg-primary text-white rounded-br-sm"
            : "bg-muted text-foreground rounded-bl-sm",
          message.pending && "opacity-60"
        )}
      >
        {message.text}
      </div>
      <span className="text-[10px] text-muted-foreground">
        {message.pending ? "Sending…" : timeAgo}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MessageThread — for DM conversations
// ---------------------------------------------------------------------------

function MessageThread({
  conversationId,
  conversation,
}: {
  conversationId: string;
  conversation: DmConversation;
}) {
  const [replyText, setReplyText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["meta-messages", conversationId],
    queryFn: () => fetchMessages(conversationId),
    refetchInterval: 10_000,
  });

  const messages = data?.messages ?? [];

  const sendMutation = useMutation({
    mutationFn: (text: string) =>
      sendMessage(conversationId, conversation.participantId, text, conversation.platform),

    onMutate: async (text) => {
      // Cancel in-flight refetches so they don't overwrite optimistic state
      await queryClient.cancelQueries({ queryKey: ["meta-messages", conversationId] });

      // Save snapshot for rollback
      const prev = queryClient.getQueryData<{ messages: MetaMessage[] }>(
        ["meta-messages", conversationId]
      );

      // Inject optimistic message immediately
      const optimistic: MetaMessage = {
        id: `optimistic-${Date.now()}`,
        text,
        from: { id: "page", name: "You" },
        createdAt: new Date().toISOString(),
        direction: "outbound",
        pending: true,
      };

      queryClient.setQueryData(
        ["meta-messages", conversationId],
        (old: { messages: MetaMessage[] } | undefined) => ({
          messages: [...(old?.messages ?? []), optimistic],
        })
      );

      return { prev };
    },

    onError: (_err, _text, context) => {
      // Roll back on failure
      if (context?.prev !== undefined) {
        queryClient.setQueryData(["meta-messages", conversationId], context.prev);
      }
    },

    onSettled: () => {
      // Sync with real data regardless of success/failure
      queryClient.invalidateQueries({ queryKey: ["meta-messages", conversationId] });
      queryClient.invalidateQueries({ queryKey: ["meta-conversations"] });
    },
  });

  // Auto-scroll to latest message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  function handleSend() {
    const trimmed = replyText.trim();
    if (!trimmed || sendMutation.isPending) return;
    setReplyText(""); // clear immediately so it feels instant
    sendMutation.mutate(trimmed);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border bg-card shrink-0">
        {conversation.platform === "facebook" ? (
          <FacebookIcon className="w-4 h-4 shrink-0" />
        ) : (
          <InstagramIcon className="w-4 h-4 shrink-0" />
        )}
        <div>
          <h3 className="text-sm font-semibold text-foreground">{conversation.participantName}</h3>
          <p className="text-xs text-muted-foreground capitalize">{conversation.platform}</p>
        </div>
      </div>

      {/* Messages */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" />
          Loading messages…
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3"
        >
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center mt-8">No messages yet.</p>
          ) : (
            messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
          )}
        </div>
      )}

      {/* Reply composer */}
      <div className="shrink-0 border-t border-border bg-card px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message… (Enter to send)"
            rows={2}
            className={cn(
              "flex-1 resize-none rounded-[6px] border border-border bg-background px-3 py-2",
              "text-sm text-foreground placeholder:text-muted-foreground",
              "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
              "transition-colors"
            )}
          />
          <button
            onClick={handleSend}
            disabled={!replyText.trim() || sendMutation.isPending}
            className={cn(
              "flex items-center justify-center w-9 h-9 rounded-[6px] shrink-0 transition-colors",
              "bg-primary text-white hover:bg-primary/90",
              "disabled:opacity-40 disabled:cursor-not-allowed"
            )}
            aria-label="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        {sendMutation.isError && (
          <p className="text-xs text-destructive mt-1.5">Failed to send. Please try again.</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommentLeadThread — notification at top + full reply composer
// ---------------------------------------------------------------------------

async function sendCommentReply(
  commentId: string | null,
  recipientId: string,
  text: string,
  platform: "facebook" | "instagram"
): Promise<{ messageId: string }> {
  const res = await fetch("/api/meta/comment-reply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commentId, recipientId, text, platform }),
  });
  if (!res.ok) throw new Error("Failed to send reply");
  return res.json();
}

function CommentLeadThread({ conversation }: { conversation: CommentConversation }) {
  const [replyText, setReplyText] = useState("");
  const [sentMessages, setSentMessages] = useState<MetaMessage[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const timeAgo = formatDistanceToNow(new Date(conversation.updatedAt), { addSuffix: true });
  const postUrl = conversation.postId
    ? `https://www.facebook.com/${conversation.postId}`
    : null;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [sentMessages.length]);

  async function handleSend() {
    const trimmed = replyText.trim();
    if (!trimmed || isSending) return;

    setSendError(null);
    setReplyText("");

    // Optimistic — show immediately
    const optimistic: MetaMessage = {
      id: `optimistic-${Date.now()}`,
      text: trimmed,
      from: { id: "page", name: "You" },
      createdAt: new Date().toISOString(),
      direction: "outbound",
      pending: true,
    };
    setSentMessages((prev) => [...prev, optimistic]);
    setIsSending(true);

    try {
      await sendCommentReply(
        conversation.commentId,
        conversation.participantId,
        trimmed,
        conversation.platform
      );
      // Replace optimistic with confirmed
      setSentMessages((prev) =>
        prev.map((m) =>
          m.id === optimistic.id ? { ...m, pending: false } : m
        )
      );
    } catch {
      setSendError("Failed to send. Please try again.");
      setSentMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setReplyText(trimmed); // restore
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border bg-card shrink-0">
        {conversation.platform === "facebook" ? (
          <FacebookIcon className="w-4 h-4 shrink-0" />
        ) : (
          <InstagramIcon className="w-4 h-4 shrink-0" />
        )}
        <div>
          <h3 className="text-sm font-semibold text-foreground">{conversation.participantName}</h3>
          <p className="text-xs text-muted-foreground capitalize">
            {conversation.platform} · Comment lead
          </p>
        </div>
      </div>

      {/* Thread */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
        {/* Comment notification — always at top */}
        <div className="self-center w-full max-w-sm">
          <div className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-[10px] bg-muted/60 border border-border">
            <div className="w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0" />
            <p className="flex-1 text-xs text-muted-foreground leading-snug">
              Commented{" "}
              <span className="font-semibold text-foreground">
                &ldquo;{conversation.keyword}&rdquo;
              </span>{" "}
              on your {conversation.platform === "facebook" ? "Facebook" : "Instagram"} post
            </p>
            {postUrl && (
              <a
                href={postUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-xs font-medium text-primary hover:underline"
              >
                View →
              </a>
            )}
          </div>
          <p className="text-center text-[10px] text-muted-foreground mt-1">{timeAgo}</p>
        </div>

        {/* Sent replies */}
        {sentMessages.map((msg) => (
          <div key={msg.id} className="flex flex-col items-end gap-0.5">
            <div
              className={cn(
                "max-w-[70%] px-3 py-2 rounded-[10px] text-sm leading-relaxed break-words",
                "bg-primary text-white rounded-br-sm",
                msg.pending && "opacity-60"
              )}
            >
              {msg.text}
            </div>
            <span className="text-[10px] text-muted-foreground">
              {msg.pending ? "Sending…" : formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
            </span>
          </div>
        ))}
      </div>

      {/* Reply composer */}
      <div className="shrink-0 border-t border-border bg-card px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message… (Enter to send)"
            rows={2}
            className={cn(
              "flex-1 resize-none rounded-[6px] border border-border bg-background px-3 py-2",
              "text-sm text-foreground placeholder:text-muted-foreground",
              "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
              "transition-colors"
            )}
          />
          <button
            onClick={handleSend}
            disabled={!replyText.trim() || isSending}
            className={cn(
              "flex items-center justify-center w-9 h-9 rounded-[6px] shrink-0 transition-colors",
              "bg-primary text-white hover:bg-primary/90",
              "disabled:opacity-40 disabled:cursor-not-allowed"
            )}
            aria-label="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        {sendError && (
          <p className="text-xs text-destructive mt-1.5">{sendError}</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MetaConversations — main export
// ---------------------------------------------------------------------------

type PlatformTab = "all" | "facebook" | "instagram";

const PLATFORM_TABS: { key: PlatformTab; label: string; icon?: React.ElementType }[] = [
  { key: "facebook", label: "FB", icon: FacebookIcon },
  { key: "instagram", label: "IG", icon: InstagramIcon },
];

export function MetaConversations() {
  const [platformTab, setPlatformTab] = useState<PlatformTab>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [seenMap, setSeenMap] = useState<SeenMap>(loadSeenMap);
  const initializedRef = useRef(false);
  const queryClient = useQueryClient();

  // Fetch DM conversations
  const { data: dmData, isLoading: dmLoading, isFetching, error: dmError } = useQuery({
    queryKey: ["meta-conversations"],
    queryFn: fetchDmConversations,
    refetchInterval: 5_000,
    staleTime: 0,
    initialData: readDmCache,
    initialDataUpdatedAt: readDmCacheTimestamp,
  });

  // Fetch comment leads
  const { data: leadsData } = useQuery({
    queryKey: ["comment-leads-inbox"],
    queryFn: fetchCommentLeads,
    refetchInterval: 10_000,
    staleTime: 0,
  });

  // Merge DMs and comment leads, sort newest first
  const allConversations: UnifiedConversation[] = React.useMemo(() => {
    const dms: DmConversation[] = dmData?.conversations ?? [];
    const comments: CommentConversation[] = (leadsData?.leads ?? []).map(
      (lead: CommentLeadRow): CommentConversation => ({
        source: "comment",
        id: lead.id,
        platform: lead.platform,
        participantName: lead.name,
        participantId: lead.commenterId ?? "",
        lastMessage: `Commented "${lead.keyword}"`,
        updatedAt: lead.createdAt,
        keyword: lead.keyword,
        commentText: lead.commentText,
        commentId: lead.commentId,
        postId: lead.postId,
      })
    );

    return [...dms, ...comments].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }, [dmData, leadsData]);

  // On first data load, initialise existing DM conversations as "seen" so
  // we don't show dots on old threads. We wait until DMs have actually loaded
  // (dmData is defined) so we don't fire early on an empty array and skip them.
  // Comment leads are NEVER auto-marked as seen — they always start unread.
  useEffect(() => {
    if (initializedRef.current || !dmData?.conversations?.length) return;
    initializedRef.current = true;

    setSeenMap((prev) => {
      const next = { ...prev };
      for (const conv of dmData.conversations) {
        if (!(conv.id in next)) {
          next[conv.id] = conv.updatedAt;
        }
      }
      saveSeenMap(next);
      return next;
    });
  }, [dmData]);

  function isUnread(conv: UnifiedConversation): boolean {
    const seenAt = seenMap[conv.id];
    if (!seenAt) return true; // new conversation, never opened
    return new Date(conv.updatedAt) > new Date(seenAt);
  }

  function handleSelect(id: string) {
    setSelectedId(id);
    // Store the conversation's current updatedAt (not Date.now()) as the seen
    // timestamp. This means a future message — which will have a newer updatedAt
    // — will correctly show as unread even if opened just moments ago.
    const conv = allConversations.find((c) => c.id === id);
    const seenAt = conv?.updatedAt ?? new Date().toISOString();
    setSeenMap((prev) => {
      const next = { ...prev, [id]: seenAt };
      saveSeenMap(next);
      return next;
    });
  }

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: ["meta-conversations"] });
    queryClient.invalidateQueries({ queryKey: ["comment-leads-inbox"] });
  }

  function handleTabChange(tab: PlatformTab) {
    // Clicking the active tab toggles back to "all"
    const next = platformTab === tab ? "all" : tab;
    setPlatformTab(next);
    if (next !== "all") {
      const sel = allConversations.find((c) => c.id === selectedId);
      if (sel && sel.platform !== next) setSelectedId(null);
    }
  }

  const filtered = allConversations
    .filter((c) => platformTab === "all" || c.platform === platformTab)
    .filter((c) => !unreadOnly || isUnread(c));

  const selectedConversation = allConversations.find((c) => c.id === selectedId) ?? null;

  const isLoading = dmLoading && !dmData;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel */}
      <div className="flex flex-col border-r border-border bg-card w-full lg:w-80 xl:w-96 shrink-0">
        {/* Platform tabs + unread toggle + refresh */}
        <div className="px-4 py-3 border-b border-border space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 bg-muted rounded-lg p-1 w-fit">
              {PLATFORM_TABS.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => handleTabChange(key)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                    platformTab === key
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {Icon && <Icon className="w-3.5 h-3.5" />}
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              {isFetching && <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
              <div className="flex items-center bg-muted rounded-lg p-0.5">
                <button
                  onClick={() => setUnreadOnly(true)}
                  className={cn(
                    "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                    unreadOnly ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Unread
                </button>
                <button
                  onClick={() => setUnreadOnly(false)}
                  className={cn(
                    "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                    !unreadOnly ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  All
                </button>
              </div>
              <button
                onClick={handleRefresh}
                disabled={isFetching}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-40"
                aria-label="Refresh conversations"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
              </button>
            </div>
          </div>
        </div>

        {/* Conversation list */}
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-sm text-muted-foreground gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Loading…
          </div>
        ) : dmError ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 px-4">
            <p className="text-xs text-destructive font-mono text-center break-all">
              {(dmError as Error).message}
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
            <p className="text-sm">{unreadOnly ? "No unread conversations" : "No conversations yet"}</p>
            {unreadOnly && (
              <button onClick={() => setUnreadOnly(false)} className="text-xs text-primary hover:underline">
                Show all conversations
              </button>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {filtered.map((convo) => (
              <ConversationRow
                key={convo.id}
                conversation={convo}
                isSelected={selectedId === convo.id}
                unread={isUnread(convo)}
                onSelect={() => handleSelect(convo.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        {selectedConversation ? (
          selectedConversation.source === "comment" ? (
            <CommentLeadThread conversation={selectedConversation} />
          ) : (
            <MessageThread
              conversationId={selectedConversation.id}
              conversation={selectedConversation}
            />
          )
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <FacebookIcon className="w-5 h-5" />
            </div>
            <p className="text-sm">Select a conversation</p>
          </div>
        )}
      </div>
    </div>
  );
}
