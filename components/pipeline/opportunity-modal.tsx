"use client";

import React, { useState } from "react";
import { CreateTaskModal } from "@/components/shared/create-task-modal";
import { CreateDemoModal } from "@/components/shared/create-demo-modal";
import { CreateAuditModal } from "@/components/shared/create-audit-modal";
import { MessageComposer } from "@/components/shared/message-composer";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  X, Mail, Phone, Tag, Calendar, User, TrendingUp,
  FileText, RefreshCw, Clock, ExternalLink, Edit2, Check, MessageSquare,
  Send, DollarSign, MessageCircle, ListTodo, Layers, ClipboardCheck, Zap,
  ChevronDown, ChevronLeft, ChevronRight, Activity, PhoneCall,
} from "lucide-react";
import { TIER_COLORS } from "@/lib/deal-health";
import type { DealHealthResult } from "@/lib/deal-health";
import { formatDateTime, relativeTime } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
import { cleanUrl, looksLikeUrl, isQualificationNote } from "@/lib/utils/url";
import { useStageHistoryStore, findStageChange } from "@/store/stage-history-store";
import type { GHLOpportunity, GHLMessage } from "@/lib/ghl/types";
import { MessageBody } from "@/components/shared/message-body";
import { ChatBubble, SmartBanner, groupMessages } from "@/components/shared/chat-bubble";
import { ActivityTab } from "@/components/activity/activity-tab";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GHLNote {
  id: string;
  body: string;
  userId?: string;
  dateAdded?: string;
  createdAt?: string;
}

type Tab = "overview" | "qualification" | "notes" | "activity";

const STATUS_STYLES: Record<string, string> = {
  open: "bg-primary/10 text-primary",
  won: "bg-green-50 text-green-700",
  lost: "bg-red-50 text-red-700",
  abandoned: "bg-muted text-muted-foreground",
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">
        {label}
      </p>
      <p className="text-sm text-foreground">{value}</p>
    </div>
  );
}

/** Custom field definition from /api/ghl/custom-fields */
interface FieldDef { name: string; fieldKey: string; folder?: string }

/** Parsed custom field with resolved label */
interface ResolvedCustomField {
  label: string;
  value: string;
  folder?: string;
  isUrl: boolean;
  cleanedUrl?: string;
}

/** Fields to promote to the top of qualification view */
const PROMOTED_KEYWORDS = ["website", "url", "company", "brand", "revenue"];
const SKIP_VALUES = ["", "--", "N/A", "n/a", "null", "undefined"];

function resolveCustomFields(
  rawFields: Array<{ id: string; field_value?: string; value?: string }>,
  fieldDefs: Record<string, FieldDef>
): ResolvedCustomField[] {
  const results: ResolvedCustomField[] = [];

  for (const f of rawFields) {
    const rawValue = f.field_value ?? f.value ?? "";
    if (!rawValue || SKIP_VALUES.includes(rawValue.trim())) continue;

    const def = fieldDefs[f.id];
    const label = def?.name ?? f.id;
    const folder = def?.folder;
    const isUrl = looksLikeUrl(rawValue);

    results.push({
      label,
      value: rawValue,
      folder,
      isUrl,
      cleanedUrl: isUrl ? cleanUrl(rawValue) : undefined,
    });
  }

  // Sort: promoted fields first, then by folder, then alphabetical
  return results.sort((a, b) => {
    const aPromoted = PROMOTED_KEYWORDS.some((k) => a.label.toLowerCase().includes(k));
    const bPromoted = PROMOTED_KEYWORDS.some((k) => b.label.toLowerCase().includes(k));
    if (aPromoted && !bPromoted) return -1;
    if (!aPromoted && bPromoted) return 1;
    const folderCmp = (a.folder ?? "").localeCompare(b.folder ?? "");
    if (folderCmp !== 0) return folderCmp;
    return a.label.localeCompare(b.label);
  });
}

/** Qualification tab — shows custom fields from the contact's GHL profile */
function QualificationTab({
  contactId,
}: {
  contactId: string;
}) {
  // Fetch the contact (includes customFields)
  const { data: contactData, isLoading: contactLoading } = useQuery<{
    contact: {
      customFields?: Array<{ id: string; field_value?: string; value?: string }>;
      customField?: Array<{ id: string; field_value?: string; value?: string }>;
      website?: string;
      companyName?: string;
    } | null;
  }>({
    queryKey: ["ghl-contact", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/ghl/contacts/${contactId}`);
      if (!res.ok) return { contact: null };
      return res.json();
    },
    enabled: !!contactId,
    staleTime: 2 * 60 * 1000,
  });

  // Fetch custom field definitions (ID → name mapping)
  const { data: fieldDefsData, isLoading: defsLoading } = useQuery<{
    fields: Record<string, FieldDef>;
  }>({
    queryKey: ["ghl-custom-field-defs"],
    queryFn: async () => {
      const res = await fetch("/api/ghl/custom-fields");
      if (!res.ok) return { fields: {} };
      return res.json();
    },
    staleTime: 10 * 60 * 1000, // field defs rarely change
  });

  const isLoading = contactLoading || defsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        <RefreshCw className="w-4 h-4 animate-spin mr-2" />
        Loading qualification data…
      </div>
    );
  }

  const contact = contactData?.contact;
  const rawFields = contact?.customFields ?? contact?.customField ?? [];
  const fieldDefs = fieldDefsData?.fields ?? {};
  const resolved = resolveCustomFields(rawFields, fieldDefs);

  if (resolved.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
        <FileText className="w-8 h-8 opacity-30" />
        <p className="text-sm font-medium">No qualification data</p>
        <p className="text-xs text-center max-w-48">
          Custom field data from lead forms will appear here once the contact has submitted them.
        </p>
      </div>
    );
  }

  // Group by folder
  const grouped = new Map<string, ResolvedCustomField[]>();
  for (const field of resolved) {
    const key = field.folder ?? "General";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(field);
  }

  return (
    <div className="space-y-5">
      {Array.from(grouped.entries()).map(([folder, fields]) => (
        <section key={folder}>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2.5 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" />
            {folder}
          </h3>
          <div className="space-y-2">
            {fields.map((field, i) => (
              <div
                key={i}
                className="bg-muted/30 border border-border/60 rounded-[8px] p-3.5"
              >
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 leading-tight">
                  {field.label}
                </p>

                {field.isUrl && field.cleanedUrl ? (
                  <a
                    href={field.cleanedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3 shrink-0" />
                    <span className="truncate">{field.cleanedUrl}</span>
                  </a>
                ) : (
                  <p className="text-sm text-foreground leading-relaxed">{field.value}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Notes tab — show all non-qual notes + compose new note */
function NotesTab({
  contactId,
  notes,
  isLoading,
}: {
  contactId: string;
  notes: GHLNote[];
  isLoading: boolean;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");

  const regularNotes = notes
    .filter((n) => !isQualificationNote(n.body))
    .sort((a, b) => {
      const ta = new Date(a.dateAdded ?? a.createdAt ?? 0).getTime();
      const tb = new Date(b.dateAdded ?? b.createdAt ?? 0).getTime();
      return tb - ta; // newest first
    });

  const saveMutation = useMutation({
    mutationFn: async (body: string) => {
      const res = await fetch(`/api/ghl/contacts/${contactId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) throw new Error("Failed to save note");
      return res.json();
    },
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["notes", contactId] });
    },
  });

  function handleSend() {
    if (!draft.trim() || saveMutation.isPending) return;
    saveMutation.mutate(draft.trim());
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Compose area */}
      <div className="border border-border rounded-[8px] bg-background overflow-hidden focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary transition-colors">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend();
          }}
          placeholder="Add a note… (⌘↵ to save)"
          rows={3}
          className="w-full px-3 py-2.5 text-sm bg-transparent text-foreground placeholder:text-muted-foreground resize-none focus:outline-none"
        />
        <div className="flex items-center justify-between px-3 pb-2.5">
          <span className="text-xs text-muted-foreground">⌘↵ to save</span>
          <button
            onClick={handleSend}
            disabled={!draft.trim() || saveMutation.isPending}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[6px] transition-colors",
              draft.trim() && !saveMutation.isPending
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            {saveMutation.isPending ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <Send className="w-3 h-3" />
            )}
            Save
          </button>
        </div>
      </div>

      {saveMutation.isError && (
        <p className="text-xs text-destructive">Failed to save. Check your GHL connection.</p>
      )}

      {/* Notes list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
          <RefreshCw className="w-4 h-4 animate-spin mr-2" />
          Loading notes…
        </div>
      ) : regularNotes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
          <MessageSquare className="w-6 h-6 opacity-30" />
          <p className="text-sm">No notes yet — add the first one above</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {regularNotes.map((note) => (
            <div
              key={note.id}
              className="bg-muted/30 border border-border/60 rounded-[8px] p-3.5"
            >
              <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                {note.body}
              </p>
              {(note.dateAdded || note.createdAt) && (
                <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {relativeTime(note.dateAdded ?? note.createdAt ?? "")}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Messages tab — fetches conversation thread by contactId */
function MessagesTab({ contactId, stageName, opportunityId, initialDraft, onFieldSaved }: {
  contactId: string;
  stageName: string;
  opportunityId: string;
  initialDraft?: string;
  onFieldSaved?: (field: string, value: string) => void;
}) {
  const stageChanges = useStageHistoryStore((s) => s.changes);
  const [chipSavedKeys, setChipSavedKeys] = useState<Set<string>>(new Set());

  function handleChipOrBannerSaved(field: string, value: string) {
    setChipSavedKeys((prev) => new Set([...prev, `${field}:${value}`]));
    onFieldSaved?.(field, value);
  }

  // Step 1: find the conversation for this contact
  const { data: convData, isLoading: convLoading } = useQuery({
    queryKey: ["contact-conversation", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/ghl/conversations?contactId=${contactId}&limit=1`);
      if (!res.ok) return null;
      const d = await res.json();
      return d?.conversations?.[0] ?? null;
    },
    enabled: !!contactId,
    staleTime: 5 * 60 * 1000,   // conversation ID doesn't change — cache for 5 min
    gcTime: 10 * 60 * 1000,
    retry: 2,
  });

  const conversationId = convData?.id ?? null;

  // Step 2: fetch messages for that conversation
  const { data: msgData, isLoading: msgsLoading, refetch } = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: async () => {
      const res = await fetch(`/api/ghl/conversations/${conversationId}/messages`);
      if (!res.ok) return { messages: [] };
      return res.json();
    },
    enabled: !!conversationId,
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
  });

  // Reverse to oldest-first for natural chat reading order
  const messages: GHLMessage[] = [...(msgData?.messages ?? [])].reverse();
  const isLoading = convLoading || msgsLoading;

  // Auto-scroll to bottom when messages load or change
  const scrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!isLoading && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, isLoading]);

  // Skeleton loading state — shown while finding conversation or loading messages
  if (convLoading) {
    return (
      <div className="flex flex-col gap-3 h-full">
        <div className="flex flex-col gap-2.5 flex-1">
          {[55, 75, 40, 68, 50].map((w, i) => (
            <div key={i} className={cn("flex", i % 2 === 0 ? "justify-end" : "justify-start")}>
              <div
                className="h-9 rounded-[10px] bg-muted/60 animate-pulse"
                style={{ width: `${w}%`, animationDelay: `${i * 80}ms` }}
              />
            </div>
          ))}
        </div>
        <div className="h-[72px] rounded-[10px] bg-muted/40 animate-pulse shrink-0" />
      </div>
    );
  }

  if (!conversationId) {
    return (
      <div className="flex flex-col items-center text-center py-12 gap-2 text-muted-foreground">
        <MessageCircle className="w-8 h-8 opacity-30" />
        <p className="text-sm">No conversation found for this contact</p>
      </div>
    );
  }

  // Precompute grouping for regular (non-activity, non-email) messages
  const regularMessages = messages.filter(
    (m) => m.messageType !== "TYPE_ACTIVITY_OPPORTUNITY" && m.messageType !== "TYPE_EMAIL"
  );
  const groupedRegular = groupMessages(regularMessages);
  const groupedMap = new Map(
    groupedRegular.map((g) => [g.msg.id, g])
  );

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Smart contact enrichment banner */}
      {!msgsLoading && messages.length > 0 && (
        <SmartBanner messages={messages} contactId={contactId} onFieldSaved={handleChipOrBannerSaved} externalSavedKeys={chipSavedKeys} />
      )}

      {/* Message thread */}
      <div ref={scrollRef} className="flex flex-col gap-1.5 flex-1 overflow-y-auto min-h-0">
        {msgsLoading && (
          <div className="flex flex-col gap-2.5">
            {[55, 75, 40, 68].map((w, i) => (
              <div key={i} className={cn("flex", i % 2 === 0 ? "justify-end" : "justify-start")}>
                <div
                  className="h-9 rounded-[10px] bg-muted/60 animate-pulse"
                  style={{ width: `${w}%`, animationDelay: `${i * 80}ms` }}
                />
              </div>
            ))}
          </div>
        )}
        {messages.map((msg) => {
          const isOut = msg.direction === "outbound";
          const isActivity = msg.messageType === "TYPE_ACTIVITY_OPPORTUNITY";
          const isEmail = msg.messageType === "TYPE_EMAIL";

          // ── Activity messages: centered system event ──────────────────
          if (isActivity) {
            const isCreated = msg.body === "Opportunity created";
            const stored = !isCreated && msg.dateAdded
              ? findStageChange(stageChanges, msg.dateAdded, opportunityId)
              : null;
            const isLatestUpdate = !isCreated && msg.id === messages
              .filter(m => m.messageType === "TYPE_ACTIVITY_OPPORTUNITY" && m.body !== "Opportunity created")
              .slice(-1)[0]?.id;

            const label = isCreated
              ? "New Lead"
              : stored
              ? `${stored.fromStage} → ${stored.toStage}`
              : isLatestUpdate
              ? `Moved to ${stageName}`
              : "Stage changed";
            return (
              <div key={msg.id} className="flex justify-center my-0.5">
                <span className="text-[11px] text-muted-foreground/70 bg-muted/50 px-2.5 py-0.5 rounded-full leading-5">
                  {label}{msg.dateAdded ? ` · ${relativeTime(msg.dateAdded)}` : ""}
                </span>
              </div>
            );
          }

          // ── Email messages: compact subject-line card ─────────────────
          if (isEmail) {
            const subject = msg.meta?.email?.subject ?? "Email";
            const emailDir = msg.meta?.email?.direction ?? (isOut ? "outbound" : "inbound");
            const sentByUs = emailDir === "outbound";
            return (
              <div key={msg.id} className={cn("flex my-2", sentByUs ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[78%] flex items-start gap-2 px-3 py-2 rounded-[10px] border",
                  sentByUs
                    ? "bg-primary/8 border-primary/15 text-primary"
                    : "bg-muted/50 border-border/60 text-foreground"
                )}>
                  <Mail className="w-3.5 h-3.5 mt-0.5 shrink-0 opacity-60" />
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                      {sentByUs ? "Email sent" : "Email received"}
                    </p>
                    <p className="text-sm leading-snug">{subject}</p>
                    {msg.dateAdded && (
                      <p className="text-[10px] text-muted-foreground/60 mt-1">
                        {relativeTime(msg.dateAdded)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          }

          // ── Regular SMS / custom message ──────────────────────────────
          const grouped = groupedMap.get(msg.id);
          return (
            <ChatBubble
              key={msg.id}
              body={msg.body ?? ""}
              direction={isOut ? "outbound" : "inbound"}
              dateAdded={msg.dateAdded}
              isGroupedWithPrev={grouped?.isGroupedWithPrev}
              isGroupedWithNext={grouped?.isGroupedWithNext}
              contactId={contactId}
              onFieldSaved={handleChipOrBannerSaved}
            />
          );
        })}
        {messages.length === 0 && !msgsLoading && (
          <div className="flex flex-col items-center justify-center py-10 gap-1.5 text-muted-foreground">
            <MessageCircle className="w-6 h-6 opacity-20" />
            <p className="text-xs">No messages yet</p>
          </div>
        )}
      </div>

      <MessageComposer
        conversationId={conversationId}
        contactId={contactId}
        messages={messages}
        onSent={() => refetch()}
        initialDraft={initialDraft}
      />
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

interface OpportunityModalProps {
  opportunity: GHLOpportunity;
  stageName: string;
  onClose: () => void;
  initialTab?: Tab;
  initialDraft?: string; // pre-fills the Messages tab reply composer
  queue?: GHLOpportunity[];
  queueIndex?: number;
  onNavigate?: (index: number) => void;
}

export function OpportunityModal({
  opportunity,
  stageName,
  onClose,
  initialTab,
  initialDraft,
  queue,
  queueIndex,
  onNavigate,
}: OpportunityModalProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>(initialTab ?? "overview");
  const inQueue = queue && queue.length >= 2 && queueIndex !== undefined;

  const contactId = opportunity.contact?.id ?? "";

  // Fetch full contact data (includes custom fields for website extraction)
  const { data: fullContactData } = useQuery<{ contact: { website?: string; customFields?: Array<{ id: string; field_value?: string; value?: string }> } | null }>({
    queryKey: ["ghl-contact", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/ghl/contacts/${contactId}`);
      if (!res.ok) return { contact: null };
      return res.json();
    },
    enabled: !!contactId,
    staleTime: 2 * 60 * 1000,
  });

  // Extract website from full contact (standard field or custom fields)
  const enrichedWebsite = (() => {
    const c = fullContactData?.contact;
    if (!c) return null;
    if (c.website && looksLikeUrl(c.website)) return c.website;
    const fields = c.customFields ?? [];
    for (const f of fields) {
      const val = f.field_value ?? f.value ?? "";
      if (val && looksLikeUrl(val)) return cleanUrl(val);
    }
    return null;
  })();

  // Local overrides for contact fields saved via enrichment chips (so left panel updates instantly)
  const [contactOverride, setContactOverride] = useState<Record<string, string>>({});
  function handleFieldSaved(field: string, value: string) {
    setContactOverride((prev) => ({ ...prev, [field]: value }));
  }

  // Track whether any enrichment fields were saved (ref so Escape handler always sees latest)
  const hasSavedFieldsRef = React.useRef(false);
  hasSavedFieldsRef.current = Object.keys(contactOverride).length > 0;

  // When modal closes, invalidate contact caches if any fields were saved
  function handleClose() {
    if (hasSavedFieldsRef.current) {
      queryClient.invalidateQueries({ queryKey: ["ghl-contact", contactId] });
      queryClient.invalidateQueries({ queryKey: ["ghl-opportunities"] });
    }
    onClose();
  }

  // Last call + AI insights — fetched lazily on overview tab
  const { data: lastCallData } = useQuery<{
    call: { id: string; startedAt: string; durationSeconds: number | null; transcriptAvailable: boolean } | null;
    insights: {
      wantsText: string | null;
      objectionsText: string | null;
      nextStepsText: string | null;
      redFlagsText: string | null;
      sentimentScore: number | null;
      sentimentLabel: string | null;
    } | null;
  }>({
    queryKey: ["last-call", contactId],
    queryFn: () => fetch(`/api/ghl/contacts/${contactId}/last-call`).then((r) => r.json()),
    enabled: activeTab === "overview" && !!contactId,
    staleTime: 5 * 60 * 1000,
  });

  // Deal health score — fetched lazily on overview tab
  const { data: healthData } = useQuery<DealHealthResult>({
    queryKey: ["health-score", opportunity.id],
    queryFn: async () => {
      const p = new URLSearchParams({
        contactId,
        stageName: stageName,
        updatedAt: opportunity.updatedAt,
        status: opportunity.status,
      });
      const res = await fetch(`/api/ghl/opportunities/${opportunity.id}/health-score?${p}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: activeTab === "overview" && opportunity.status === "open",
    staleTime: 5 * 60 * 1000,
  });

  // Keyboard navigation for queue
  React.useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") { handleClose(); return; }
      if (!inQueue || !onNavigate) return;
      const target = document.activeElement;
      const isTyping = target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (isTyping) return;
      if (e.key === "ArrowLeft"  && queueIndex! > 0)                  onNavigate(queueIndex! - 1);
      if (e.key === "ArrowRight" && queueIndex! < queue!.length - 1)  onNavigate(queueIndex! + 1);
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, inQueue, onNavigate, queueIndex, queue]);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showCreateDemo, setShowCreateDemo] = useState(false);
  const [showCreateAudit, setShowCreateAudit] = useState(false);
  const [healthExpanded, setHealthExpanded] = useState(false);
  const [editingValue, setEditingValue] = useState(false);
  const [valueInput, setValueInput] = useState(
    String(opportunity.monetaryValue && opportunity.monetaryValue > 0 ? opportunity.monetaryValue : 1000)
  );
  const [savingValue, setSavingValue] = useState(false);
  const [localStageName, setLocalStageName] = useState(stageName);
  const [localStageId, setLocalStageId] = useState(opportunity.pipelineStageId);
  const [savingStage, setSavingStage] = useState(false);

  // Fetch all stages for this pipeline (lazy — only needed for stage picker)
  const { data: pipelinesData } = useQuery<{ pipelines: Array<{ id: string; stages: Array<{ id: string; name: string; position?: number }> }> }>({
    queryKey: ["pipelines"],
    queryFn: async () => {
      const res = await fetch("/api/ghl/pipelines");
      if (!res.ok) throw new Error("Failed to fetch pipelines");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const pipelineStages = (
    pipelinesData?.pipelines?.find((p) => p.id === opportunity.pipelineId)?.stages ?? []
  ).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  async function handleStageChange(stageId: string) {
    const stage = pipelineStages.find((s) => s.id === stageId);
    if (!stage || stage.id === localStageId) return;
    setSavingStage(true);
    // Optimistic update — show new stage immediately
    setLocalStageName(stage.name);
    setLocalStageId(stage.id);
    try {
      await fetch(`/api/ghl/opportunities/${opportunity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        pipelineStageId: stage.id,
        stageName: stage.name,
        fromStageName: localStageName,
        opportunityName: name,
      }),
      });
      // Delay refetch — GHL needs a moment to propagate the write before we read back
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      }, 2000);
    } catch {
      // Revert on failure
      setLocalStageName(stageName);
      setLocalStageId(opportunity.pipelineStageId);
    } finally {
      setSavingStage(false);
    }
  }

  const name = opportunity.contact?.name ?? opportunity.name ?? "Unknown";

  const displayValue = opportunity.monetaryValue && opportunity.monetaryValue > 0
    ? opportunity.monetaryValue
    : 1000;

  async function handleSaveValue() {
    const parsed = parseFloat(valueInput.replace(/[$,]/g, ""));
    if (isNaN(parsed)) return;
    setSavingValue(true);
    try {
      await fetch(`/api/ghl/opportunities/${opportunity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monetaryValue: parsed }),
      });
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      setEditingValue(false);
    } finally {
      setSavingValue(false);
    }
  }

  const { data, isLoading } = useQuery<{ notes: GHLNote[] }>({
    queryKey: ["notes", contactId],
    queryFn: async () => {
      if (!contactId) return { notes: [] };
      const res = await fetch(`/api/ghl/contacts/${contactId}/notes`);
      if (!res.ok) return { notes: [] };
      return res.json();
    },
    enabled: !!contactId,
    staleTime: 2 * 60 * 1000,
  });

  const notes = data?.notes ?? [];

  const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: "overview", label: "Overview", icon: User },
    { key: "qualification", label: "Qualification", icon: FileText },
    { key: "notes", label: "Notes", icon: MessageSquare },
    { key: "activity", label: "Activity", icon: Activity },
  ];

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-foreground/25 backdrop-blur-sm"
        onClick={handleClose}
      />

      <div className="relative bg-card border border-border rounded-[10px] shadow-xl w-full max-w-[1080px] z-10 flex flex-col h-[85vh]">
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-border shrink-0">
          <div className="min-w-0 flex-1 mr-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h2
                className="text-base font-semibold text-foreground leading-tight"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {name}
              </h2>
              {/* Stage badge — shown in queue mode since contacts can span different stages */}
              {inQueue && (
                <span className="inline-flex items-center px-2 py-px rounded-full text-[11px] font-medium bg-muted text-muted-foreground border border-border/60 shrink-0">
                  {localStageName}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Created {relativeTime(opportunity.createdAt)}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className={cn(
                "px-2.5 py-0.5 rounded-full text-xs font-medium capitalize",
                STATUS_STYLES[opportunity.status] ??
                  "bg-muted text-muted-foreground"
              )}
            >
              {opportunity.status}
            </span>
            {inQueue && (
              <div className="flex items-center gap-0.5 ml-1">
                <span className="text-xs tabular-nums text-muted-foreground mr-1 select-none">
                  {queueIndex! + 1} / {queue!.length}
                </span>
                <button
                  onClick={() => onNavigate!(queueIndex! - 1)}
                  disabled={queueIndex === 0}
                  className="p-1.5 rounded-[6px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-25 disabled:cursor-default"
                  aria-label="Previous"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onNavigate!(queueIndex! + 1)}
                  disabled={queueIndex === queue!.length - 1}
                  className="p-1.5 rounded-[6px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-25 disabled:cursor-default"
                  aria-label="Next"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
            <button
              onClick={handleClose}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Two-pane body */}
        <div className="flex flex-1 min-h-0">

          {/* Left pane — tabs + scrollable detail content */}
          <div className="w-[40%] flex flex-col min-h-0 border-r border-border">
            <div className="flex items-center justify-evenly border-b border-border shrink-0">
              {TABS.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  aria-label={label}
                  aria-current={activeTab === key ? "true" : undefined}
                  className={cn(
                    "flex items-center justify-center gap-1.5 min-w-0 flex-1 py-2.5 border-b-2 transition-colors",
                    activeTab === key
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {activeTab === key && (
                    <span className="text-[11px] font-medium truncate">{label}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0 flex flex-col">
          {activeTab === "overview" && (
            <div className="space-y-4">
              {/* Contact */}
              <section>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" />
                  Contact Details
                </h3>
                <div className="bg-muted/30 rounded-[8px] p-3 space-y-2.5 border border-border/60">
                  <Field label="Name" value={name} />
                  {(contactOverride.email ?? opportunity.contact?.email) && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Email</p>
                      <a
                        href={`mailto:${contactOverride.email ?? opportunity.contact?.email}`}
                        className="text-sm text-primary hover:underline flex items-center gap-1"
                      >
                        <Mail className="w-3 h-3 shrink-0" />
                        {contactOverride.email ?? opportunity.contact?.email}
                      </a>
                    </div>
                  )}
                  {(contactOverride.phone ?? opportunity.contact?.phone) && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Phone</p>
                      <a
                        href={`tel:${contactOverride.phone ?? opportunity.contact?.phone}`}
                        className="text-sm text-primary hover:underline flex items-center gap-1"
                      >
                        <Phone className="w-3 h-3 shrink-0" />
                        {contactOverride.phone ?? opportunity.contact?.phone}
                      </a>
                    </div>
                  )}
                  {(contactOverride.website ?? enrichedWebsite ?? opportunity.contact?.website) && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Website</p>
                      <a
                        href={contactOverride.website ?? enrichedWebsite ?? opportunity.contact?.website!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary hover:underline flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3 shrink-0" />
                        {(contactOverride.website ?? enrichedWebsite ?? opportunity.contact?.website ?? "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                      </a>
                    </div>
                  )}
                  {opportunity.contact?.companyName && (
                    <Field label="Company" value={opportunity.contact.companyName} />
                  )}
                  {opportunity.contact?.tags && opportunity.contact.tags.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1">
                        <Tag className="w-3 h-3" />
                        Tags
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {opportunity.contact.tags.map((tag) => (
                          <span
                            key={tag}
                            className="px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary font-medium"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* Opportunity details */}
              <section>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5" />
                  Opportunity Details
                </h3>

                <div className="grid grid-cols-2 gap-2.5">
                  {/* Stage — native select styled to match the card */}
                  <div className={cn(
                    "bg-muted/30 rounded-[8px] p-3 border transition-colors",
                    savingStage ? "border-primary/30 bg-primary/5" : "border-border/60"
                  )}>
                    <p className="text-xs text-muted-foreground mb-1">Stage</p>
                    {savingStage ? (
                      <div className="flex items-center gap-1.5 text-sm font-medium text-primary">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        Saving…
                      </div>
                    ) : (
                      <select
                        value={localStageId}
                        onChange={(e) => handleStageChange(e.target.value)}
                        disabled={pipelineStages.length === 0}
                        className="w-full text-sm font-medium text-foreground bg-transparent border-none outline-none cursor-pointer appearance-none truncate disabled:opacity-50"
                      >
                        {pipelineStages.length === 0 && (
                          <option value={localStageId}>{localStageName}</option>
                        )}
                        {pipelineStages.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  {/* Status */}
                  <div className="bg-muted/30 rounded-[8px] p-3 border border-border/60">
                    <p className="text-xs text-muted-foreground mb-0.5">Status</p>
                    <p className="text-sm font-medium text-foreground capitalize">{opportunity.status}</p>
                  </div>
                  {/* Value — editable, defaults to $1,000 */}
                  <div className="bg-muted/30 rounded-[8px] p-3 border border-border/60">
                    <p className="text-xs text-muted-foreground mb-1">Value</p>
                    {editingValue ? (
                      <div className="flex items-center gap-1">
                        <span className="text-sm text-muted-foreground">$</span>
                        <input
                          type="number"
                          value={valueInput}
                          onChange={(e) => setValueInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleSaveValue(); if (e.key === "Escape") setEditingValue(false); }}
                          className="flex-1 w-0 text-sm font-medium bg-transparent text-foreground focus:outline-none"
                          autoFocus
                        />
                        <button onClick={handleSaveValue} disabled={savingValue} className="text-primary">
                          {savingValue ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        </button>
                        <button onClick={() => setEditingValue(false)} className="text-muted-foreground"><X className="w-3 h-3" /></button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditingValue(true); setValueInput(String(displayValue)); }}
                        className="flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-primary transition-colors group w-full"
                      >
                        <DollarSign className="w-3 h-3" />
                        {displayValue.toLocaleString()}
                        <Edit2 className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity ml-auto" />
                      </button>
                    )}
                  </div>
                  {/* Source */}
                  {opportunity.source && (
                    <div className="bg-muted/30 rounded-[8px] p-3 border border-border/60">
                      <p className="text-xs text-muted-foreground mb-0.5">Source</p>
                      <p className="text-sm font-medium text-foreground truncate" title={opportunity.source}>{opportunity.source}</p>
                    </div>
                  )}
                </div>
              </section>

              {/* Deal Health — compact inline, factors expand on click */}
              {opportunity.status === "open" && (
                <section>
                  {!healthData ? (
                    <div className="flex items-center gap-3 px-3 py-2 rounded-[8px] bg-muted/30 border border-border/60">
                      <div className="h-2.5 bg-muted/60 rounded animate-pulse w-16" />
                      <div className="flex-1 h-1.5 bg-muted/40 rounded animate-pulse" />
                      <div className="h-2.5 bg-muted/40 rounded animate-pulse w-10" />
                    </div>
                  ) : (
                    <button
                      onClick={() => setHealthExpanded((v) => !v)}
                      className="w-full text-left"
                    >
                      {/* Single-row summary */}
                      <div className="flex items-center gap-2.5 px-3 py-2 rounded-[8px] bg-muted/30 border border-border/60 hover:border-border transition-colors">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${TIER_COLORS[healthData.tier].dot}`} />
                        <span className={`text-xs font-semibold shrink-0 ${TIER_COLORS[healthData.tier].text}`}>
                          {TIER_COLORS[healthData.tier].label}
                        </span>
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${TIER_COLORS[healthData.tier].dot}`}
                            style={{ width: `${healthData.score}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold tabular-nums text-foreground shrink-0">
                          {healthData.score}<span className="font-normal text-muted-foreground">/100</span>
                        </span>
                        <ChevronDown className={cn("w-3 h-3 text-muted-foreground shrink-0 transition-transform", healthExpanded && "rotate-180")} />
                      </div>
                      {/* Expandable factors */}
                      {healthExpanded && healthData.factors.length > 0 && (
                        <div className="mt-1.5 px-3 py-2 rounded-[7px] bg-muted/20 border border-border/40 space-y-1.5">
                          {healthData.factors.map((f, i) => (
                            <div key={i} className="flex items-center justify-between gap-2">
                              <span className="text-xs text-muted-foreground">{f.label}</span>
                              {f.delta !== 0 && (
                                <span className={`text-xs font-semibold tabular-nums ${f.positive ? "text-emerald-600" : "text-red-500"}`}>
                                  {f.delta > 0 ? `+${f.delta}` : f.delta}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </button>
                  )}
                </section>
              )}

              {/* Last Call */}
              {lastCallData?.call && (
                <section>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <PhoneCall className="w-3.5 h-3.5" />
                    Last Call
                  </h3>
                  <div className="bg-muted/30 rounded-[8px] p-3 border border-border/60 space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {relativeTime(lastCallData.call.startedAt)}
                      </span>
                      {lastCallData.call.durationSeconds && (
                        <span className="text-muted-foreground tabular-nums">
                          {Math.floor(lastCallData.call.durationSeconds / 60)}m {lastCallData.call.durationSeconds % 60}s
                        </span>
                      )}
                    </div>
                    {lastCallData.insights ? (
                      <div className="space-y-2 text-xs">
                        {lastCallData.insights.wantsText && (
                          <div>
                            <p className="font-semibold text-foreground/70 uppercase tracking-wide text-[10px] mb-0.5">Wants</p>
                            <p className="text-foreground">{lastCallData.insights.wantsText}</p>
                          </div>
                        )}
                        {lastCallData.insights.objectionsText && (
                          <div>
                            <p className="font-semibold text-amber-600/80 uppercase tracking-wide text-[10px] mb-0.5">Objections</p>
                            <p className="text-foreground">{lastCallData.insights.objectionsText}</p>
                          </div>
                        )}
                        {lastCallData.insights.nextStepsText && (
                          <div>
                            <p className="font-semibold text-emerald-600/80 uppercase tracking-wide text-[10px] mb-0.5">Next Steps</p>
                            <p className="text-foreground">{lastCallData.insights.nextStepsText}</p>
                          </div>
                        )}
                        {lastCallData.insights.redFlagsText && (
                          <div>
                            <p className="font-semibold text-red-500/80 uppercase tracking-wide text-[10px] mb-0.5">Red Flags</p>
                            <p className="text-foreground">{lastCallData.insights.redFlagsText}</p>
                          </div>
                        )}
                      </div>
                    ) : lastCallData.call.transcriptAvailable ? (
                      <p className="text-xs text-muted-foreground italic">Transcript available — insights generating…</p>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">No transcript available</p>
                    )}
                  </div>
                </section>
              )}

            </div>
          )}

          {activeTab === "qualification" && (
            <QualificationTab contactId={contactId} />
          )}

          {activeTab === "notes" && (
            <NotesTab contactId={contactId} notes={notes} isLoading={isLoading} />
          )}

          {activeTab === "activity" && (
            <ActivityTab entityType="opportunity" entityId={opportunity.id} />
          )}

            {/* Quick actions — inside scroll area, below content */}
            <div className="px-4 py-3 mt-auto">
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setShowCreateTask(true)}
                  className="flex flex-col items-center gap-1 py-2.5 text-xs font-medium text-foreground border border-border rounded-[7px] hover:bg-muted hover:border-primary/20 transition-colors"
                >
                  <ListTodo className="w-3.5 h-3.5 text-muted-foreground" />
                  Task
                </button>
                <button
                  onClick={() => setShowCreateDemo(true)}
                  className="flex flex-col items-center gap-1 py-2.5 text-xs font-medium text-foreground border border-border rounded-[7px] hover:bg-muted hover:border-primary/20 transition-colors"
                >
                  <Layers className="w-3.5 h-3.5 text-muted-foreground" />
                  Demo
                </button>
                <button
                  onClick={() => setShowCreateAudit(true)}
                  className="flex flex-col items-center gap-1 py-2.5 text-xs font-medium text-foreground border border-border rounded-[7px] hover:bg-muted hover:border-primary/20 transition-colors"
                >
                  <ClipboardCheck className="w-3.5 h-3.5 text-muted-foreground" />
                  Audit
                </button>
              </div>
            </div>
            </div>
          </div>

          {/* Right pane — messages always visible */}
          <div className="flex-1 flex flex-col min-h-0 p-4">
            <MessagesTab
              contactId={contactId}
              stageName={localStageName}
              opportunityId={opportunity.id}
              initialDraft={initialDraft}
              onFieldSaved={handleFieldSaved}
            />
          </div>

        </div>

      </div>
    </div>

    {showCreateTask && (
      <CreateTaskModal
        contactId={opportunity.contact?.id}
        contactName={opportunity.contact?.name}
        opportunityId={opportunity.id}
        onClose={() => setShowCreateTask(false)}
      />
    )}

    {showCreateDemo && (
      <CreateDemoModal
        contactId={opportunity.contact?.id}
        contactName={opportunity.contact?.name}
        contactEmail={opportunity.contact?.email}
        contactPhone={opportunity.contact?.phone}
        opportunityId={opportunity.id}
        opportunitySource={opportunity.source}
        onClose={() => setShowCreateDemo(false)}
      />
    )}

    {showCreateAudit && (
      <CreateAuditModal
        contactId={opportunity.contact?.id}
        contactName={opportunity.contact?.name}
        onClose={() => setShowCreateAudit(false)}
      />
    )}
    </>
  );
}
