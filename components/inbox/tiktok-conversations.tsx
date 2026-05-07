"use client";

import React, { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { RefreshCw, Send, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { TikTokIcon } from "@/components/shared/channel-icon";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// GHL conversation shape — subset of what the GHL conversations API returns
interface TikTokConversation {
  id: string;
  contactId: string;
  participantName: string;
  lastMessage: string;
  updatedAt: string;
  avatarUrl?: string;
}

interface TikTokMessage {
  id: string;
  text: string;
  createdAt: string;
  direction: "inbound" | "outbound";
  pending?: boolean;
}

interface TikTokComment {
  id: string;
  videoId: string;
  videoTitle: string;
  authorName: string;
  text: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// API helpers — DMs routed through GHL (TikTok's public API has no DM scope)
// ---------------------------------------------------------------------------

/** Replace raw GHL storage URLs with a readable label */
function cleanPreview(body: string): string {
  if (!body.trim()) return "";
  if (/^https?:\/\/storage\.googleapis\.com\/msgsndr\//i.test(body.trim())) return "📎 Attachment";
  if (/^https?:\/\//i.test(body.trim()) && !body.trim().includes(" ")) return "📎 Attachment";
  return body;
}

async function fetchConversations(): Promise<{
  conversations: TikTokConversation[];
  notConfigured?: boolean;
}> {
  const res = await fetch("/api/ghl/conversations?type=TYPE_TIKTOK&limit=50");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json();
  const raw: Array<{
    id: string; contactId: string; type?: string;
    fullName?: string; contact?: { name?: string };
    lastMessageBody?: string; lastMessageDate?: string | number;
    avatarUrl?: string;
  }> = data.conversations ?? [];

  const conversations: TikTokConversation[] = raw
    .filter((c) => !c.type || c.type === "TYPE_TIKTOK")
    .map((c) => ({
      id: c.id,
      contactId: c.contactId,
      participantName: c.fullName ?? c.contact?.name ?? "Unknown",
      lastMessage: cleanPreview(c.lastMessageBody ?? ""),
      updatedAt: c.lastMessageDate
        ? typeof c.lastMessageDate === "number"
          ? new Date(c.lastMessageDate).toISOString()
          : c.lastMessageDate
        : new Date().toISOString(),
      avatarUrl: c.avatarUrl,
    }));

  return { conversations };
}

async function fetchMessages(id: string): Promise<{ messages: TikTokMessage[] }> {
  const res = await fetch(`/api/ghl/conversations/${id}/messages`);
  if (!res.ok) throw new Error("Failed to fetch messages");
  const data = await res.json();

  const messages: TikTokMessage[] = (data.messages ?? []).map(
    (m: { id: string; body?: string; dateAdded?: string | number; direction?: string }) => ({
      id: m.id,
      text: cleanPreview(m.body ?? "") || "📎 Attachment",
      createdAt: m.dateAdded
        ? typeof m.dateAdded === "number"
          ? new Date(m.dateAdded).toISOString()
          : m.dateAdded
        : new Date().toISOString(),
      direction: (m.direction ?? "inbound") as "inbound" | "outbound",
    })
  );

  return { messages };
}

async function postMessage(
  id: string,
  contactId: string,
  text: string
): Promise<{ messageId?: string }> {
  const res = await fetch(`/api/ghl/conversations/${id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text, type: "TYPE_TIKTOK", contactId }),
  });
  if (!res.ok) throw new Error("Failed to send message");
  return res.json();
}

async function fetchComments(): Promise<{
  comments: TikTokComment[];
  notConfigured?: boolean;
}> {
  const res = await fetch("/api/tiktok/comments");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function postCommentReply(
  commentId: string,
  videoId: string,
  text: string
): Promise<{ ok: boolean }> {
  const res = await fetch("/api/tiktok/comment-reply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commentId, videoId, text }),
  });
  if (!res.ok) throw new Error("Failed to send reply");
  return res.json();
}

// ---------------------------------------------------------------------------
// NotConfigured banner
// ---------------------------------------------------------------------------

function NoDmsYet({ notConfigured }: { notConfigured?: boolean }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
        <TikTokIcon className="w-5 h-5 text-muted-foreground" />
      </div>
      {notConfigured ? (
        <>
          <p className="text-sm font-medium text-foreground">TikTok not connected</p>
          <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
            Go to <a href="/settings" className="text-primary underline">Settings → TikTok</a> and connect your TikTok account to see DMs here.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-foreground">No TikTok DMs yet</p>
          <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
            TikTok DMs will appear here once someone messages your connected account.
            New messages sync automatically every 10 seconds.
          </p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Avatar — first letter fallback
// ---------------------------------------------------------------------------

function Avatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className="w-8 h-8 rounded-full object-cover shrink-0"
      />
    );
  }
  const letter = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
      <span className="text-xs font-semibold text-muted-foreground">{letter}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConversationRow
// ---------------------------------------------------------------------------

function ConversationRow({
  conversation,
  isSelected,
  onSelect,
}: {
  conversation: TikTokConversation;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const timeAgo = formatDistanceToNow(new Date(conversation.updatedAt), { addSuffix: true });

  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full text-left px-4 py-3 border-b border-border transition-colors",
        isSelected ? "bg-primary/6" : "hover:bg-muted/60"
      )}
    >
      <div className="flex items-start gap-2.5">
        <Avatar name={conversation.participantName} avatarUrl={conversation.avatarUrl} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className="text-sm font-medium text-foreground truncate">
              {conversation.participantName}
            </span>
            <span className="text-xs text-muted-foreground shrink-0">{timeAgo}</span>
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {conversation.lastMessage}
          </p>
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// MessageBubble
// ---------------------------------------------------------------------------

function MessageBubble({ message }: { message: TikTokMessage }) {
  const isOutbound = message.direction === "outbound";
  const timeAgo = formatDistanceToNow(new Date(message.createdAt), { addSuffix: true });

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
// DmThread — right panel for a selected DM conversation
// ---------------------------------------------------------------------------

function DmThread({ conversation }: { conversation: TikTokConversation }) {
  const [replyText, setReplyText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["tiktok-messages", conversation.id],
    queryFn: () => fetchMessages(conversation.id),
    refetchInterval: 10_000,
  });

  const messages = data?.messages ?? [];

  const sendMutation = useMutation({
    mutationFn: (text: string) => postMessage(conversation.id, conversation.contactId, text),

    onMutate: async (text) => {
      await queryClient.cancelQueries({ queryKey: ["tiktok-messages", conversation.id] });

      const prev = queryClient.getQueryData<{ messages: TikTokMessage[] }>(
        ["tiktok-messages", conversation.id]
      );

      const optimistic: TikTokMessage = {
        id: `optimistic-${Date.now()}`,
        text,
        createdAt: new Date().toISOString(),
        direction: "outbound",
        pending: true,
      };

      queryClient.setQueryData(
        ["tiktok-messages", conversation.id],
        (old: { messages: TikTokMessage[] } | undefined) => ({
          messages: [...(old?.messages ?? []), optimistic],
        })
      );

      return { prev };
    },

    onError: (_err, _text, context) => {
      if (context?.prev !== undefined) {
        queryClient.setQueryData(["tiktok-messages", conversation.id], context.prev);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["tiktok-messages", conversation.id] });
      queryClient.invalidateQueries({ queryKey: ["tiktok-conversations"] });
    },
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  function handleSend() {
    const trimmed = replyText.trim();
    if (!trimmed || sendMutation.isPending) return;
    setReplyText("");
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
        <TikTokIcon className="w-4 h-4 shrink-0 text-foreground" />
        <div>
          <h3 className="text-sm font-semibold text-foreground">{conversation.participantName}</h3>
          <p className="text-xs text-muted-foreground">TikTok DM</p>
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
// CommentRow — left panel item for Comments tab
// ---------------------------------------------------------------------------

function CommentRow({
  comment,
  isSelected,
  onSelect,
}: {
  comment: TikTokComment;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const timeAgo = formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true });

  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full text-left px-4 py-3 border-b border-border transition-colors",
        isSelected ? "bg-primary/6" : "hover:bg-muted/60"
      )}
    >
      <div className="flex items-start gap-2.5">
        <Avatar name={comment.authorName} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className="text-sm font-medium text-foreground truncate">
              {comment.authorName}
            </span>
            <span className="text-xs text-muted-foreground shrink-0">{timeAgo}</span>
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">{comment.text}</p>
          <p className="text-[10px] text-muted-foreground truncate mt-0.5 italic">
            {comment.videoTitle}
          </p>
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// CommentThread — right panel for a selected comment
// ---------------------------------------------------------------------------

function CommentThread({ comment }: { comment: TikTokComment }) {
  const [replyText, setReplyText] = useState("");
  const [sentReplies, setSentReplies] = useState<TikTokMessage[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const timeAgo = formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [sentReplies.length]);

  async function handleSend() {
    const trimmed = replyText.trim();
    if (!trimmed || isSending) return;

    setSendError(null);
    setReplyText("");

    const optimistic: TikTokMessage = {
      id: `optimistic-${Date.now()}`,
      text: trimmed,
      createdAt: new Date().toISOString(),
      direction: "outbound",
      pending: true,
    };
    setSentReplies((prev) => [...prev, optimistic]);
    setIsSending(true);

    try {
      await postCommentReply(comment.id, comment.videoId, trimmed);
      setSentReplies((prev) =>
        prev.map((m) => (m.id === optimistic.id ? { ...m, pending: false } : m))
      );
    } catch {
      setSendError("Failed to send. Please try again.");
      setSentReplies((prev) => prev.filter((m) => m.id !== optimistic.id));
      setReplyText(trimmed);
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
        <TikTokIcon className="w-4 h-4 shrink-0 text-foreground" />
        <div>
          <h3 className="text-sm font-semibold text-foreground">{comment.authorName}</h3>
          <p className="text-xs text-muted-foreground">TikTok · Comment</p>
        </div>
      </div>

      {/* Thread */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
        {/* Original comment — shown as a system notification at top */}
        <div className="self-center w-full max-w-sm">
          <div className="w-full flex items-start gap-3 px-3.5 py-2.5 rounded-[10px] bg-muted/60 border border-border">
            <div className="w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0 mt-1.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground leading-snug">
                Commented on{" "}
                <span className="font-semibold text-foreground italic">{comment.videoTitle}</span>
              </p>
              <p className="text-xs text-foreground mt-1 leading-snug">
                &ldquo;{comment.text}&rdquo;
              </p>
            </div>
          </div>
          <p className="text-center text-[10px] text-muted-foreground mt-1">{timeAgo}</p>
        </div>

        {/* Sent replies */}
        {sentReplies.map((msg) => (
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
              {msg.pending
                ? "Sending…"
                : formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
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
            placeholder="Reply to comment… (Enter to send)"
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
            aria-label="Send reply"
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
// DmsPanel — full DMs tab (list + thread)
// ---------------------------------------------------------------------------

function DmsPanel() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["tiktok-conversations"],
    queryFn: fetchConversations,
    refetchInterval: 10_000,
  });

  const conversations = data?.conversations ?? [];
  const selectedConversation = conversations.find((c) => c.id === selectedId) ?? null;

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: ["tiktok-conversations"] });
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel */}
      <div className="flex flex-col border-r border-border bg-card w-full lg:w-80 xl:w-96 shrink-0">
        {/* Sub-header with refresh */}
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Direct Messages</span>
          <button
            onClick={handleRefresh}
            disabled={isFetching}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-40"
            aria-label="Refresh"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
          </button>
        </div>

        {/* List */}
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-sm text-muted-foreground gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Loading…
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 px-4">
            <p className="text-xs text-destructive font-mono text-center break-all">
              {(error as Error).message}
            </p>
          </div>
        ) : conversations.length === 0 ? (
          <NoDmsYet notConfigured={data?.notConfigured} />
        ) : (
          <div className="flex-1 overflow-y-auto">
            {conversations.map((convo) => (
              <ConversationRow
                key={convo.id}
                conversation={convo}
                isSelected={selectedId === convo.id}
                onSelect={() => setSelectedId(convo.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        {selectedConversation ? (
          <DmThread conversation={selectedConversation} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <TikTokIcon className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-sm">Select a conversation</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommentsPanel — full Comments tab (list + thread)
// ---------------------------------------------------------------------------

function CommentsPanel() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["tiktok-comments"],
    queryFn: fetchComments,
    refetchInterval: 30_000,
  });

  const comments = data?.comments ?? [];
  const commentsNotConfigured = data?.notConfigured === true;
  const selectedComment = comments.find((c) => c.id === selectedId) ?? null;

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: ["tiktok-comments"] });
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel */}
      <div className="flex flex-col border-r border-border bg-card w-full lg:w-80 xl:w-96 shrink-0">
        {/* Sub-header with refresh */}
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Comments</span>
          <button
            onClick={handleRefresh}
            disabled={isFetching}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-40"
            aria-label="Refresh"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
          </button>
        </div>

        {/* List */}
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-sm text-muted-foreground gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Loading…
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 px-4">
            <p className="text-xs text-destructive font-mono text-center break-all">
              {(error as Error).message}
            </p>
          </div>
        ) : commentsNotConfigured ? (
          <NoDmsYet />
        ) : comments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
            <p className="text-sm">No comments yet</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {comments.map((comment) => (
              <CommentRow
                key={comment.id}
                comment={comment}
                isSelected={selectedId === comment.id}
                onSelect={() => setSelectedId(comment.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        {selectedComment ? (
          <CommentThread comment={selectedComment} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <MessageCircle className="w-5 h-5" />
            </div>
            <p className="text-sm">Select a comment</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TikTokConversations — main export
// ---------------------------------------------------------------------------

type TikTokTab = "dms" | "comments";

const TIKTOK_TABS: { key: TikTokTab; label: string }[] = [
  { key: "dms", label: "DMs" },
  { key: "comments", label: "Comments" },
];

export function TikTokConversations() {
  const [activeTab, setActiveTab] = useState<TikTokTab>("dms");

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sub-tab bar */}
      <div className="px-4 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1 w-fit">
          {TIKTOK_TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                activeTab === key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "dms" ? <DmsPanel /> : <CommentsPanel />}
      </div>
    </div>
  );
}
