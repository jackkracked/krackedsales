"use client";

import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CreateTaskModal } from "@/components/shared/create-task-modal";
import { CreateDemoModal } from "@/components/shared/create-demo-modal";
import {
  X, Mail, Phone, Globe, MessageSquare, Clock,
  User, TrendingUp, Check, RefreshCw, Edit2, Zap, ListTodo, Layers, ClipboardCheck,
  FileText, MessageCircle, Send,
} from "lucide-react";
import { relativeTime } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
import type { CommentLead } from "./comment-lead-card";

type Tab = "overview" | "comment" | "notes" | "messages";

// ─── Editable field ───────────────────────────────────────────────────────────

function EditableField({
  label,
  value,
  placeholder,
  icon: Icon,
  isEditing,
  onStartEdit,
  onSave,
  onCancel,
}: {
  label: string;
  value?: string | null;
  placeholder: string;
  icon: React.ElementType;
  isEditing: boolean;
  onStartEdit: () => void;
  onSave: (val: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value ?? "");

  // Sync draft when editing starts
  React.useEffect(() => {
    if (isEditing) setDraft(value ?? "");
  }, [isEditing, value]);

  function handleSave() {
    onSave(draft.trim());
  }

  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5 flex items-center gap-1">
        <Icon className="w-3 h-3" />
        {label}
      </p>
      {isEditing ? (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") onCancel();
            }}
            placeholder={placeholder}
            className="flex-1 text-sm px-2.5 py-1.5 border border-primary/30 rounded-[6px] bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
            autoFocus
          />
          <button
            onClick={handleSave}
            className="p-1.5 rounded-[6px] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-[6px] text-muted-foreground hover:bg-muted transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          onClick={onStartEdit}
          className="flex items-center gap-1.5 w-full text-sm text-foreground hover:text-primary transition-colors group text-left"
        >
          <span className={cn("flex-1 truncate", !value && "text-muted-foreground italic")}>
            {value || placeholder}
          </span>
          <Edit2 className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity shrink-0" />
        </button>
      )}
    </div>
  );
}

// ─── Notes tab ────────────────────────────────────────────────────────────────

function NotesTab({
  lead,
  onUpdate,
}: {
  lead: CommentLead;
  onUpdate: (updated: CommentLead) => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");

  const saveMutation = useMutation({
    mutationFn: async (body: string) => {
      const combined = lead.notes
        ? `${lead.notes}\n\n${new Date().toLocaleDateString()}: ${body}`
        : `${new Date().toLocaleDateString()}: ${body}`;
      const res = await fetch(`/api/comment-leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: combined }),
      });
      if (!res.ok) throw new Error("Failed to save note");
      const data = await res.json();
      return data.lead as CommentLead;
    },
    onSuccess: (updated) => {
      onUpdate(updated);
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["comment-leads-inbox"] });
    },
  });

  function handleSend() {
    if (!draft.trim() || saveMutation.isPending) return;
    saveMutation.mutate(draft.trim());
  }

  const notes = lead.notes
    ? lead.notes.split("\n\n").filter(Boolean)
    : [];

  return (
    <div className="flex flex-col gap-4">
      {/* Compose area */}
      <div className="border border-border rounded-[8px] bg-background overflow-hidden focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary transition-colors">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend(); }}
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
            {saveMutation.isPending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            Save
          </button>
        </div>
      </div>

      {saveMutation.isError && (
        <p className="text-xs text-destructive">Failed to save note.</p>
      )}

      {/* Notes list */}
      {notes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
          <MessageSquare className="w-6 h-6 opacity-30" />
          <p className="text-sm">No notes yet — add the first one above</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {notes.map((note, i) => (
            <div key={i} className="bg-muted/30 border border-border/60 rounded-[8px] p-3.5">
              <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{note}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Messages tab ─────────────────────────────────────────────────────────────

type MessageChannel = "platform" | "SMS" | "Live_Chat" | "Email";

function MessagesTab({ lead }: { lead: CommentLead }) {
  const isFacebook = lead.platform === "facebook";
  const postUrl = lead.postId
    ? `https://www.facebook.com/${lead.postId}`
    : null;

  // Available channels — platform always first, GHL channels only if contact details exist
  const channels: Array<{ value: MessageChannel; label: string; disabled?: boolean; disabledReason?: string }> = [
    { value: "platform", label: isFacebook ? "Facebook" : "Instagram" },
    {
      value: "SMS",
      label: "SMS",
      disabled: !lead.phone,
      disabledReason: "Add phone in Overview first",
    },
    {
      value: "Live_Chat",
      label: "Blooio iMessages",
      disabled: !lead.phone,
      disabledReason: "Add phone in Overview first",
    },
    {
      value: "Email",
      label: "Email",
      disabled: !lead.email,
      disabledReason: "Add email in Overview first",
    },
  ];

  const [channel, setChannel] = React.useState<MessageChannel>("platform");
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sentMessages, setSentMessages] = React.useState<Array<{ id: string; text: string; channel: MessageChannel; sentAt: string }>>([]);

  async function handleSend() {
    const trimmed = draft.trim();
    if (!trimmed || sending) return;

    setDraft("");
    setError(null);
    const optimisticId = `opt-${Date.now()}`;
    setSentMessages((prev) => [...prev, { id: optimisticId, text: trimmed, channel, sentAt: new Date().toISOString() }]);
    setSending(true);

    try {
      const res = await fetch(`/api/comment-leads/${lead.id}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, message: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to send");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
      setSentMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setDraft(trimmed); // restore
    } finally {
      setSending(false);
    }
  }

  const activeChannel = channels.find((c) => c.value === channel);

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Comment notification */}
      <div className="flex flex-col items-center gap-1 w-full">
        <div className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-[10px] bg-muted/60 border border-border">
          <div className="w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0" />
          <p className="flex-1 text-xs text-muted-foreground leading-snug">
            Commented{" "}
            <span className="font-semibold text-foreground">
              &ldquo;{lead.keyword}&rdquo;
            </span>{" "}
            on your {isFacebook ? "Facebook" : "Instagram"} post
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
        <span className="text-[10px] text-muted-foreground">{relativeTime(lead.createdAt)}</span>
      </div>

      {/* Sent messages */}
      {sentMessages.length > 0 && (
        <div className="flex flex-col gap-2">
          {sentMessages.map((msg) => (
            <div key={msg.id} className="flex flex-col items-end gap-0.5">
              <div className="max-w-[80%] px-3 py-2 rounded-[8px] text-sm leading-relaxed bg-primary text-primary-foreground">
                {msg.text}
              </div>
              <span className="text-[10px] text-muted-foreground">
                via {msg.channel === "platform" ? (isFacebook ? "Facebook" : "Instagram") : msg.channel} · just now
              </span>
            </div>
          ))}
        </div>
      )}

      {sentMessages.length === 0 && (
        <div className="flex items-center justify-center py-4 text-muted-foreground">
          <p className="text-xs">No messages sent yet</p>
        </div>
      )}

      {/* Reply composer */}
      <div className="border border-border rounded-[8px] overflow-hidden shrink-0 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary transition-colors">
        {/* Channel selector */}
        <div className="flex items-center border-b border-border bg-muted/20 px-1 overflow-x-auto">
          {channels.map(({ value, label, disabled, disabledReason }) => (
            <button
              key={value}
              onClick={() => !disabled && setChannel(value)}
              disabled={disabled}
              title={disabled ? disabledReason : undefined}
              className={cn(
                "px-3 py-2 text-xs font-medium border-b-2 transition-colors shrink-0",
                channel === value && !disabled
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground",
                disabled ? "opacity-35 cursor-not-allowed" : "hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend(); }}
          placeholder={`Reply via ${activeChannel?.label ?? channel}… (⌘↵ to send)`}
          rows={2}
          className="w-full px-3 py-2 text-sm bg-transparent text-foreground placeholder:text-muted-foreground resize-none focus:outline-none"
        />
        <div className="flex items-center justify-between px-3 pb-2">
          <span className="text-xs text-muted-foreground">⌘↵ to send</span>
          <button
            onClick={handleSend}
            disabled={!draft.trim() || sending}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[6px] transition-colors",
              draft.trim() && !sending
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            {sending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            Send
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

interface CommentLeadModalProps {
  lead: CommentLead;
  onClose: () => void;
  onUpdate: (updated: CommentLead) => void;
  initialTab?: Tab;
}

type EditableFieldKey = "name" | "email" | "phone" | "website";

export function CommentLeadModal({ lead, onClose, onUpdate, initialTab }: CommentLeadModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab ?? "overview");
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showCreateDemo, setShowCreateDemo] = useState(false);
  const [editingField, setEditingField] = useState<EditableFieldKey | null>(null);
  const queryClient = useQueryClient();

  const isFacebook = lead.platform === "facebook";
  const platformBadge = isFacebook
    ? { label: "FB", className: "bg-blue-50 text-blue-700" }
    : { label: "IG", className: "bg-pink-50 text-pink-700" };

  const updateMutation = useMutation({
    mutationFn: async (fields: Partial<CommentLead>) => {
      const res = await fetch(`/api/comment-leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) throw new Error("Failed to update");
      const data = await res.json();
      return data.lead as CommentLead;
    },
    onSuccess: (updated) => {
      onUpdate(updated);
      queryClient.invalidateQueries({ queryKey: ["comment-leads-inbox"] });
    },
  });

  const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: "overview", label: "Overview", icon: User },
    { key: "comment", label: "Comment", icon: FileText },
    { key: "notes", label: "Notes", icon: MessageSquare },
    { key: "messages", label: "Messages", icon: MessageCircle },
  ];

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-foreground/25 backdrop-blur-sm" onClick={onClose} />

        <div className="relative bg-card border border-border rounded-[10px] shadow-xl w-full max-w-lg z-10 flex flex-col max-h-[88vh]">
          {/* Header */}
          <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-border shrink-0">
            <div className="min-w-0 flex-1 mr-3">
              <div className="flex items-center gap-2 mb-0.5">
                <h2
                  className="text-base font-semibold text-foreground leading-tight"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {lead.name}
                </h2>
                <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium", platformBadge.className)}>
                  {platformBadge.label}
                </span>
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-medium bg-violet-50 text-violet-700">
                  <MessageSquare className="w-2.5 h-2.5" />
                  Comment
                </span>
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {relativeTime(lead.createdAt)}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-border px-5 shrink-0">
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
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-5 py-5 min-h-0">
            {activeTab === "overview" && (
              <div className="space-y-5">
                {/* Contact Details */}
                <section>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5" />
                    Contact Details
                  </h3>
                  <div className="bg-muted/30 border border-border/60 rounded-[8px] p-4 space-y-3.5">
                    <EditableField
                      label="Name"
                      value={lead.name}
                      placeholder="Full name"
                      icon={User}
                      isEditing={editingField === "name"}
                      onStartEdit={() => setEditingField("name")}
                      onCancel={() => setEditingField(null)}
                      onSave={(v) => { updateMutation.mutate({ name: v }); setEditingField(null); }}
                    />
                    <EditableField
                      label="Email"
                      value={lead.email}
                      placeholder="Click to add email"
                      icon={Mail}
                      isEditing={editingField === "email"}
                      onStartEdit={() => setEditingField("email")}
                      onCancel={() => setEditingField(null)}
                      onSave={(v) => { updateMutation.mutate({ email: v }); setEditingField(null); }}
                    />
                    <EditableField
                      label="Phone"
                      value={lead.phone}
                      placeholder="Click to add phone"
                      icon={Phone}
                      isEditing={editingField === "phone"}
                      onStartEdit={() => setEditingField("phone")}
                      onCancel={() => setEditingField(null)}
                      onSave={(v) => { updateMutation.mutate({ phone: v }); setEditingField(null); }}
                    />
                    <EditableField
                      label="Website"
                      value={lead.website}
                      placeholder="Click to add website"
                      icon={Globe}
                      isEditing={editingField === "website"}
                      onStartEdit={() => setEditingField("website")}
                      onCancel={() => setEditingField(null)}
                      onSave={(v) => { updateMutation.mutate({ website: v }); setEditingField(null); }}
                    />
                  </div>
                </section>

                {/* Lead Details */}
                <section>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5" />
                    Lead Details
                  </h3>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="bg-muted/30 rounded-[8px] p-3 border border-border/60">
                      <p className="text-xs text-muted-foreground mb-0.5">Stage</p>
                      <p className="text-sm font-medium text-foreground">New Lead</p>
                    </div>
                    <div className="bg-muted/30 rounded-[8px] p-3 border border-border/60">
                      <p className="text-xs text-muted-foreground mb-0.5">Source</p>
                      <p className="text-sm font-medium text-foreground">
                        {isFacebook ? "Facebook Comment" : "Instagram Comment"}
                      </p>
                    </div>
                  </div>
                </section>

                {/* Quick Actions */}
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
                      className="flex flex-col items-center gap-1.5 py-3 text-xs font-medium text-foreground border border-border rounded-[7px] hover:bg-muted hover:border-primary/20 transition-colors"
                    >
                      <ClipboardCheck className="w-4 h-4 text-muted-foreground" />
                      Create Audit
                    </button>
                  </div>
                </section>
              </div>
            )}

            {activeTab === "comment" && (
              <div className="space-y-3">
                <div className="bg-muted/30 border border-border/60 rounded-[8px] p-3.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                    Keyword Trigger
                  </p>
                  <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                    "{lead.keyword}"
                  </span>
                </div>
                <div className="bg-muted/30 border border-border/60 rounded-[8px] p-3.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                    Comment Text
                  </p>
                  <p className="text-sm text-foreground italic leading-relaxed">"{lead.commentText}"</p>
                </div>
                <div className="bg-muted/30 border border-border/60 rounded-[8px] p-3.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                    Platform
                  </p>
                  <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", platformBadge.className)}>
                    {isFacebook ? "Facebook" : "Instagram"}
                  </span>
                </div>
                {lead.postId && (
                  <div className="bg-muted/30 border border-border/60 rounded-[8px] p-3.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                      Post ID
                    </p>
                    <p className="text-sm text-foreground font-mono">{lead.postId}</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === "notes" && (
              <NotesTab lead={lead} onUpdate={onUpdate} />
            )}

            {activeTab === "messages" && (
              <MessagesTab lead={lead} />
            )}
          </div>
        </div>
      </div>

      {showCreateTask && (
        <CreateTaskModal
          contactName={lead.name}
          onClose={() => setShowCreateTask(false)}
        />
      )}

      {showCreateDemo && (
        <CreateDemoModal
          contactName={lead.name}
          contactEmail={lead.email ?? undefined}
          contactPhone={lead.phone ?? undefined}
          opportunitySource={isFacebook ? "facebook" : "instagram"}
          onClose={() => setShowCreateDemo(false)}
        />
      )}
    </>
  );
}
