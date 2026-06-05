"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils/cn";
import {
  Sparkles, Send, ChevronRight, ChevronLeft, RefreshCw, MessageSquare, SkipForward, UserCircle,
} from "lucide-react";
import { OpportunityModal } from "@/components/pipeline/opportunity-modal";
import type { GHLOpportunity } from "@/lib/ghl/types";
import { relativeTime } from "@/lib/utils/date";
import type { GHLConversation, GHLMessage } from "@/lib/ghl/types";
import { useBrandCategoryStore, normalizeDomain } from "@/store/brand-category-store";
import { cleanUrl, looksLikeUrl, parseQualificationNote, isQualificationNote } from "@/lib/utils/url";

const NO_WEBSITE_TEMPLATE = `I saw you didn't leave a website? Do you have a website for your brand? We can't do a demo unless you have an active website we can access.`;

const NON_DTC_TEMPLATE = `Appreciate you reaching out.

Quick heads up: our free email design offer is only for DTC / CPG e-commerce brands (Shopify + Klaviyo or Omnisend). That's where our systems are built to plug in directly. If you have an ecom brand you work with directly that you want to refer or white-label our services for we do offer that!

For service-based, local, or B2B businesses, the tools are usually different, so we're not able to implement this properly.

That said, I can invite you to our private Skool community, where we share the design templates, retention strategies, and email/SMS frameworks we use with our clients.
Want me to send you the invite?

I may also have a few people that are a better fit to help if you are open to some intros.`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface QueueItem {
  conversation: GHLConversation;
  pendingMessages: GHLMessage[];
  recentHistory: Array<{ role: string; body: string }>;
}

interface DraftState {
  [conversationId: string]: {
    text: string;
    status: "idle" | "generating" | "ready" | "sending" | "sent" | "skipped";
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

export function FollowUpQueue() {
  const queryClient = useQueryClient();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [drafts, setDrafts] = useState<DraftState>({});
  const [opportunityModal, setOpportunityModal] = useState<{
    opportunity: GHLOpportunity;
    stageName: string;
    draft: string;
  } | null>(null);
  const [loadingOpportunity, setLoadingOpportunity] = useState(false);

  // Step 1: Fetch unread conversations
  const { data: convData, isLoading: convLoading } = useQuery({
    queryKey: ["followup-conversations"],
    queryFn: async () => {
      const res = await fetch("/api/ghl/conversations?limit=50");
      if (!res.ok) return { conversations: [] };
      return res.json();
    },
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
  });

  // Step 2: Fetch messages for unread conversations
  const unreadConvs: GHLConversation[] = (convData?.conversations ?? [])
    .filter((c: GHLConversation) => (c.unreadCount ?? 0) > 0)
    .slice(0, 10);

  const { data: messagesMap } = useQuery({
    queryKey: ["followup-messages", unreadConvs.map((c) => c.id).join(",")],
    queryFn: async () => {
      const map: Record<string, GHLMessage[]> = {};
      await Promise.all(
        unreadConvs.map(async (conv) => {
          try {
            const res = await fetch(`/api/ghl/conversations/${conv.id}/messages`);
            if (!res.ok) return;
            const d = await res.json();
            map[conv.id] = d.messages ?? [];
          } catch { /* skip */ }
        })
      );
      return map;
    },
    enabled: unreadConvs.length > 0,
    staleTime: 60 * 1000,
  });

  // Build queue from conversations with pending inbound messages
  const queue: QueueItem[] = unreadConvs
    .map((conv) => {
      const msgs = [...(messagesMap?.[conv.id] ?? [])].reverse(); // oldest first
      if (!msgs.length) return null;

      let lastOutboundIdx = -1;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].direction === "outbound" && msgs[i].messageType !== "TYPE_ACTIVITY_OPPORTUNITY") {
          lastOutboundIdx = i;
          break;
        }
      }

      const pendingMessages = msgs.slice(lastOutboundIdx + 1).filter(
        (m) => m.direction === "inbound" && m.messageType !== "TYPE_ACTIVITY_OPPORTUNITY" && m.body
      );

      if (!pendingMessages.length) return null;

      const recentHistory = msgs
        .slice(Math.max(0, lastOutboundIdx - 3), lastOutboundIdx + 1)
        .filter((m) => m.messageType !== "TYPE_ACTIVITY_OPPORTUNITY" && m.body)
        .map((m) => ({ role: m.direction ?? "inbound", body: m.body }));

      return { conversation: conv, pendingMessages, recentHistory };
    })
    .filter(Boolean) as QueueItem[];

  // Active queue (not sent or skipped)
  const activeQueue = queue.filter(
    (q) => !["sent", "skipped"].includes(drafts[q.conversation.id]?.status ?? "idle")
  );

  const total = activeQueue.length;
  const current = activeQueue[currentIndex < total ? currentIndex : 0];

  // Auto-generate draft for current item
  const { getCategory, setCategory, markAnalyzing, isAnalyzing } = useBrandCategoryStore();

  /** Resolve brand category for a contact, triggering categorization if needed.
   *  Returns: category string | "no_website" | null (unknown/in-flight) */
  async function resolveBrandCategory(contactId: string): Promise<string | null> {
    try {
      const res = await fetch(`/api/ghl/contacts/${contactId}/notes`);
      if (!res.ok) return null;
      const data = await res.json();
      const notes: Array<{ body: string }> = data.notes ?? [];
      const qualNote = notes.find((n) => isQualificationNote(n.body));
      if (!qualNote) return null;
      const qaPairs = parseQualificationNote(qualNote.body);
      const urlPair = qaPairs.find((qa) => qa.isUrl);
      const raw = urlPair?.cleanedUrl ?? null;
      if (!raw || !looksLikeUrl(raw)) return "no_website";

      const website = cleanUrl(raw).toLowerCase();
      const domain = normalizeDomain(website);
      const cached = getCategory(domain);
      if (cached) return cached.category;

      // Not cached — trigger categorization
      if (!isAnalyzing(domain)) {
        markAnalyzing(domain);
        fetch("/api/ai/categorize-brand", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ website }),
        })
          .then((r) => r.json())
          .then((d) => {
            if (d.category) setCategory(domain, { category: d.category, reason: d.reason ?? "", analyzedAt: new Date().toISOString() });
          })
          .catch(() => {});
      }
      return null; // not categorized yet — use AI draft for now
    } catch {
      return null;
    }
  }

  const generateDraft = useCallback(async (item: QueueItem) => {
    const convId = item.conversation.id;
    const existing = drafts[convId];
    if (existing?.status === "generating" || existing?.status === "ready") return;

    setDrafts((prev) => ({ ...prev, [convId]: { text: "", status: "generating" } }));

    try {
      // Check brand category — non-DTC leads get the template instead of AI
      const contactId = item.conversation.contact?.id ?? (item.conversation as { contactId?: string }).contactId;
      if (contactId) {
        const category = await resolveBrandCategory(contactId);
        if (category === "no_website") {
          setDrafts((prev) => ({ ...prev, [convId]: { text: NO_WEBSITE_TEMPLATE, status: "ready" } }));
          return;
        }
        if (category && category !== "ecommerce") {
          setDrafts((prev) => ({ ...prev, [convId]: { text: NON_DTC_TEMPLATE, status: "ready" } }));
          return;
        }
      }

      const res = await fetch("/api/ai/draft-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactName: item.conversation.fullName ?? "there",
          pendingMessages: item.pendingMessages.map((m) => m.body).filter(Boolean),
          recentHistory: item.recentHistory,
          channel: item.conversation.type,
        }),
      });
      const data = await res.json();
      setDrafts((prev) => ({
        ...prev,
        [convId]: { text: data.draft ?? "", status: "ready" },
      }));
    } catch {
      setDrafts((prev) => ({ ...prev, [convId]: { text: "", status: "idle" } }));
    }
  }, [drafts]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-generate when current item changes
  useEffect(() => {
    if (!current) return;
    const convId = current.conversation.id;
    const d = drafts[convId];
    if (!d || d.status === "idle") {
      generateDraft(current);
    }
  }, [current?.conversation.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-generate next item draft
  useEffect(() => {
    const next = activeQueue[currentIndex + 1];
    if (!next) return;
    const nextId = next.conversation.id;
    const d = drafts[nextId];
    if (!d || d.status === "idle") {
      // Small delay so current generation takes priority
      const t = setTimeout(() => generateDraft(next), 2000);
      return () => clearTimeout(t);
    }
  }, [currentIndex, activeQueue.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSend() {
    if (!current) return;
    const convId = current.conversation.id;
    const draft = drafts[convId];
    if (!draft?.text.trim()) return;

    setDrafts((prev) => ({ ...prev, [convId]: { ...draft, status: "sending" } }));

    try {
      const res = await fetch(`/api/ghl/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: draft.text.trim(),
          type: current.conversation.type ?? "SMS",
          contactId: current.conversation.contact?.id ?? current.conversation.contactId,
        }),
      });
      if (!res.ok) throw new Error("Failed to send");
      setDrafts((prev) => ({ ...prev, [convId]: { ...draft, status: "sent" } }));
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      // Auto-advance
      if (currentIndex > 0 && currentIndex >= activeQueue.length - 1) {
        setCurrentIndex((i) => Math.max(0, i - 1));
      }
    } catch {
      setDrafts((prev) => ({ ...prev, [convId]: { ...draft, status: "ready" } }));
    }
  }

  function handleSkip() {
    if (!current) return;
    const convId = current.conversation.id;
    setDrafts((prev) => ({
      ...prev,
      [convId]: { text: drafts[convId]?.text ?? "", status: "skipped" },
    }));
    if (currentIndex > 0 && currentIndex >= activeQueue.length - 1) {
      setCurrentIndex((i) => Math.max(0, i - 1));
    }
  }

  function handleEditDraft(text: string) {
    if (!current) return;
    const convId = current.conversation.id;
    setDrafts((prev) => ({
      ...prev,
      [convId]: { text, status: "ready" },
    }));
  }

  async function handleOpenInInbox() {
    if (!current) return;
    const contactId = current.conversation.contact?.id ?? (current.conversation as { contactId?: string }).contactId;
    if (!contactId) return;

    setLoadingOpportunity(true);
    try {
      const res = await fetch(`/api/ghl/contacts/${contactId}/opportunity`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.opportunity) {
        setOpportunityModal({
          opportunity: data.opportunity,
          stageName: data.stageName ?? "Unknown",
          draft: drafts[current.conversation.id]?.text ?? "",
        });
      }
    } catch { /* silently fail */ }
    finally { setLoadingOpportunity(false); }
  }

  function handleRegenerate() {
    if (!current) return;
    const convId = current.conversation.id;
    setDrafts((prev) => ({ ...prev, [convId]: { text: "", status: "idle" } }));
    generateDraft(current);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const isLoading = convLoading || (unreadConvs.length > 0 && !messagesMap);

  return (
    <>
    <div className="bg-card border border-border rounded-[10px] overflow-hidden shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
          Reply Queue
        </h3>
        <div className="flex items-center gap-2">
          {isLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
          {total > 0 && (
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {total} pending
            </span>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
          <RefreshCw className="w-4 h-4 animate-spin mr-2" />
          Checking conversations…
        </div>
      ) : !current ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          All caught up. No unanswered messages.
        </div>
      ) : (
        <div className="p-4 space-y-4">
          {/* Progress indicator */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">
                {current.conversation.fullName || current.conversation.phone || "Unknown"}
              </p>
              <p className="text-xs text-muted-foreground">
                {current.pendingMessages.length} message{current.pendingMessages.length !== 1 ? "s" : ""} since last reply
                {current.pendingMessages[0]?.dateAdded && ` · ${relativeTime(current.pendingMessages[0].dateAdded)}`}
              </p>
            </div>
            <span className="text-xs text-muted-foreground">
              {Math.min(currentIndex + 1, total)} / {total}
            </span>
          </div>

          {/* Prospect's messages */}
          <div className="bg-muted/30 rounded-[8px] p-3 border border-border/60">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
              <MessageSquare className="w-3 h-3" />
              They said:
            </p>
            {current.pendingMessages.map((m, i) => (
              <div key={m.id ?? i}>
                {i > 0 && <div className="border-t border-border/40 my-2" />}
                <p className="text-sm text-foreground leading-relaxed">{m.body}</p>
              </div>
            ))}
          </div>

          {/* AI Draft */}
          {(() => {
            const d = drafts[current.conversation.id];
            const isGenerating = !d || d.status === "generating";
            const text = d?.text ?? "";

            return (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-primary" />
                    {text === NO_WEBSITE_TEMPLATE ? (
                      <span className="text-blue-600 font-semibold">No website — template ready</span>
                    ) : text === NON_DTC_TEMPLATE ? (
                      <span className="text-amber-600 font-semibold">Not a fit — template ready</span>
                    ) : (
                      <>AI Draft{isGenerating && <span className="text-[10px] ml-1">(generating…)</span>}</>
                    )}
                  </p>
                  {!isGenerating && (
                    <button
                      onClick={handleRegenerate}
                      className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Regenerate
                    </button>
                  )}
                </div>

                {isGenerating ? (
                  <div className="h-20 bg-muted/30 rounded-[7px] border border-border/60 flex items-center justify-center">
                    <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <textarea
                    value={text}
                    onChange={(e) => handleEditDraft(e.target.value)}
                    rows={3}
                    className="w-full text-sm px-3 py-2.5 border border-primary/20 bg-primary/5 rounded-[7px] text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                  />
                )}
              </div>
            );
          })()}

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Back — only when not on the first item */}
            {currentIndex > 0 && (
              <button
                onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground border border-border rounded-[7px] hover:bg-muted hover:text-foreground transition-colors"
              >
                <ChevronLeft className="w-3 h-3" />
                Back
              </button>
            )}

            <button
              onClick={handleSkip}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground border border-border rounded-[7px] hover:bg-muted hover:text-foreground transition-colors"
            >
              <SkipForward className="w-3 h-3" />
              Skip
            </button>

            {currentIndex < total - 1 && (
              <button
                onClick={() => setCurrentIndex((i) => Math.min(total - 1, i + 1))}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground border border-border rounded-[7px] hover:bg-muted hover:text-foreground transition-colors"
              >
                <ChevronRight className="w-3 h-3" />
                Next
              </button>
            )}

            {/* View opportunity modal with Messages tab + draft pre-filled */}
            <button
              onClick={handleOpenInInbox}
              disabled={loadingOpportunity}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground border border-border rounded-[7px] hover:bg-muted hover:text-foreground transition-colors"
              title="Open opportunity card with Messages tab"
            >
              {loadingOpportunity
                ? <RefreshCw className="w-3 h-3 animate-spin" />
                : <UserCircle className="w-3 h-3" />
              }
              View Opportunity
            </button>

            <button
              onClick={handleSend}
              disabled={
                !drafts[current.conversation.id]?.text.trim() ||
                drafts[current.conversation.id]?.status === "generating" ||
                drafts[current.conversation.id]?.status === "sending"
              }
              className={cn(
                "ml-auto flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-[7px] transition-colors",
                drafts[current.conversation.id]?.text.trim() &&
                drafts[current.conversation.id]?.status !== "generating" &&
                drafts[current.conversation.id]?.status !== "sending"
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
            >
              {drafts[current.conversation.id]?.status === "sending" ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              {drafts[current.conversation.id]?.status === "sending" ? "Sending…" : "Send Reply"}
            </button>
          </div>
        </div>
      )}
    </div>

    {opportunityModal && (
      <OpportunityModal
        opportunity={opportunityModal.opportunity}
        stageName={opportunityModal.stageName}
        initialDraft={opportunityModal.draft}
        onClose={() => setOpportunityModal(null)}
      />
    )}
    </>
  );
}
