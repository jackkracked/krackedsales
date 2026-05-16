"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, CheckCheck } from "lucide-react";
import { ConversationTile } from "./conversation-tile";
import { ReplyModal } from "./reply-modal";
import type { QueueItem } from "@/app/api/inbox/queue/route";
import { OpportunityModal } from "@/components/pipeline/opportunity-modal";
import type { GHLOpportunity } from "@/lib/ghl/types";

interface OppState {
  opportunity: GHLOpportunity;
  stageName: string;
  draft: string;
}

export function ConversationsStrip() {
  const queryClient = useQueryClient();
  const [replyItem, setReplyItem] = useState<QueueItem | null>(null);
  const [oppState, setOppState] = useState<OppState | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery<{ items: QueueItem[]; total: number }>({
    queryKey: ["inbox-queue-dashboard"],
    queryFn: () => fetch("/api/inbox/queue").then((r) => r.json()),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const items = (data?.items ?? []).filter((i) => !dismissedIds.has(i.id));

  async function handleReply(item: QueueItem) {
    // For GHL items with a contactId: try to open the opportunity card with AI draft pre-filled
    if (item.channel === "GHL" && item.contactId) {
      const [draftRes, oppRes] = await Promise.allSettled([
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
        fetch(`/api/ghl/contacts/${item.contactId}/opportunity?name=${encodeURIComponent(item.contactName)}`).then((r) => r.json()),
      ]);

      const draft = draftRes.status === "fulfilled" ? (draftRes.value.draft ?? "") : "";
      const oppData = oppRes.status === "fulfilled" ? oppRes.value : null;

      if (oppData?.opportunity) {
        setOppState({
          opportunity: oppData.opportunity,
          stageName: oppData.stageName ?? "",
          draft,
        });
        return;
      }
    }

    // Fallback: custom reply modal (Meta, TikTok, or GHL with no opportunity)
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
              <span className="text-[10px] font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded-full tabular-nums">
                {items.length}
              </span>
            )}
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-[190px] w-[200px] shrink-0 rounded-[12px] bg-muted/40 animate-pulse"
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
              className="hidden sm:flex gap-3 overflow-x-auto scroll-smooth pb-1"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              {items.map((item) => (
                <div key={item.id} className="shrink-0">
                  <ConversationTile
                    item={item}
                    onReply={() => handleReply(item)}
                  />
                </div>
              ))}
            </div>

            {/* Mobile: 2-column grid */}
            <div className="grid grid-cols-2 gap-2 sm:hidden">
              {items.map((item) => (
                <ConversationTile
                  key={item.id}
                  item={item}
                  onReply={() => handleReply(item)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Opportunity card with pre-filled draft (GHL contacts with opportunity) */}
      {oppState && (
        <OpportunityModal
          opportunity={oppState.opportunity}
          stageName={oppState.stageName}
          initialDraft={oppState.draft}
          onClose={() => setOppState(null)}
        />
      )}

      {/* Fallback: custom reply modal for Meta/TikTok or contacts without opportunity */}
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
