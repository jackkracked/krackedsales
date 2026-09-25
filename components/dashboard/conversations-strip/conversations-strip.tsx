"use client";

import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, CheckCheck, X, LayoutGrid, Check } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import { ConversationTile } from "./conversation-tile";
import type { QueueItem } from "@/app/api/inbox/queue/route";
import { OpportunityModal } from "@/components/pipeline/opportunity-modal";
import { ContactModal } from "@/components/contacts/contact-modal";
import { CreateDemoModal } from "@/components/shared/create-demo-modal";
import type { GHLOpportunity } from "@/lib/ghl/types";
import type { UnifiedContact } from "@/lib/contacts/types";
import { differenceInHours } from "date-fns";

interface OppState {
  opportunity: GHLOpportunity;
  stageName: string;
  draft: string;
}

interface GhlContactDetail {
  id?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  tags?: string[];
}

/**
 * Build a UnifiedContact for the full ContactModal from a lightweight queue item + the GHL
 * contact detail. Real core fields; safe defaults for the rest (the modal's tabs self-fetch
 * by ghlContactId). Read-only — opening a conversation never creates or mutates anything.
 */
function buildContactFromQueue(item: QueueItem, c: GhlContactDetail, website: string | null): UnifiedContact {
  const platform: UnifiedContact["platform"] =
    item.platform === "instagram" ? "instagram"
      : item.platform === "facebook" ? "facebook"
      : item.channel === "TikTok" ? "tiktok"
      : null;
  return {
    uid: `ghl_${item.contactId}`,
    source: "ghl",
    name: item.contactName || c.fullName || [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unknown",
    email: c.email ?? null,
    phone: c.phone ?? null,
    website: website ?? null,
    platform,
    ghlContactId: item.contactId ?? null,
    opportunityId: null,
    stage: null,
    stageId: null,
    pipelineId: null,
    opportunityStatus: null,
    monetaryValue: null,
    tags: c.tags ?? [],
    commentLeadId: null,
    commentText: null,
    brandCategory: null,
    hasDemo: false,
    hasProposal: false,
    proposalStatus: null,
    hasAudit: false,
    auditStatus: null,
    awaitingReply: true,
    lastChannel: item.channel === "GHL" ? (item.type ?? null) : item.channel,
    daysSinceLastTouch: item.staleDays,
    daysInCurrentStage: null,
    lastActivityAt: item.updatedAt,
    createdAt: item.updatedAt,
    assignedTo: item.assignedToId ?? null,
    dnd: false,
    responseStatus: "awaiting_reply",
    reachableChannels: [],
    autoSequence: false,
    autoSequenceAt: null,
    followupScheduledAt: null,
  };
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

// ─── Select + quick-clear controls (shared by strip tiles and drawer rows) ──────
// Rendered as absolutely-positioned SIBLINGS of the clickable element (never nested
// inside it) so the markup stays valid and each control is independently clickable.

function SelectControls({
  item, selected, onToggle, onMarkRead, variant,
}: {
  item: QueueItem;
  selected: boolean;
  onToggle: () => void;
  onMarkRead: () => void;
  variant: "tile" | "row";
}) {
  return (
    <>
      {selected && <div className="pointer-events-none absolute inset-0 z-10 rounded-[12px] ring-2 ring-primary" />}

      {/* Multi-select checkbox */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        aria-label={selected ? `Deselect ${item.contactName}` : `Select ${item.contactName}`}
        aria-pressed={selected}
        className={cn(
          "absolute z-20 flex h-5 w-5 items-center justify-center rounded-[6px] border shadow-sm transition-all duration-150 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          variant === "tile" ? "left-3 top-3" : "left-2 top-1/2 -translate-y-1/2",
          selected
            ? "border-primary bg-primary text-primary-foreground opacity-100"
            : "border-border bg-card text-transparent opacity-0 group-hover/conv:opacity-100",
        )}
      >
        <Check className="h-3 w-3" strokeWidth={3} />
      </button>

      {/* Single quick-clear */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onMarkRead(); }}
        aria-label={`Mark ${item.contactName} read`}
        title="Mark read"
        className={cn(
          "absolute z-20 flex items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 shadow-sm transition-all duration-150 hover:border-success/60 hover:text-success group-hover/conv:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          variant === "tile" ? "right-3 top-3 h-6 w-6" : "right-3 top-1/2 h-7 w-7 -translate-y-1/2",
        )}
      >
        <CheckCheck className={variant === "tile" ? "h-3.5 w-3.5" : "h-4 w-4"} />
      </button>
    </>
  );
}

// ─── Bottom drawer ────────────────────────────────────────────────────────────

interface InboxDrawerProps {
  items: QueueItem[];
  total: number;
  onReply: (item: QueueItem) => void;
  onClose: () => void;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onMarkRead: (item: QueueItem) => void;
}

function InboxDrawer({ items, total, onReply, onClose, selected, onToggle, onMarkRead }: InboxDrawerProps) {
  const [filter, setFilter] = useState<FilterKey>("all");

  const filtered = items.filter((i) => matchesFilter(i, filter));

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

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
            <h3 className="text-[15px] font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
              Inbox
            </h3>
            <span data-r10n-unread-badge className="text-[10px] font-bold bg-destructive text-destructive-foreground px-2 py-0.5 rounded-full tabular-nums leading-none">
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
        <div className="flex gap-2 px-6 pb-3 overflow-x-auto shrink-0" style={{ scrollbarWidth: "none" }}>
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
                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {label}
                <span className={cn("text-[10px] font-bold tabular-nums", filter === key ? "opacity-60" : "opacity-50")}>
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
                const isSelected = selected.has(item.id);
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
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => { onReply(item); onClose(); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onReply(item); onClose(); }
                      else if (e.key === "e" || e.key === "E") { e.preventDefault(); onMarkRead(item); }
                    }}
                    className={cn(
                      "group/conv relative w-full cursor-pointer text-left pl-9 pr-12 py-3.5 rounded-[12px] transition-all duration-150",
                      "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                      isSelected ? "bg-primary/[0.06]" : isLate ? "bg-destructive/[0.06]" : "",
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {channelLabel}
                      </span>
                      {isLate && (
                        <span className="text-[9px] font-bold text-destructive uppercase tracking-wide">Late</span>
                      )}
                      <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">{timeStr}</span>
                    </div>
                    <p className="text-[13.5px] font-semibold text-foreground truncate leading-snug">{item.contactName}</p>
                    <p className="text-[12px] text-muted-foreground truncate mt-0.5 leading-snug">
                      {item.lastMessage || <span className="italic opacity-50">No preview</span>}
                    </p>
                    <SelectControls
                      item={item}
                      selected={isSelected}
                      onToggle={() => onToggle(item.id)}
                      onMarkRead={() => onMarkRead(item)}
                      variant="row"
                    />
                  </div>
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
  const reduce = useReducedMotion();
  const [contactState, setContactState] = useState<UnifiedContact | null>(null);
  const [demoItem, setDemoItem] = useState<QueueItem | null>(null);
  const [oppState, setOppState] = useState<OppState | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ items: QueueItem[]; total: number }>({
    queryKey: ["inbox-queue-dashboard"],
    // scope=mine → reps see only their assigned conversations; admins see all.
    queryFn: () => fetch("/api/inbox/queue?scope=mine").then((r) => r.json()),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const allItems = data?.items ?? [];
  const items = allItems.filter((i) => !dismissedIds.has(i.id));
  const total = data?.total ?? items.length;

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Mark one or more conversations read/handled. Optimistic (dismiss immediately),
  // persisted server-side (+ best-effort GHL), with an Undo. Reverts on failure.
  const markRead = useCallback(
    async (targets: QueueItem[]) => {
      if (!targets.length) return;
      const ids = targets.map((t) => t.id);
      const payload = targets.map((t) => ({ channel: t.channel, id: t.id }));

      setDismissedIds((prev) => new Set([...prev, ...ids]));
      setSelected(new Set());

      try {
        const res = await fetch("/api/inbox/queue/mark-read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: payload, read: true }),
        });
        if (!res.ok) throw new Error("mark-read failed");
        queryClient.invalidateQueries({ queryKey: ["inbox-queue-dashboard"] });

        toast(targets.length === 1 ? "Marked read" : `${targets.length} marked read`, {
          description: targets.length === 1 ? targets[0].contactName : undefined,
          duration: 5000,
          action: {
            label: "Undo",
            onClick: () => {
              setDismissedIds((prev) => {
                const next = new Set(prev);
                ids.forEach((id) => next.delete(id));
                return next;
              });
              fetch("/api/inbox/queue/mark-read", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ items: payload, read: false }),
              }).finally(() => queryClient.invalidateQueries({ queryKey: ["inbox-queue-dashboard"] }));
            },
          },
        });
      } catch {
        // Revert the optimistic dismiss so nothing is silently lost.
        setDismissedIds((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        });
        toast.error("Couldn't mark read");
      }
    },
    [queryClient],
  );

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
          `/api/ghl/contacts/${item.contactId}/opportunity?name=${encodeURIComponent(item.contactName)}`,
        ).then((r) => r.json());
      } catch {
        oppData = null;
      }

      if (oppData?.opportunity) {
        // Has an opportunity → the gold opportunity modal (with AI-draft composer).
        setLoadingId(null);
        setOppState({ opportunity: oppData.opportunity as OppState["opportunity"], stageName: oppData.stageName ?? "", draft: "" });
        draftPromise.then((draft) => {
          if (draft) setOppState((prev) => (prev ? { ...prev, draft } : prev));
        });
        return;
      }

      // GHL contact with no opportunity → hydrate the full contact modal (no writes on open).
      let cd: { contact?: GhlContactDetail; website?: string | null } | null = null;
      try {
        cd = await fetch(`/api/ghl/contacts/${item.contactId}`).then((r) => r.json());
      } catch {
        cd = null;
      }
      setLoadingId(null);
      if (cd?.contact) {
        setContactState(buildContactFromQueue(item, cd.contact, cd.website ?? null));
        return;
      }
    }

    // No GHL record yet (raw social lead) → promote to a lead via Create Demo.
    setDemoItem(item);
  }

  return (
    <>
      <div data-r10n-card className="bg-card border border-border rounded-[10px] p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <MessageSquare data-r10n-section-icon className="w-4 h-4 text-muted-foreground" />
            <h3
              data-r10n-section-title
              className="text-sm font-semibold text-foreground"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Conversations
            </h3>
            {items.length > 0 && (
              <span data-r10n-count className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
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
              <div key={i} className="h-[170px] w-[210px] shrink-0 rounded-[12px] bg-muted/40 animate-pulse" />
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
            <div className="hidden sm:flex gap-3 overflow-x-auto scroll-smooth pb-2" style={{ scrollbarWidth: "thin" }}>
              <AnimatePresence initial={false}>
                {items.map((item) => (
                  <motion.div
                    key={item.id}
                    className="group/conv relative shrink-0"
                    exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
                    transition={{ duration: reduce ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
                    onKeyDown={(e) => {
                      if ((e.key === "e" || e.key === "E") && !e.metaKey && !e.ctrlKey) {
                        e.preventDefault();
                        markRead([item]);
                      }
                    }}
                  >
                    <ConversationTile item={item} onReply={() => handleReply(item)} isLoading={loadingId === item.id} dimMeta={selected.has(item.id)} />
                    <SelectControls
                      item={item}
                      selected={selected.has(item.id)}
                      onToggle={() => toggleSelect(item.id)}
                      onMarkRead={() => markRead([item])}
                      variant="tile"
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {/* Mobile: 2-column grid */}
            <div className="grid grid-cols-2 gap-2 sm:hidden">
              <AnimatePresence initial={false}>
                {items.map((item) => (
                  <motion.div
                    key={item.id}
                    className="group/conv relative"
                    exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
                    transition={{ duration: reduce ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <ConversationTile item={item} onReply={() => handleReply(item)} isLoading={loadingId === item.id} dimMeta={selected.has(item.id)} />
                    <SelectControls
                      item={item}
                      selected={selected.has(item.id)}
                      onToggle={() => toggleSelect(item.id)}
                      onMarkRead={() => markRead([item])}
                      variant="tile"
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </>
        )}
      </div>

      {/* Floating bulk action bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 20 }}
            transition={{ duration: reduce ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-card px-3 py-2 shadow-xl"
          >
            <span className="pl-2 text-sm font-semibold text-foreground tabular-nums">{selected.size} selected</span>
            <div className="h-5 w-px bg-border" />
            <button
              type="button"
              onClick={() => markRead(items.filter((i) => selected.has(i.id)))}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <CheckCheck className="h-4 w-4" /> Mark read
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Cancel
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* See all drawer */}
      {drawerOpen && (
        <InboxDrawer
          items={items}
          total={total}
          onReply={handleReply}
          onClose={() => setDrawerOpen(false)}
          selected={selected}
          onToggle={toggleSelect}
          onMarkRead={(item) => markRead([item])}
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

      {/* GHL contact with no opportunity → the full contact modal */}
      {contactState && (
        <ContactModal
          contact={contactState}
          onClose={() => {
            setContactState(null);
            queryClient.invalidateQueries({ queryKey: ["inbox-queue-dashboard"] });
          }}
        />
      )}

      {/* Create Demo on whichever conversation the button was pressed on.
          `contactId` is passed through whenever the queue item has one — it is documented as
          "GHL contactId if available" (app/api/inbox/queue/route.ts:34) and this component
          already relies on it to fetch that contact's opportunity and details. Without it the
          modal had no idea who it was for and could not prefill the website or brand.
          Raw social leads (Instagram/TikTok DMs with no GHL record yet) legitimately have none,
          so it stays undefined for those and the platform/participant fields identify them
          instead. */}
      {demoItem && (
        <CreateDemoModal
          contactId={demoItem.contactId}
          contactName={demoItem.contactName}
          opportunitySource={demoItem.platform ?? demoItem.channel}
          platform={
            demoItem.platform === "instagram" || demoItem.platform === "facebook"
              ? demoItem.platform
              : demoItem.channel === "TikTok"
                ? "tiktok"
                : undefined
          }
          participantId={demoItem.recipientId}
          onClose={() => {
            setDemoItem(null);
            queryClient.invalidateQueries({ queryKey: ["inbox-queue-dashboard"] });
          }}
        />
      )}
    </>
  );
}
