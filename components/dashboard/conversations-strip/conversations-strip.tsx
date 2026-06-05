"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, CheckCheck, X, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { ConversationTile } from "./conversation-tile";
import { ReplyModal } from "./reply-modal";
import type { QueueItem } from "@/app/api/inbox/queue/route";
import { OpportunityModal } from "@/components/pipeline/opportunity-modal";
import type { GHLOpportunity } from "@/lib/ghl/types";
import { differenceInHours } from "date-fns";

interface OppState {
  opportunity: GHLOpportunity;
  stageName: string;
  draft: string;
}

type FilterKey = "all" | "sms" | "email" | "instagram" | "facebook" | "tiktok" | "late";

const FILTER_LABELS: { key: FilterKey; label: string }[] = [
  { key: "all",       label: "All" },
  { key: "sms",       label: "SMS" },
  { key: "email",     label: "Email" },
  { key: "instagram", label: "Instagram" },
  { key: "facebook",  label: "Facebook" },
  { key: "tiktok",    label: "TikTok" },
  { key: "late",      label: "Late (24h+)" },
];

function matchesFilter(item: QueueItem, filter: FilterKey): boolean {
  if (filter === "all") return true;
  if (filter === "late") return differenceInHours(new Date(), new Date(item.updatedAt)) >= 24;
  if (filter === "instagram") return item.platform === "instagram";
  if (filter === "facebook") return item.platform === "facebook" || item.channel === "Meta";
  if (filter === "tiktok") return item.channel === "TikTok";
  const t = (item.type ?? "").toLowerCase();
  if (filter === "sms") return t.includes("sms") || t.includes("phone");
  if (filter === "email") return t.includes("email");
  return true;
}

// ─── Bottom drawer ────────────────────────────────────────────────────────────

interface InboxDrawerProps {
  items: QueueItem[];
  total: number;
  onReply: (item: QueueItem) => void;
  onClose: () => void;
}

function InboxDrawer({ items, total, onReply, onClose }: InboxDrawerProps) {
  const [filter, setFilter] = useState<FilterKey>("all");

  const filtered = items.filter((i) => matchesFilter(i, filter));

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet — fixed height, never resizes */}
      <div className="relative bg-card border-t border-border rounded-t-[24px] shadow-2xl h-[72vh] flex flex-col z-10">
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-2 shrink-0">
          <div className="w-9 h-1 rounded-full bg-border/60" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pb-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <MessageSquare className="w-4 h-4 text-muted-foreground" />
            <h3
              className="text-[15px] font-bold text-foreground"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Inbox
            </h3>
            <span className="text-[10px] font-bold bg-destructive text-destructive-foreground px-2 py-0.5 rounded-full tabular-nums leading-none">
              {total} unread
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filter pills */}
        <div
          className="flex gap-2 px-6 pb-3 overflow-x-auto shrink-0"
          style={{ scrollbarWidth: "none" }}
        >
          {FILTER_LABELS.map(({ key, label }) => {
            const count = key === "all" ? items.length : items.filter((i) => matchesFilter(i, key)).length;
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={cn(
                  "shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-semibold transition-all duration-150",
                  filter === key
                    ? "bg-foreground text-background shadow-sm"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {label}
                <span className={cn(
                  "text-[10px] font-bold tabular-nums",
                  filter === key ? "opacity-60" : "opacity-50"
                )}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Divider */}
        <div className="h-px bg-border/60 mx-6 shrink-0" />

        {/* List — scrolls inside the fixed-height sheet */}
        <div className="flex-1 overflow-y-auto px-6 py-3" style={{ scrollbarWidth: "thin" }}>
          {filtered.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-3">
              <CheckCheck className="w-10 h-10 text-muted-foreground/20" />
              <div>
                <p className="text-sm font-semibold text-foreground">Nothing here</p>
                <p className="text-xs text-muted-foreground mt-1">No conversations match this filter.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map((item) => {
                const isLate = differenceInHours(new Date(), new Date(item.updatedAt)) >= 24;
                const channelLabel = item.platform
                  ? item.platform.charAt(0).toUpperCase() + item.platform.slice(1)
                  : item.channel;
                const timeStr = (() => {
                  const d = new Date(item.updatedAt);
                  const h = differenceInHours(new Date(), d);
                  if (h < 1) return "just now";
                  if (h < 24) return `${h}h ago`;
                  return `${Math.floor(h / 24)}d ago`;
                })();

                return (
                  <button
                    key={item.id}
                    onClick={() => { onReply(item); onClose(); }}
                    className={cn(
                      "w-full text-left px-4 py-3.5 rounded-[12px] transition-all duration-150 group",
                      "hover:bg-muted/50",
                      isLate ? "bg-destructive/[0.06]" : ""
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn(
                        "text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded",
                        "bg-muted text-muted-foreground"
                      )}>
                        {channelLabel}
                      </span>
                      {isLate && (
                        <span className="text-[9px] font-bold text-destructive uppercase tracking-wide">
                          Late
                        </span>
                      )}
                      <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                        {timeStr}
                      </span>
                    </div>
                    <p className="text-[13.5px] font-semibold text-foreground truncate leading-snug">
                      {item.contactName}
                    </p>
                    <p className="text-[12px] text-muted-foreground truncate mt-0.5 leading-snug">
                      {item.lastMessage || <span className="italic opacity-50">No preview</span>}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main strip ───────────────────────────────────────────────────────────────

export function ConversationsStrip() {
  const queryClient = useQueryClient();
  const [replyItem, setReplyItem] = useState<QueueItem | null>(null);
  const [oppState, setOppState] = useState<OppState | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ items: QueueItem[]; total: number }>({
    queryKey: ["inbox-queue-dashboard"],
    queryFn: () => fetch("/api/inbox/queue").then((r) => r.json()),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const allItems = data?.items ?? [];
  const items = allItems.filter((i) => !dismissedIds.has(i.id));
  const total = data?.total ?? items.length;

  async function handleReply(item: QueueItem) {
    if (item.channel === "GHL" && item.contactId) {
      setLoadingId(item.id);

      // Fire AI draft in background — don't let it block the modal opening
      const draftPromise = fetch("/api/inbox/queue/draft", {
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
        .then((d) => d.draft ?? "")
        .catch(() => "");

      // Only await the fast opportunity lookup
      let oppData: { opportunity?: unknown; stageName?: string } | null = null;
      try {
        oppData = await fetch(
          `/api/ghl/contacts/${item.contactId}/opportunity?name=${encodeURIComponent(item.contactName)}`
        ).then((r) => r.json());
      } catch {
        oppData = null;
      }

      setLoadingId(null);

      if (oppData?.opportunity) {
        // Open modal immediately with empty draft, populate draft when AI responds
        setOppState({ opportunity: oppData.opportunity as OppState["opportunity"], stageName: oppData.stageName ?? "", draft: "" });
        draftPromise.then((draft) => {
          if (draft) setOppState((prev) => prev ? { ...prev, draft } : prev);
        });
        return;
      }
    }

    setReplyItem(item);
  }

  function handleSent(item: QueueItem) {
    setDismissedIds((prev) => new Set([...prev, item.id]));
    setReplyItem(null);
    setOppState(null);
    queryClient.invalidateQueries({ queryKey: ["inbox-queue-dashboard"] });
  }

  return (
    <>
      <div className="bg-card border border-border rounded-[10px] p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-muted-foreground" />
            <h3
              className="text-sm font-semibold text-foreground"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Conversations
            </h3>
            {items.length > 0 && (
              <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {items.length} unread
              </span>
            )}
          </div>

          {items.length > 0 && (
            <button
              onClick={() => setDrawerOpen(true)}
              className="text-xs font-medium text-muted-foreground hover:text-foreground border border-border rounded-[7px] px-2.5 py-1.5 hover:bg-muted transition-colors flex items-center gap-1.5"
            >
              <LayoutGrid className="w-3 h-3" />
              See all {total}
            </button>
          )}
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-[170px] w-[210px] shrink-0 rounded-[12px] bg-muted/40 animate-pulse"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-7 text-center">
            <CheckCheck className="w-7 h-7 text-primary/25 mb-2" />
            <p className="text-sm font-medium text-foreground">All caught up</p>
            <p className="text-xs text-muted-foreground mt-0.5">No messages awaiting reply.</p>
          </div>
        ) : (
          <>
            {/* Desktop: horizontal scroll */}
            <div
              className="hidden sm:flex gap-3 overflow-x-auto scroll-smooth pb-2"
              style={{ scrollbarWidth: "thin" }}
            >
              {items.map((item) => (
                <div key={item.id} className="shrink-0">
                  <ConversationTile item={item} onReply={() => handleReply(item)} isLoading={loadingId === item.id} />
                </div>
              ))}
            </div>

            {/* Mobile: 2-column grid */}
            <div className="grid grid-cols-2 gap-2 sm:hidden">
              {items.map((item) => (
                <ConversationTile key={item.id} item={item} onReply={() => handleReply(item)} isLoading={loadingId === item.id} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* See all drawer */}
      {drawerOpen && (
        <InboxDrawer
          items={items}
          total={total}
          onReply={handleReply}
          onClose={() => setDrawerOpen(false)}
        />
      )}

      {/* Opportunity card with pre-filled draft */}
      {oppState && (
        <OpportunityModal
          opportunity={oppState.opportunity}
          stageName={oppState.stageName}
          initialDraft={oppState.draft}
          onClose={() => setOppState(null)}
        />
      )}

      {/* Fallback reply modal */}
      {replyItem && (
        <ReplyModal
          item={replyItem}
          onSent={() => handleSent(replyItem)}
          onClose={() => setReplyItem(null)}
        />
      )}
    </>
  );
}
