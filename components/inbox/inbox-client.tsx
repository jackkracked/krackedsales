"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { useConversations, useMessages, useBulkConversationAction, type BulkConversationAction } from "@/lib/hooks/use-conversations";
import { useInboxStore } from "@/store/inbox-store";
import { ConversationList } from "./conversation-list";
import { ContactAvatar, CHANNEL_ICONS, CHANNEL_COLOR } from "./channel-avatar";
import { SelectCheckbox } from "./select-checkbox";
import { BulkActionsMenu } from "./bulk-actions-menu";
import { MessageThread } from "./message-thread";
import { ReplyComposer } from "./reply-composer";
import { LeadDetailsSidebar } from "./lead-details-sidebar";
import { InboxOverview } from "./inbox-overview";
import { MetaConversations } from "./meta-conversations";
import { ErrorBoundary } from "@/components/shared/error-boundary";
import { cn } from "@/lib/utils/cn";
import { Inbox, MessagesSquare, RefreshCw, ArrowLeft, Search, Star, X } from "lucide-react";
import type { ChannelFilter } from "@/lib/hooks/use-conversations";
import { useInboxSearch } from "@/lib/hooks/use-inbox-search";

// Toast copy for each non-delete bulk action.
const BULK_TOAST: Record<Exclude<BulkConversationAction, "delete">, (n: number) => string> = {
  read: (n) => `${n} marked as read`,
  unread: (n) => `${n} marked as unread`,
  star: (n) => (n === 1 ? "Starred" : `${n} starred`),
  unstar: (n) => (n === 1 ? "Star removed" : `${n} unstarred`),
  restore: (n) => `${n} restored`,
};

// The rail includes the unified channels plus a "Comments" view (FB/IG comments — inbox-only,
// never the pipeline; promotion to a lead happens on demo). Channel items use the real brand logo +
// brand colour; All/Comments use the accent when active.
type RailKey = ChannelFilter | "COMMENTS";
const CHANNELS: Array<{ key: RailKey; label: string; icon: React.ElementType; color?: string }> = [
  { key: "ALL", label: "All", icon: Inbox },
  { key: "TYPE_SMS", label: "SMS", icon: CHANNEL_ICONS.TYPE_SMS, color: CHANNEL_COLOR.TYPE_SMS },
  { key: "TYPE_EMAIL", label: "Email", icon: CHANNEL_ICONS.TYPE_EMAIL, color: CHANNEL_COLOR.TYPE_EMAIL },
  { key: "TYPE_INSTAGRAM", label: "Instagram", icon: CHANNEL_ICONS.TYPE_INSTAGRAM, color: CHANNEL_COLOR.TYPE_INSTAGRAM },
  { key: "TYPE_FB", label: "Facebook", icon: CHANNEL_ICONS.TYPE_FB, color: CHANNEL_COLOR.TYPE_FB },
  { key: "TYPE_TIKTOK", label: "TikTok", icon: CHANNEL_ICONS.TYPE_TIKTOK, color: CHANNEL_COLOR.TYPE_TIKTOK },
  { key: "COMMENTS", label: "Comments", icon: MessagesSquare },
];

type StatusFilter = "unread" | "all" | "recent" | "starred";
const STATUSES: Array<{ key: StatusFilter; label: string }> = [
  { key: "unread", label: "Unread" },
  { key: "all", label: "All" },
  { key: "recent", label: "Recent" },
  { key: "starred", label: "Starred" },
];

const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function InboxClient() {
  const [active, setActive] = useState<RailKey>("ALL");
  const [status, setStatus] = useState<StatusFilter>("unread");
  const [search, setSearch] = useState("");
  const [mobileView, setMobileView] = useState<"list" | "thread">("list");

  const { selectedConversationId, setSelectedConversationId } = useInboxStore();

  const isComments = active === "COMMENTS";
  const channel: ChannelFilter = isComments ? "ALL" : active;
  const unreadOnly = status === "unread";
  const { data, isLoading, isFetching, error } = useConversations(channel, unreadOnly);
  const { data: messagesData, isLoading: messagesLoading } = useMessages(selectedConversationId);

  // Searching is GLOBAL, not a filter within the current view. The old code filtered the 100
  // conversations the hook had already narrowed to the active tab, so Gage searching from the
  // Unread tab with nothing unread got "No matches" for a contact that plainly existed.
  const searchResults = useInboxSearch(search);
  const isSearching = search.trim().length >= 2;

  const conversations = useMemo(() => {
    // Server-side search already applies flags, soft-delete and ordering, and deliberately
    // ignores channel/status: a search should reach the whole mirror, not the current tab.
    if (isSearching) return searchResults.data?.conversations ?? [];

    let list = data?.conversations ?? [];
    if (status === "starred") list = list.filter((c) => c.starred);
    if (status === "recent") {
      const cutoff = Date.now() - RECENT_WINDOW_MS;
      list = list.filter((c) => (c.lastMessageDate ? new Date(c.lastMessageDate).getTime() : 0) >= cutoff);
    }
    return [...list].sort(
      (a, b) => new Date(b.lastMessageDate ?? 0).getTime() - new Date(a.lastMessageDate ?? 0).getTime(),
    );
  }, [data?.conversations, status, isSearching, searchResults.data?.conversations]);

  const messages = messagesData?.messages ?? [];
  const selectedConversation = conversations.find((c) => c.id === selectedConversationId)
    ?? (data?.conversations ?? []).find((c) => c.id === selectedConversationId)
    // Opened from a search result that lives outside the live 100-row page: without this,
    // clearing the search would blank the thread you were reading.
    ?? (searchResults.data?.conversations ?? []).find((c) => c.id === selectedConversationId);

  // ── Multi-select + bulk actions ──
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const anchorRef = useRef<string | null>(null);
  const bulk = useBulkConversationAction();

  const visibleIds = useMemo(() => conversations.map((c) => c.id), [conversations]);
  const checkedCount = checkedIds.size;
  const selectionActive = checkedCount > 0;
  const allChecked = visibleIds.length > 0 && visibleIds.every((id) => checkedIds.has(id));
  const someChecked = visibleIds.some((id) => checkedIds.has(id));

  const clearSelection = useCallback(() => {
    setCheckedIds(new Set());
    anchorRef.current = null;
  }, []);

  // Changing channel / status / search changes what's visible — clear selection so a bulk action
  // can never hit a conversation the user can no longer see.
  useEffect(() => {
    clearSelection();
  }, [active, status, search, clearSelection]);

  // Escape clears the selection.
  useEffect(() => {
    if (!selectionActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectionActive, clearSelection]);

  const toggleCheck = useCallback(
    (id: string, e?: React.MouseEvent) => {
      // A shift-click extends a contiguous range from the last anchor. Compute this outside the
      // state updater (no reliance on prev), so the updater stays pure.
      const isRange =
        !!e?.shiftKey &&
        !!anchorRef.current &&
        visibleIds.indexOf(anchorRef.current) !== -1 &&
        visibleIds.indexOf(id) !== -1;
      setCheckedIds((prev) => {
        const next = new Set(prev);
        if (isRange) {
          const a = visibleIds.indexOf(anchorRef.current!);
          const b = visibleIds.indexOf(id);
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i++) next.add(visibleIds[i]);
          return next;
        }
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      // Keep the original anchor while shift-extending; move it only on a normal click.
      if (!isRange) anchorRef.current = id;
    },
    [visibleIds],
  );

  // Prune any selected ids that a background refresh (poll / realtime) removed from view, so
  // "N selected" stays truthful and a bulk action never targets a conversation off-screen.
  useEffect(() => {
    setCheckedIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(visibleIds);
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visible.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [visibleIds]);

  const toggleAll = useCallback(
    (next: boolean) => {
      setCheckedIds(next ? new Set(visibleIds) : new Set());
      anchorRef.current = null;
    },
    [visibleIds],
  );

  function openThread(id: string) {
    setSelectedConversationId(id);
    setMobileView("thread");
  }

  // Row activation: while selecting, a row click toggles its checkbox (GHL-style); otherwise it
  // opens the thread.
  function handleRowActivate(id: string, e?: React.MouseEvent) {
    if (selectionActive) toggleCheck(id, e);
    else openThread(id);
  }

  function handleBulk(action: BulkConversationAction) {
    const ids = [...checkedIds];
    if (ids.length === 0) return;
    // Closing the open thread if it's being deleted keeps the right pane honest.
    if (action === "delete" && selectedConversationId && ids.includes(selectedConversationId)) {
      setSelectedConversationId(null);
      setMobileView("list");
    }
    bulk.mutate(
      { ids, action },
      {
        onError: () => toast.error("Couldn't complete that. Try again."),
        onSuccess: () => {
          if (action === "delete") {
            toast(`${ids.length} conversation${ids.length === 1 ? "" : "s"} deleted`, {
              action: { label: "Undo", onClick: () => bulk.mutate({ ids, action: "restore" }) },
            });
          } else if (action !== "restore") {
            toast(BULK_TOAST[action](ids.length));
          }
        },
      },
    );
    clearSelection();
  }

  const convName = selectedConversation?.fullName ?? selectedConversation?.contact?.name ?? selectedConversation?.phone ?? selectedConversation?.email ?? "Unknown";
  const convChannel = selectedConversation?.lastMessageType ?? selectedConversation?.type;
  const contactId = selectedConversation?.contactId ?? selectedConversation?.contact?.id ?? "";
  // The reply defaults to the conversation's ACTUAL channel (lastMessageType is the reliable one —
  // GHL often stores type as TYPE_PHONE). So an Instagram thread pre-selects Instagram, etc.
  const defaultChannelType =
    !convChannel || convChannel === "TYPE_PHONE" || convChannel === "TYPE_CALL"
      ? "TYPE_SMS"
      : convChannel;

  return (
    <div data-r10n-inbox className="flex h-full overflow-hidden">
      {/* ── Slim channel rail (icons only) ── */}
      <nav data-r10n-channel-rail className="w-[52px] shrink-0 border-r border-border bg-card flex flex-col items-center py-2.5 gap-1 overflow-y-auto">
        {CHANNELS.map(({ key, label, icon: Icon, color }) => {
          const isActive = active === key;
          // Channels carry their brand colour; All/Comments use the accent. Selected = full colour,
          // unselected = dimmed. No filled box.
          const activeColor = color ?? "text-primary";
          const iconColor = isActive
            ? activeColor
            : color
              ? cn(color, "opacity-45 group-hover:opacity-80")
              : "text-muted-foreground group-hover:text-foreground";
          return (
            <button
              key={key}
              data-r10n-channel-tab
              data-active={isActive}
              onClick={() => setActive(key)}
              title={label}
              aria-label={label}
              aria-pressed={isActive}
              className="group flex h-10 w-10 items-center justify-center rounded-[11px] outline-none transition-all duration-150 hover:bg-muted/50 active:scale-[0.94]"
            >
              <Icon className={cn("w-[19px] h-[19px] transition-all", iconColor)} />
            </button>
          );
        })}
      </nav>

      {isComments ? (
        <div className="flex-1 overflow-hidden min-w-0">
          <MetaConversations />
        </div>
      ) : (
      <>
      {/* ── List pane ── */}
      <div className={cn(
        "flex flex-col border-r border-border bg-card w-full lg:w-80 xl:w-96 shrink-0",
        mobileView === "thread" ? "hidden lg:flex" : "flex",
      )}>
        <div data-r10n-list-header className="px-4 pt-3.5 pb-2.5 border-b border-border space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h2 data-r10n-list-title className="text-base font-bold text-foreground tracking-[-0.01em]" style={{ fontFamily: "var(--font-heading)" }}>
              Inbox
            </h2>
            {isFetching && <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations…"
              className="w-full rounded-[9px] border border-border bg-background pl-8 pr-8 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15 transition-all"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Status tiles */}
          <div data-r10n-segmented className="grid grid-cols-4 gap-1 bg-muted/50 rounded-[10px] p-0.5">
            {STATUSES.map((s) => (
              <button
                key={s.key}
                data-r10n-segmented-btn
                data-active={status === s.key}
                onClick={() => setStatus(s.key)}
                className={cn(
                  "py-1 text-xs font-medium rounded-[8px] transition-all",
                  status === s.key ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/[0.04]" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Select-all + bulk actions row (GHL-style multi-select) */}
          {conversations.length > 0 && (
            <div
              data-r10n-select-row
              data-active={selectionActive}
              className={cn(
                "flex items-center gap-2 rounded-[9px] px-1.5 py-1 transition-colors",
                selectionActive && "bg-primary/[0.05]",
              )}
            >
              <SelectCheckbox
                checked={allChecked}
                indeterminate={someChecked && !allChecked}
                onChange={(next) => toggleAll(next)}
                size={17}
                aria-label={allChecked ? "Deselect all" : "Select all"}
              />
              <span className="text-xs font-medium text-muted-foreground select-none">
                {checkedCount > 0 ? `${checkedCount} selected` : "Select all"}
              </span>
              <AnimatePresence>
                {checkedCount > 0 && (
                  <motion.div
                    initial={{ opacity: 0, x: 6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 6 }}
                    transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
                    className="ml-auto flex items-center gap-1"
                  >
                    <BulkActionsMenu count={checkedCount} onAction={handleBulk} disabled={bulk.isPending} />
                    <button
                      onClick={clearSelection}
                      title="Clear selection"
                      aria-label="Clear selection"
                      className="p-1.5 rounded-[7px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors active:scale-[0.95]"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {(isSearching ? searchResults.isLoading : isLoading) ? (
          <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading…
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 px-4">
            <p className="text-xs text-destructive font-mono text-center break-all">{(error as Error).message}</p>
          </div>
        ) : isSearching && searchResults.isError ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 px-6 text-center">
            <p className="text-sm text-destructive">Search failed</p>
            <p className="text-xs text-muted-foreground">
              This is a problem on our side, not an empty result. Nothing has been ruled out.
            </p>
            <button onClick={() => searchResults.refetch()} className="text-xs text-primary hover:underline">
              Try again
            </button>
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground px-6 text-center">
            <p className="text-sm">
              {isSearching
                ? `Nothing matches "${search.trim()}"`
                : status === "unread" ? "No unread conversations"
                : status === "starred" ? "No starred conversations"
                : "No conversations found"}
            </p>
            {isSearching && (
              <p className="text-xs text-muted-foreground/70">
                Searched every conversation, not just this tab.
              </p>
            )}
            {(status === "unread" || status === "starred") && !isSearching && (
              <button onClick={() => setStatus("all")} className="text-xs text-primary hover:underline">Show all</button>
            )}
          </div>
        ) : (
          <>
          {isSearching && searchResults.data?.truncated && (
            <p className="px-3 py-1.5 text-[11px] text-muted-foreground/70 border-b border-border/50">
              Showing the first {conversations.length} matches. Refine the search to narrow it.
            </p>
          )}
          <ConversationList
            conversations={conversations}
            selectedId={selectedConversationId}
            onSelect={handleRowActivate}
            checkedIds={checkedIds}
            onToggleCheck={toggleCheck}
            selectionActive={selectionActive}
          />
          </>
        )}
      </div>

      {/* ── Thread + contact panel ── */}
      <div className={cn("flex-1 flex min-w-0", mobileView === "list" ? "hidden lg:flex" : "flex")}>
        {selectedConversationId && selectedConversation ? (
          <>
            <div className="flex-1 flex flex-col min-w-0 bg-background">
              {/* Thread header */}
              <div data-r10n-thread-header className="flex items-center gap-3 px-5 py-3 border-b border-border bg-card shrink-0">
                <button onClick={() => setMobileView("list")} className="lg:hidden p-1.5 -ml-1 rounded-md text-muted-foreground hover:text-foreground transition-colors">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <ContactAvatar name={convName} channelType={convChannel} size={36} avatarUrl={selectedConversation.avatarUrl} />
                <div className="min-w-0">
                  <h3 data-r10n-thread-name className="text-sm font-bold text-foreground truncate tracking-[-0.01em]" style={{ fontFamily: "var(--font-heading)" }}>
                    {convName}
                  </h3>
                  <p data-r10n-thread-sub className="text-xs text-muted-foreground truncate">
                    {selectedConversation.contact?.email ?? selectedConversation.email ?? selectedConversation.contact?.phone ?? selectedConversation.phone ?? ""}
                  </p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() =>
                      bulk.mutate({
                        ids: [selectedConversation.id],
                        action: selectedConversation.starred ? "unstar" : "star",
                      })
                    }
                    data-r10n-thread-action
                    title={selectedConversation.starred ? "Unstar" : "Star"}
                    className="p-1.5 rounded-[8px] border border-border hover:border-primary/40 hover:bg-primary/[0.03] transition-all active:scale-[0.97]"
                  >
                    <Star className={cn("w-3.5 h-3.5", selectedConversation.starred ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
                  </button>
                </div>
              </div>

              {messagesLoading ? (
                <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading messages…
                </div>
              ) : (
                <ErrorBoundary
                  label="MessageThread"
                  resetKeys={[selectedConversationId]}
                  fallback={(reset) => (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
                      <p className="text-sm text-muted-foreground">This conversation could not be displayed.</p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={reset}
                          className="px-3 py-1.5 text-xs font-semibold text-foreground border border-border rounded-[8px] hover:border-primary/40 hover:bg-primary/[0.03] transition-all active:scale-[0.97]"
                        >
                          Try again
                        </button>
                        <button
                          onClick={() => setMobileView("list")}
                          className="px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors lg:hidden"
                        >
                          Back to inbox
                        </button>
                      </div>
                    </div>
                  )}
                >
                  <MessageThread messages={messages} contactId={contactId} contactName={convName} contactAvatarUrl={selectedConversation.avatarUrl} />
                </ErrorBoundary>
              )}

              <ReplyComposer
                key={selectedConversationId}
                conversationId={selectedConversationId}
                contactId={contactId}
                defaultChannelType={defaultChannelType}
                contactPhone={selectedConversation.contact?.phone ?? selectedConversation.phone ?? undefined}
                contactEmail={selectedConversation.contact?.email ?? selectedConversation.email ?? undefined}
              />
            </div>

            <LeadDetailsSidebar contactId={contactId} contactName={convName} />
          </>
        ) : (
          <InboxOverview conversations={conversations} onSelect={openThread} />
        )}
      </div>
      </>
      )}
    </div>
  );
}
