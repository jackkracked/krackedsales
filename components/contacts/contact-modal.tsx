"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  X, ExternalLink, User, Clock, MessageCircle, ClipboardList, StickyNote,
  RefreshCw, Send, Plus, Pencil, Trash2, Check, Globe, Phone, Mail,
  Tag, TrendingUp, GitMerge, Calendar, Star, AlertCircle, ArrowDown,
  ArrowUp, FileText, MessageSquare, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatDate, formatDateTime, relativeTime } from "@/lib/utils/date";
import { parseQualificationNote, isQualificationNote, looksLikeUrl, cleanUrl } from "@/lib/utils/url";
import type { UnifiedContact, TimelineEvent } from "@/lib/contacts/types";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface CustomField { id: string; contactUid: string; fieldName: string; fieldValue: string; createdAt: string; }
interface GHLNote { id: string; body: string; dateAdded?: string; createdAt?: string; }
interface GHLMessage { id: string; emailMessageId?: string; body?: string; direction?: "inbound" | "outbound"; messageType?: string; dateAdded: string; meta?: { email?: { subject?: string; messageIds?: string[] } }; }

type RightTab = "timeline" | "messages" | "notes" | "qualification";

const RIGHT_TABS: Array<{ id: RightTab; label: string; icon: React.ElementType; ghlOnly?: boolean }> = [
  { id: "timeline",      label: "Timeline",      icon: Clock },
  { id: "messages",      label: "Messages",      icon: MessageCircle, ghlOnly: true },
  { id: "notes",         label: "Notes",         icon: StickyNote,    ghlOnly: true },
  { id: "qualification", label: "Qualification", icon: ClipboardList, ghlOnly: true },
];

const CAT_CONFIG: Record<string, { label: string; className: string }> = {
  ecommerce: { label: "DTC",     className: "bg-emerald-100 text-emerald-700" },
  service:   { label: "Service", className: "bg-amber-100 text-amber-700" },
  local:     { label: "Local",   className: "bg-sky-100 text-sky-700" },
  b2b:       { label: "B2B",     className: "bg-violet-100 text-violet-700" },
  other:     { label: "Other",   className: "bg-muted text-muted-foreground" },
};

function avatarColor(name: string): string {
  const p = ["bg-violet-100 text-violet-700","bg-sky-100 text-sky-700","bg-amber-100 text-amber-700","bg-rose-100 text-rose-700","bg-emerald-100 text-emerald-700","bg-orange-100 text-orange-700","bg-indigo-100 text-indigo-700","bg-teal-100 text-teal-700"];
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return p[Math.abs(h) % p.length];
}

// ─── Left panel: contact info + pipeline + tags + custom fields ────────────────

function LeftPanel({ contact }: { contact: UnifiedContact }) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [addingField, setAddingField] = useState(false);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const queryClient = useQueryClient();

  // Fetch website from qualification note for GHL contacts
  const { data: notesData } = useQuery<{ notes: GHLNote[] }>({
    queryKey: ["contact-notes-left", contact.ghlContactId],
    queryFn: () => fetch(`/api/ghl/contacts/${contact.ghlContactId}/notes`).then((r) => r.json()),
    enabled: !!contact.ghlContactId && !contact.website,
    staleTime: 5 * 60 * 1000,
  });

  const websiteFromNote = (() => {
    const qualNote = notesData?.notes?.find((n) => isQualificationNote(n.body));
    if (!qualNote) return null;
    const pairs = parseQualificationNote(qualNote.body);
    const urlPair = pairs.find((qa) => qa.isUrl);
    return urlPair?.cleanedUrl ?? null;
  })();

  const website = contact.website ?? websiteFromNote;
  const websiteDisplay = website ? website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") : null;

  const { data: fieldsData } = useQuery<{ fields: CustomField[] }>({
    queryKey: ["custom-fields", contact.uid],
    queryFn: () => fetch(`/api/contacts/${contact.uid}/custom-fields`).then((r) => r.json()),
    staleTime: 60 * 1000,
  });
  const fields = fieldsData?.fields ?? [];

  const addMutation = useMutation({
    mutationFn: ({ fieldName, fieldValue }: { fieldName: string; fieldValue: string }) =>
      fetch(`/api/contacts/${contact.uid}/custom-fields`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fieldName, fieldValue }) }).then((r) => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["custom-fields", contact.uid] }); setNewName(""); setNewValue(""); setAddingField(false); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ fieldId, fieldValue }: { fieldId: string; fieldValue: string }) =>
      fetch(`/api/contacts/${contact.uid}/custom-fields`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fieldId, fieldValue }) }).then((r) => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["custom-fields", contact.uid] }); setEditingField(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: (fieldId: string) =>
      fetch(`/api/contacts/${contact.uid}/custom-fields`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fieldId }) }).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["custom-fields", contact.uid] }),
  });

  return (
    <div className="w-[248px] shrink-0 border-r border-border overflow-y-auto bg-muted/20">
      <div className="p-4 space-y-5">

        {/* Contact Info */}
        <section>
          <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-[0.1em] mb-2.5">Contact</p>
          <div className="space-y-2">
            {contact.email && (
              <a href={`mailto:${contact.email}`} className="flex items-center gap-2 text-xs text-foreground/80 hover:text-primary transition-colors group">
                <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="truncate">{contact.email}</span>
              </a>
            )}
            {contact.phone && (
              <a href={`tel:${contact.phone}`} className="flex items-center gap-2 text-xs text-foreground/80 hover:text-primary transition-colors">
                <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span>{contact.phone}</span>
              </a>
            )}
            {websiteDisplay ? (
              <a href={website!} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs text-primary hover:underline">
                <Globe className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{websiteDisplay}</span>
                <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-50" />
              </a>
            ) : contact.ghlContactId && !notesData ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground/50">
                <Globe className="w-3.5 h-3.5 shrink-0" />
                <span className="italic">Loading…</span>
              </div>
            ) : null}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="w-3.5 h-3.5 shrink-0" />
              <span>Added {formatDate(contact.createdAt)}</span>
            </div>
            {contact.brandCategory && (
              <div className="flex items-start gap-2">
                <Tag className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <span className={cn("inline-flex items-center px-1.5 py-px rounded-full text-[11px] font-medium", CAT_CONFIG[contact.brandCategory]?.className)}>
                  {CAT_CONFIG[contact.brandCategory]?.label ?? contact.brandCategory}
                </span>
              </div>
            )}
          </div>
        </section>

        {/* Pipeline */}
        {contact.stage && (
          <section>
            <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-[0.1em] mb-2.5">Pipeline</p>
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <GitMerge className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <span className="text-xs text-foreground/80 leading-snug">{contact.stage}</span>
              </div>
              {contact.opportunityStatus && (
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className={cn("text-xs font-medium", {
                    open: "text-primary", won: "text-emerald-600", lost: "text-rose-500", abandoned: "text-muted-foreground",
                  }[contact.opportunityStatus])}>
                    {contact.opportunityStatus.charAt(0).toUpperCase() + contact.opportunityStatus.slice(1)}
                  </span>
                </div>
              )}
              {contact.monetaryValue != null && contact.monetaryValue > 0 && (
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs text-foreground/80">${contact.monetaryValue.toLocaleString()}</span>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Comment context */}
        {contact.commentText && (
          <section>
            <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-[0.1em] mb-2">Comment</p>
            <p className="text-xs text-foreground/70 italic bg-muted/40 rounded-[6px] px-2.5 py-2 border border-border/50">"{contact.commentText}"</p>
          </section>
        )}

        {/* Tags */}
        {contact.tags.length > 0 && (
          <section>
            <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-[0.1em] mb-2">Tags</p>
            <div className="flex flex-wrap gap-1">
              {contact.tags.map((t) => (
                <span key={t} className="text-[11px] px-2 py-px rounded-full bg-muted border border-border/60 text-foreground/70">{t}</span>
              ))}
            </div>
          </section>
        )}

        {/* Custom fields */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-[0.1em]">Custom Fields</p>
            <button onClick={() => setAddingField(true)} className="text-[11px] text-primary hover:underline flex items-center gap-0.5">
              <Plus className="w-3 h-3" />Add
            </button>
          </div>
          <div className="space-y-1">
            {fields.map((f) => (
              <div key={f.id} className="group flex items-start gap-1.5 py-0.5">
                {editingField === f.id ? (
                  <>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-muted-foreground/60 mb-0.5">{f.fieldName}</p>
                      <input autoFocus value={editValue} onChange={(e) => setEditValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") updateMutation.mutate({ fieldId: f.id, fieldValue: editValue }); if (e.key === "Escape") setEditingField(null); }}
                        className="w-full text-xs px-1.5 py-0.5 border border-primary/40 rounded-[4px] bg-card focus:outline-none" />
                    </div>
                    <button onClick={() => updateMutation.mutate({ fieldId: f.id, fieldValue: editValue })} className="p-0.5 text-primary mt-3.5"><Check className="w-3 h-3" /></button>
                    <button onClick={() => setEditingField(null)} className="p-0.5 text-muted-foreground mt-3.5"><X className="w-3 h-3" /></button>
                  </>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-muted-foreground/60">{f.fieldName}</p>
                      <p className="text-xs text-foreground/80 truncate">{f.fieldValue || <span className="italic text-muted-foreground/40">—</span>}</p>
                    </div>
                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
                      <button onClick={() => { setEditingField(f.id); setEditValue(f.fieldValue ?? ""); }} className="p-0.5 text-muted-foreground hover:text-foreground"><Pencil className="w-3 h-3" /></button>
                      <button onClick={() => deleteMutation.mutate(f.id)} className="p-0.5 text-muted-foreground hover:text-rose-500"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          {addingField && (
            <div className="mt-2 space-y-1.5">
              <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Field name" className="w-full text-xs px-2 py-1 border border-border rounded-[5px] bg-card focus:outline-none focus:border-primary/40" />
              <div className="flex gap-1">
                <input value={newValue} onChange={(e) => setNewValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addMutation.mutate({ fieldName: newName, fieldValue: newValue }); if (e.key === "Escape") setAddingField(false); }}
                  placeholder="Value" className="flex-1 text-xs px-2 py-1 border border-border rounded-[5px] bg-card focus:outline-none focus:border-primary/40" />
                <button onClick={() => addMutation.mutate({ fieldName: newName, fieldValue: newValue })} disabled={!newName.trim()} className="px-2 py-1 text-xs bg-primary text-white rounded-[5px] disabled:opacity-30">Save</button>
                <button onClick={() => setAddingField(false)} className="px-2 py-1 text-xs border border-border rounded-[5px] text-muted-foreground hover:bg-muted">Cancel</button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ─── Timeline icon ─────────────────────────────────────────────────────────────

function TLIcon({ type }: { type: TimelineEvent["type"] }) {
  const cls = "w-3.5 h-3.5";
  const map: Record<TimelineEvent["type"], React.ReactNode> = {
    lead_captured:    <Star        className={cn(cls, "text-amber-500")} />,
    stage_change:     <GitMerge   className={cn(cls, "text-primary")} />,
    message_sent:     <ArrowUp    className={cn(cls, "text-muted-foreground")} />,
    message_received: <ArrowDown  className={cn(cls, "text-primary")} />,
    note_added:       <FileText   className={cn(cls, "text-slate-500")} />,
    demo_created:     <Calendar   className={cn(cls, "text-emerald-500")} />,
    email_sent:       <Mail       className={cn(cls, "text-muted-foreground")} />,
    email_received:   <Mail       className={cn(cls, "text-primary")} />,
    contacted:        <MessageSquare className={cn(cls, "text-emerald-500")} />,
  };
  return <>{map[type] ?? <AlertCircle className={cn(cls, "text-muted-foreground")} />}</>;
}

// ─── Right tabs ────────────────────────────────────────────────────────────────

function TimelineTab({ contact }: { contact: UnifiedContact }) {
  // Pass the contact's known createdAt as fallback for lead_captured timestamp
  const createdAt = encodeURIComponent(contact.createdAt);
  const { data, isLoading } = useQuery<{ events: TimelineEvent[] }>({
    queryKey: ["contact-timeline", contact.uid],
    queryFn: () => fetch(`/api/contacts/${contact.uid}/timeline?createdAt=${createdAt}`).then((r) => r.json()),
    staleTime: 2 * 60 * 1000,
  });

  // Show oldest-first (chronological) — do NOT reverse
  const events = data?.events ?? [];

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex gap-3">
            <div className="w-6 h-6 rounded-full bg-muted animate-pulse shrink-0" style={{ animationDelay: `${i * 60}ms` }} />
            <div className="flex-1 space-y-1.5 pt-0.5">
              <div className="h-2.5 bg-muted rounded-full animate-pulse w-36" style={{ animationDelay: `${i * 60}ms` }} />
              <div className="h-2 bg-muted/60 rounded-full animate-pulse w-24" style={{ animationDelay: `${i * 60}ms` }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!events.length) {
    return <EmptyState icon={Clock} message="No activity yet" />;
  }

  return (
    <div className="p-4 overflow-y-auto flex-1">
      <div className="relative pl-8">
        <div className="absolute left-3 top-3 bottom-3 w-px bg-border/50" />
        <div className="space-y-5">
          {events.map((ev) => (
            <div key={ev.id} className="relative">
              <div className="absolute -left-8 top-0 w-6 h-6 rounded-full bg-card border border-border flex items-center justify-center">
                <TLIcon type={ev.type} />
              </div>
              <div>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <p className="text-sm font-medium text-foreground">{ev.title}</p>
                  <span className="text-[11px] text-muted-foreground shrink-0">{relativeTime(ev.occurredAt)}</span>
                </div>
                {ev.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-3 leading-relaxed">{ev.body}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Email body parser ─────────────────────────────────────────────────────────
// GHL stores outbound automation emails as plain text with [url] bracket patterns.
// Convert to renderable HTML: image URLs → <img>, other URLs → <a>, text → <p>.

function ghlBodyToHtml(body: string): string {
  const IMAGE_EXT = /\.(jpe?g|png|gif|webp|svg)(\?|$)/i;
  const lines = body.split(/\n/);
  const parts: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { parts.push("<br/>"); continue; }

    const processed = line.replace(/\[([^\]]+)\]/g, (_, url) => {
      const trimmed = url.trim();
      if (!/^https?:\/\//i.test(trimmed)) return `[${trimmed}]`;
      if (IMAGE_EXT.test(trimmed) || trimmed.includes("/media/")) {
        return `<img src="${trimmed}" alt="" style="max-width:100%;height:auto;display:block;margin:8px 0;" />`;
      }
      return `<a href="${trimmed}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;">${trimmed}</a>`;
    });

    if (/^<img\s/i.test(processed.trim())) {
      parts.push(processed);
    } else {
      parts.push(`<p style="margin:0 0 6px;font-size:14px;line-height:1.55;">${processed}</p>`);
    }
  }

  return `<html><body style="font-family:sans-serif;padding:12px 16px;margin:0;color:#111;">${parts.join("")}</body></html>`;
}

// ─── Email card (collapsible email renderer) ───────────────────────────────────

function EmailCard({ message }: { message: GHLMessage }) {
  const [open, setOpen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const inbound = message.direction === "inbound";
  const subject = message.meta?.email?.subject ?? "(no subject)";

  // Step 1: if emailMessageId isn't on the message directly, fetch the single
  // message record — GHL includes emailMessageId there even when the list doesn't.
  const directEmailMsgId = message.emailMessageId ?? message.meta?.email?.messageIds?.[0];

  const { data: singleMsg } = useQuery<Record<string, unknown>>({
    queryKey: ["msg-single", message.id],
    queryFn: () => fetch(`/api/ghl/conversations/messages/${message.id}`).then((r) => r.json()),
    enabled: open && !directEmailMsgId,
    staleTime: 10 * 60 * 1000,
  });

  const emailMsgId: string | undefined =
    directEmailMsgId ??
    (singleMsg?.emailMessageId as string | undefined) ??
    (singleMsg?.meta as Record<string, unknown> | undefined)?.email
      ? ((singleMsg?.meta as Record<string, Record<string, unknown>>)?.email?.messageIds as string[])?.[0]
      : undefined;

  // Step 2: fetch full email HTML using the email-layer ID
  const { data: emailDetail, isLoading: detailLoading } = useQuery<Record<string, unknown>>({
    queryKey: ["email-detail", emailMsgId],
    queryFn: () => fetch(`/api/ghl/conversations/messages/email/${emailMsgId}`).then((r) => r.json()),
    enabled: open && !!emailMsgId,
    staleTime: 10 * 60 * 1000,
  });

  // GHL email detail: HTML is in `body`. Also try html / htmlBody as fallbacks.
  const detailHtml: string | null =
    (emailDetail && !emailDetail.error)
      ? ((emailDetail.body as string) ??
         (emailDetail.html as string) ??
         (emailDetail.htmlBody as string) ??
         null)
      : null;

  // Only use detailHtml if it actually contains HTML tags
  const detailHtmlIsHtml = detailHtml ? /<[a-z][\s\S]*>/i.test(detailHtml) : false;

  // Fall back to parsing the bracket-format body
  const rawBody = message.body ?? "";
  const isRawHtml = /<[a-z][\s\S]*>/i.test(rawBody);
  const fallbackHtml = isRawHtml ? rawBody : ghlBodyToHtml(rawBody);
  const renderedHtml = detailHtmlIsHtml ? detailHtml! : fallbackHtml;

  function handleIframeLoad() {
    const iframe = iframeRef.current;
    if (!iframe) return;

    // Resize to fit content — retry after images load (they inflate scrollHeight)
    const fit = () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) return;
        // Ensure all images have loaded before measuring
        const imgs = Array.from(doc.images);
        const pending = imgs.filter((img) => !img.complete);
        if (pending.length > 0) {
          Promise.all(pending.map((img) => new Promise((res) => { img.onload = res; img.onerror = res; }))).then(fit);
          return;
        }
        const h = doc.documentElement.scrollHeight;
        if (h > 0) iframe.style.height = `${Math.min(h + 16, 600)}px`;
      } catch { /* cross-origin guard */ }
    };
    fit();
  }

  return (
    <div className="rounded-[10px] border border-border/60 bg-card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/40 transition-colors text-left"
      >
        <Mail className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground truncate">{subject}</p>
          <p className="text-[11px] text-muted-foreground mt-px">
            {inbound ? "Received" : "Sent"} · {formatDateTime(message.dateAdded)}
          </p>
        </div>
        <ChevronDown
          className={cn("w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform duration-200", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="border-t border-border/50">
          {detailLoading ? (
            <div className="flex items-center justify-center h-20 text-muted-foreground">
              <RefreshCw className="w-4 h-4 animate-spin" />
            </div>
          ) : (
            <iframe
              ref={iframeRef}
              srcDoc={renderedHtml}
              sandbox="allow-same-origin allow-popups"
              onLoad={handleIframeLoad}
              className="w-full border-none block"
              style={{ minHeight: 160, height: 400 }}
              title="Email preview"
            />
          )}
        </div>
      )}
    </div>
  );
}

function MessagesTab({ contact }: { contact: UnifiedContact }) {
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const { data: convData, isLoading: convLoading } = useQuery<{ conversations: Array<{ id: string }> }>({
    queryKey: ["contact-conv-id", contact.ghlContactId],
    queryFn: () => fetch(`/api/ghl/conversations?contactId=${contact.ghlContactId}&limit=5`).then((r) => r.json()),
    enabled: !!contact.ghlContactId,
    staleTime: 5 * 60 * 1000,
  });

  const convId = convData?.conversations?.[0]?.id;

  const { data: msgData, isLoading: msgLoading, refetch } = useQuery<{ messages: GHLMessage[] }>({
    queryKey: ["contact-msgs", convId],
    queryFn: () => fetch(`/api/ghl/conversations/${convId}/messages`).then((r) => r.json()),
    enabled: !!convId,
    staleTime: 30 * 1000,
  });

  const messages = [...(msgData?.messages ?? [])]
    .filter((m) => {
      const t = (m.messageType ?? "").toUpperCase();
      if (t.includes("ACTIVITY") || t === "") return false;
      const b = (m.body ?? "").toLowerCase();
      return !b.includes("moved to ") && !b.includes("pipeline stage") && !!m.body?.trim();
    })
    .sort((a, b) => new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime());

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  async function send() {
    if (!reply.trim() || !convId) return;
    setSending(true);
    try {
      await fetch(`/api/ghl/conversations/${convId}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: reply.trim() }) });
      setReply("");
      setTimeout(() => refetch(), 600);
    } finally { setSending(false); }
  }

  if (convLoading || msgLoading) {
    return (
      <div className="flex flex-col flex-1 px-4 py-4 gap-3">
        {[45, 65, 40, 70, 55].map((w, i) => (
          <div key={i} className={cn("flex", i % 2 === 0 ? "justify-start" : "justify-end")}>
            <div className="h-9 rounded-[10px] bg-muted animate-pulse" style={{ width: `${w}%`, animationDelay: `${i * 70}ms` }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {!messages.length
          ? <EmptyState icon={MessageCircle} message="No messages yet" />
          : messages.map((m) => {
              const inbound = m.direction === "inbound";
              const isEmail = (m.messageType ?? "").includes("EMAIL");

              if (isEmail) {
                return <EmailCard key={m.id} message={m} />;
              }

              return (
                <div key={m.id} className={cn("flex", inbound ? "justify-start" : "justify-end")}>
                  <div className={cn("max-w-[82%] px-3 py-2 rounded-[10px] text-sm", inbound ? "bg-muted/70 text-foreground" : "bg-primary text-primary-foreground")}>
                    <p className="leading-snug whitespace-pre-wrap">{m.body}</p>
                    <p className={cn("text-[10px] mt-1 opacity-50", inbound ? "" : "text-right")}>{formatDateTime(m.dateAdded)}</p>
                  </div>
                </div>
              );
            })
        }
        <div ref={endRef} />
      </div>
      {convId && (
        <div className="px-4 pb-4 shrink-0">
          <div className="flex items-end gap-2 border border-border rounded-[10px] px-3 py-2 bg-card focus-within:ring-2 focus-within:ring-primary/15 focus-within:border-primary/30 transition-shadow">
            <textarea rows={1} value={reply} onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Reply…" className="flex-1 text-sm bg-transparent resize-none focus:outline-none placeholder:text-muted-foreground/40 max-h-28" />
            <button onClick={send} disabled={!reply.trim() || sending} className="p-1.5 rounded-[7px] bg-primary text-white hover:bg-primary/90 disabled:opacity-40 transition-colors shrink-0">
              {sending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NotesTab({ contact }: { contact: UnifiedContact }) {
  const [newNote, setNewNote] = useState("");
  const [adding, setAdding] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ notes: GHLNote[] }>({
    queryKey: ["contact-notes", contact.ghlContactId],
    queryFn: () => fetch(`/api/ghl/contacts/${contact.ghlContactId}/notes`).then((r) => r.json()),
    enabled: !!contact.ghlContactId,
    staleTime: 60 * 1000,
  });

  const notes = [...(data?.notes ?? [])]
    .filter((n) => !isQualificationNote(n.body))
    .sort((a, b) =>
      new Date(b.createdAt ?? b.dateAdded ?? 0).getTime() - new Date(a.createdAt ?? a.dateAdded ?? 0).getTime()
    );

  const addMutation = useMutation({
    mutationFn: (body: string) =>
      fetch(`/api/ghl/contacts/${contact.ghlContactId}/notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) }).then((r) => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["contact-notes", contact.ghlContactId] }); setNewNote(""); setAdding(false); },
  });

  if (isLoading) {
    return <div className="p-4 space-y-2">{Array.from({ length: 3 }, (_, i) => <div key={i} className="h-16 rounded-[8px] bg-muted animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />)}</div>;
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {!notes.length && !adding && <EmptyState icon={StickyNote} message="No notes yet" />}
        {notes.map((n) => (
          <div key={n.id} className="bg-muted/30 border border-border/50 rounded-[8px] px-3 py-2.5">
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{n.body}</p>
            <p className="text-[11px] text-muted-foreground mt-1.5">{relativeTime(n.createdAt ?? n.dateAdded ?? new Date().toISOString())}</p>
          </div>
        ))}
      </div>
      {contact.ghlContactId && (
        <div className="px-4 pb-4 shrink-0">
          {adding ? (
            <div className="space-y-2">
              <textarea autoFocus rows={3} value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Write a note…"
                className="w-full text-sm border border-border rounded-[8px] px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/30 resize-none" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setAdding(false)} className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
                <button onClick={() => addMutation.mutate(newNote)} disabled={!newNote.trim() || addMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-primary text-white rounded-[7px] hover:bg-primary/90 disabled:opacity-40">
                  {addMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAdding(true)} className="w-full flex items-center gap-1.5 px-3 py-2 text-sm text-muted-foreground hover:text-foreground border border-dashed border-border rounded-[8px] hover:border-primary/30 transition-colors">
              <Plus className="w-3.5 h-3.5" /> Add note
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function QualificationTab({ contact }: { contact: UnifiedContact }) {
  const { data, isLoading } = useQuery<{ notes: GHLNote[] }>({
    queryKey: ["contact-notes-qual", contact.ghlContactId],
    queryFn: () => fetch(`/api/ghl/contacts/${contact.ghlContactId}/notes`).then((r) => r.json()),
    enabled: !!contact.ghlContactId,
    staleTime: 5 * 60 * 1000,
  });

  const qualNote = data?.notes?.find((n) => isQualificationNote(n.body));

  if (isLoading) {
    return <div className="p-4 space-y-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="space-y-1"><div className="h-2 bg-muted rounded-full animate-pulse w-20" /><div className="h-3.5 bg-muted/70 rounded-full animate-pulse w-40" /></div>)}</div>;
  }

  if (!qualNote) return <EmptyState icon={ClipboardList} message="No qualification note found" />;

  const pairs = parseQualificationNote(qualNote.body);

  return (
    <div className="p-4 overflow-y-auto flex-1 space-y-4">
      {pairs.map((qa, i) => (
        <div key={i}>
          <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-[0.08em] mb-0.5">{qa.question}</p>
          {qa.cleanedUrl
            ? <a href={qa.cleanedUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1 break-all"><ExternalLink className="w-3 h-3 shrink-0" />{qa.answer}</a>
            : <p className="text-sm text-foreground leading-snug">{qa.answer || <span className="text-muted-foreground/40 italic">—</span>}</p>
          }
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
      <Icon className="w-8 h-8 mb-2 text-border" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

// ─── Modal ─────────────────────────────────────────────────────────────────────

export function ContactModal({ contact, onClose }: { contact: UnifiedContact; onClose: () => void }) {
  const isGHL = contact.source === "ghl";
  const tabs = RIGHT_TABS.filter((t) => !t.ghlOnly || isGHL);
  const [activeTab, setActiveTab] = useState<RightTab>(tabs[0].id);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.35)" }} onClick={onClose}>
      <div
        className="bg-card border border-border rounded-[14px] shadow-2xl flex flex-col overflow-hidden"
        style={{ width: "min(800px, calc(100vw - 32px))", height: "min(600px, calc(100vh - 32px))" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className={cn("w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0", avatarColor(contact.name))}>
              {contact.name.trim()[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{contact.name}</p>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                {contact.email && <span className="text-xs text-muted-foreground truncate">{contact.email}</span>}
                {contact.platform && (
                  <>
                    {contact.email && <span className="text-border">·</span>}
                    <span className="text-xs text-muted-foreground">
                      {{ lead_form: "Meta Lead Form", facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok" }[contact.platform] ?? contact.platform}
                    </span>
                  </>
                )}
                {contact.awaitingReply && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-rose-500 bg-rose-50 px-1.5 py-px rounded-full">
                    <span className="w-1 h-1 rounded-full bg-rose-500 animate-pulse" />Awaiting reply
                  </span>
                )}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-[6px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ml-3 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Two-column body */}
        <div className="flex flex-1 min-h-0">
          {/* Left: static info */}
          <LeftPanel contact={contact} />

          {/* Right: tabbed activity */}
          <div className="flex flex-col flex-1 min-w-0 min-h-0">
            {/* Tab bar */}
            <div className="flex items-center border-b border-border px-4 shrink-0">
              {tabs.map((t) => {
                const Icon = t.icon;
                const active = activeTab === t.id;
                return (
                  <button key={t.id} onClick={() => setActiveTab(t.id)}
                    className={cn("flex items-center gap-1.5 px-1 py-3 text-xs font-medium border-b-2 mr-5 last:mr-0 transition-colors whitespace-nowrap",
                      active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                    )}>
                    <Icon className="w-3.5 h-3.5" />{t.label}
                  </button>
                );
              })}
            </div>

            {/* Tab content */}
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
              {activeTab === "timeline"      && <TimelineTab      contact={contact} />}
              {activeTab === "messages"      && <MessagesTab      contact={contact} />}
              {activeTab === "notes"         && <NotesTab         contact={contact} />}
              {activeTab === "qualification" && <QualificationTab contact={contact} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
