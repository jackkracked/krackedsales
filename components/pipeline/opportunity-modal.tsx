"use client";

import React, { useState } from "react";
import { CreateTaskModal } from "@/components/shared/create-task-modal";
import { CreateDemoModal } from "@/components/shared/create-demo-modal";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  X, Mail, Phone, Tag, Calendar, User, TrendingUp,
  FileText, RefreshCw, Clock, ExternalLink, Edit2, Check, MessageSquare,
  Send, DollarSign, MessageCircle, ListTodo, Layers, ClipboardCheck, Zap,
  ChevronDown, ArrowLeft,
} from "lucide-react";
import { formatDateTime, relativeTime } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
import { cleanUrl, parseQualificationNote, isQualificationNote } from "@/lib/utils/url";
import { useStageHistoryStore, findStageChange } from "@/store/stage-history-store";
import type { GHLOpportunity, GHLMessage } from "@/lib/ghl/types";
import { MessageBody } from "@/components/shared/message-body";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GHLNote {
  id: string;
  body: string;
  userId?: string;
  dateAdded?: string;
  createdAt?: string;
}

type Tab = "overview" | "qualification" | "notes" | "messages";

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

/** Qualification tab — parses Q&A from lead form note, URLs are clean + editable */
function QualificationTab({
  contactId,
  notes,
  isLoading,
}: {
  contactId: string;
  notes: GHLNote[];
  isLoading: boolean;
}) {
  const queryClient = useQueryClient();
  const [editingUrl, setEditingUrl] = useState<{ noteId: string; questionIndex: number; value: string } | null>(null);
  const [saving, setSaving] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        <RefreshCw className="w-4 h-4 animate-spin mr-2" />
        Loading qualification data…
      </div>
    );
  }

  // Find the qualification note
  const qualNote = notes.find((n) => isQualificationNote(n.body));

  if (!qualNote) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
        <FileText className="w-8 h-8 opacity-30" />
        <p className="text-sm font-medium">No qualification data</p>
        <p className="text-xs text-center max-w-48">
          Qualification questions from the lead form will appear here once the contact has submitted them.
        </p>
      </div>
    );
  }

  const qaPairs = parseQualificationNote(qualNote.body);

  async function saveUrlEdit() {
    if (!editingUrl) return;
    setSaving(true);
    try {
      // Rebuild note body with corrected URL
      const updated = qualNote!.body.replace(editingUrl.value, cleanUrl(editingUrl.value));
      await fetch(`/api/ghl/contacts/${contactId}/notes/${editingUrl.noteId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: updated }),
      });
      queryClient.invalidateQueries({ queryKey: ["notes", contactId] });
      setEditingUrl(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {qaPairs.map((qa, i) => (
        <div
          key={i}
          className="bg-muted/30 border border-border/60 rounded-[8px] p-3.5"
        >
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 leading-tight">
            {qa.question}
          </p>

          {qa.isUrl ? (
            <div className="space-y-1.5">
              {editingUrl?.questionIndex === i ? (
                /* Edit mode */
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={editingUrl.value}
                    onChange={(e) =>
                      setEditingUrl({ ...editingUrl, value: e.target.value })
                    }
                    className="flex-1 text-sm px-2.5 py-1.5 border border-primary/30 rounded-[6px] bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                    autoFocus
                  />
                  <button
                    onClick={saveUrlEdit}
                    disabled={saving}
                    className="p-1.5 rounded-[6px] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    title="Save"
                  >
                    {saving ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <button
                    onClick={() => setEditingUrl(null)}
                    className="p-1.5 rounded-[6px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                /* Display mode */
                <div className="flex items-center gap-2">
                  {qa.cleanedUrl && (
                    <a
                      href={qa.cleanedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline flex items-center gap-1 flex-1 min-w-0"
                    >
                      <ExternalLink className="w-3 h-3 shrink-0" />
                      <span className="truncate">{qa.cleanedUrl}</span>
                    </a>
                  )}
                  {/* Show original if it had spaces */}
                  {qa.answer !== qa.cleanedUrl?.replace("https://", "") &&
                    qa.answer.includes(" ") && (
                      <span className="text-xs text-muted-foreground">(corrected)</span>
                    )}
                  <button
                    onClick={() =>
                      setEditingUrl({
                        noteId: qualNote!.id,
                        questionIndex: i,
                        value: qa.answer,
                      })
                    }
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
                    title="Edit URL"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-foreground leading-relaxed">{qa.answer}</p>
          )}
        </div>
      ))}

      {qaPairs.length === 0 && (
        <div className="text-center py-8 text-sm text-muted-foreground">
          Could not parse qualification questions from this note.
        </div>
      )}
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
function MessagesTab({ contactId, stageName, opportunityId, initialDraft }: {
  contactId: string;
  stageName: string;
  opportunityId: string;
  initialDraft?: string;
}) {
  const [draft, setDraft] = useState(initialDraft ?? "");
  const stageChanges = useStageHistoryStore((s) => s.changes);

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
    staleTime: 30 * 1000,
    retry: false,
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
    staleTime: 10 * 1000,
    refetchInterval: 15 * 1000,
  });

  const sendMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await fetch(`/api/ghl/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, type: "SMS", contactId }),
      });
      if (!res.ok) throw new Error("Failed to send");
      return res.json();
    },
    onSuccess: () => { setDraft(""); refetch(); },
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

  if (convLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        <RefreshCw className="w-4 h-4 animate-spin mr-2" />
        Loading conversation…
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

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Message thread */}
      <div ref={scrollRef} className="flex flex-col gap-2 flex-1 overflow-y-auto min-h-[200px] max-h-[340px]">
        {isLoading && (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
            <RefreshCw className="w-4 h-4 animate-spin mr-2" />Loading…
          </div>
        )}
        {messages.map((msg) => {
          const isOut = msg.direction === "outbound";
          const isActivity = msg.messageType === "TYPE_ACTIVITY_OPPORTUNITY";
          const isEmail = msg.messageType === "TYPE_EMAIL";

          // ── Activity messages: centered system event ──────────────────
          if (isActivity) {
            const isCreated = msg.body === "Opportunity created";
            // Look up from/to stage from our local store (recorded when user drags in this app)
            const stored = !isCreated && msg.dateAdded
              ? findStageChange(stageChanges, msg.dateAdded, opportunityId)
              : null;
            const isLatestUpdate = !isCreated && msg.id === messages
              .filter(m => m.messageType === "TYPE_ACTIVITY_OPPORTUNITY" && m.body !== "Opportunity created")
              .slice(-1)[0]?.id;

            const label = isCreated
              ? "📥 New Lead"
              : stored
              ? `🔄 ${stored.fromStage} → ${stored.toStage}`
              : isLatestUpdate
              ? `🔄 Moved to ${stageName}`
              : "🔄 Stage changed";
            return (
              <div key={msg.id} className="flex justify-center my-1">
                <span className="text-xs text-muted-foreground bg-muted/60 px-3 py-1 rounded-full">
                  {label} · {msg.dateAdded ? relativeTime(msg.dateAdded) : ""}
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
              <div key={msg.id} className={cn("flex", sentByUs ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[80%] flex items-start gap-2 px-3 py-2 rounded-[8px] border",
                  sentByUs
                    ? "bg-primary/10 border-primary/20 text-primary"
                    : "bg-muted/40 border-border text-foreground"
                )}>
                  <Mail className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
                      {sentByUs ? "Email sent" : "Email received"}
                    </p>
                    <p className="text-sm leading-tight">{subject}</p>
                    {msg.dateAdded && (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {relativeTime(msg.dateAdded)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          }

          // ── Regular SMS / custom message ──────────────────────────────
          return (
            <div key={msg.id} className={cn("flex", isOut ? "justify-end" : "justify-start")}>
              <div className={cn(
                "max-w-[80%] px-3 py-2 rounded-[8px] text-sm leading-relaxed",
                isOut ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
              )}>
                <MessageBody
                  body={msg.body}
                  linkClassName={isOut ? "text-primary-foreground" : "text-primary"}
                />
                {msg.dateAdded && (
                  <p className={cn(
                    "text-[10px] mt-1",
                    isOut ? "text-primary-foreground/60 text-right" : "text-muted-foreground"
                  )}>
                    {relativeTime(msg.dateAdded)}
                  </p>
                )}
              </div>
            </div>
          );
        })}
        {messages.length === 0 && !isLoading && (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            No messages yet
          </div>
        )}
      </div>

      {/* Reply composer */}
      <div className="border border-border rounded-[8px] overflow-hidden shrink-0 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary transition-colors">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendMutation.mutate(draft.trim()); }}
          placeholder="Reply via SMS… (⌘↵ to send)"
          rows={2}
          className="w-full px-3 py-2 text-sm bg-transparent text-foreground placeholder:text-muted-foreground resize-none focus:outline-none"
        />
        <div className="flex items-center justify-between px-3 pb-2">
          <span className="text-xs text-muted-foreground">⌘↵ to send</span>
          <button
            onClick={() => sendMutation.mutate(draft.trim())}
            disabled={!draft.trim() || sendMutation.isPending}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[6px] transition-colors",
              draft.trim() && !sendMutation.isPending
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            {sendMutation.isPending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            Send
          </button>
        </div>
      </div>
      {sendMutation.isError && (
        <p className="text-xs text-destructive">Failed to send. Check your GHL connection.</p>
      )}
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
}

export function OpportunityModal({
  opportunity,
  stageName,
  onClose,
  initialTab,
  initialDraft,
}: OpportunityModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab ?? "overview");
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showCreateDemo, setShowCreateDemo] = useState(false);
  const [editingValue, setEditingValue] = useState(false);
  const [valueInput, setValueInput] = useState(
    String(opportunity.monetaryValue && opportunity.monetaryValue > 0 ? opportunity.monetaryValue : 1000)
  );
  const [savingValue, setSavingValue] = useState(false);
  const [localStageName, setLocalStageName] = useState(stageName);
  const [localStageId, setLocalStageId] = useState(opportunity.pipelineStageId);
  const [savingStage, setSavingStage] = useState(false);
  const queryClient = useQueryClient();

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
        body: JSON.stringify({ pipelineStageId: stage.id }),
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
  const contactId = opportunity.contact?.id ?? "";

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
    { key: "messages", label: "Messages", icon: MessageCircle },
  ];

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-foreground/25 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative bg-card border border-border rounded-[10px] shadow-xl w-full max-w-lg z-10 flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-border shrink-0">
          <div className="min-w-0 flex-1 mr-3">
            <h2
              className="text-base font-semibold text-foreground leading-tight"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {name}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Created {relativeTime(opportunity.createdAt)}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className={cn(
                "px-2.5 py-0.5 rounded-full text-xs font-medium capitalize",
                STATUS_STYLES[opportunity.status] ??
                  "bg-muted text-muted-foreground"
              )}
            >
              {opportunity.status}
            </span>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center border-b border-border px-5 shrink-0">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={cn(
                "flex items-center gap-1.5 px-1 py-2.5 mr-5 text-sm font-medium border-b-2 transition-colors",
                activeTab === key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}

          {/* Stage picker — only visible on Messages tab, uses empty right-side space */}
          {activeTab === "messages" && (
            <div className="ml-auto flex items-center gap-2 pb-px">
              {savingStage ? (
                <div className="flex items-center gap-1.5 text-xs text-primary">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  <span>Saving…</span>
                </div>
              ) : (
                <div className="relative flex items-center">
                  <select
                    value={localStageId}
                    onChange={(e) => handleStageChange(e.target.value)}
                    disabled={pipelineStages.length === 0}
                    className="text-xs font-medium text-muted-foreground hover:text-foreground bg-transparent border-none pl-0 pr-5 py-2.5 appearance-none cursor-pointer focus:outline-none disabled:opacity-50 max-w-[140px] truncate"
                  >
                    {pipelineStages.length === 0 && <option value={localStageId}>{localStageName}</option>}
                    {pipelineStages.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-0 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-5 min-h-0">
          {activeTab === "overview" && (
            <div className="space-y-5">
              {/* Contact */}
              <section>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" />
                  Contact Details
                </h3>
                <div className="bg-muted/30 rounded-[8px] p-4 space-y-3 border border-border/60">
                  <Field label="Name" value={name} />
                  {opportunity.contact?.email && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Email</p>
                      <a
                        href={`mailto:${opportunity.contact.email}`}
                        className="text-sm text-primary hover:underline flex items-center gap-1"
                      >
                        <Mail className="w-3 h-3 shrink-0" />
                        {opportunity.contact.email}
                      </a>
                    </div>
                  )}
                  {opportunity.contact?.phone && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Phone</p>
                      <a
                        href={`tel:${opportunity.contact.phone}`}
                        className="text-sm text-primary hover:underline flex items-center gap-1"
                      >
                        <Phone className="w-3 h-3 shrink-0" />
                        {opportunity.contact.phone}
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

              {/* Quick actions */}
              <section>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5" />
                  Quick Actions
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setShowCreateTask(true)}
                    className="flex flex-col items-center gap-1.5 py-3 text-xs font-medium text-foreground border border-border rounded-[7px] hover:bg-muted hover:border-primary/20 transition-colors"
                  >
                    <ListTodo className="w-4 h-4 text-muted-foreground" />
                    Create Task
                  </button>
                  <button
                    onClick={() => setShowCreateDemo(true)}
                    className="flex flex-col items-center gap-1.5 py-3 text-xs font-medium text-foreground border border-border rounded-[7px] hover:bg-muted hover:border-primary/20 transition-colors"
                  >
                    <Layers className="w-4 h-4 text-muted-foreground" />
                    Create Demo
                  </button>
                  <button
                    onClick={() => {}}
                    className="flex flex-col items-center gap-1.5 py-3 text-xs font-medium text-foreground border border-border rounded-[7px] hover:bg-muted hover:border-primary/20 transition-colors"
                  >
                    <ClipboardCheck className="w-4 h-4 text-muted-foreground" />
                    Create Audit
                  </button>
                </div>
              </section>
            </div>
          )}

          {activeTab === "qualification" && (
            <QualificationTab contactId={contactId} notes={notes} isLoading={isLoading} />
          )}

          {activeTab === "notes" && (
            <NotesTab contactId={contactId} notes={notes} isLoading={isLoading} />
          )}

          {activeTab === "messages" && (
            <MessagesTab
              contactId={contactId}
              stageName={localStageName}
              opportunityId={opportunity.id}
              initialDraft={initialDraft}
            />
          )}
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
    </>
  );
}
