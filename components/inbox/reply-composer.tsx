"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import { useCrossChannelSend, type CrossChannelResult } from "@/lib/hooks/use-conversations";
import { useInboxStore } from "@/store/inbox-store";
import { Send, MessageSquare, Check, X, Loader2, Paperclip, FileText } from "lucide-react";
import { CHANNEL_ICONS, CHANNEL_COLOR, CHANNEL_LABEL } from "./channel-avatar";
import { QuickMessagesPopover } from "./quick-messages-popover";

interface UploadedAttachment {
  url: string;
  name: string;
  contentType: string;
}

// Real brand logo + brand colour per channel (shared with the list/thread/rail). Fallback keeps any
// unusual channel type sendable rather than stranding the reply.
const labelFor = (t: string) => CHANNEL_LABEL[t] ?? (t.replace(/^TYPE_/, "") || "Message");
const iconFor = (t: string): React.ElementType => CHANNEL_ICONS[t] ?? MessageSquare;
const colorFor = (t: string) => CHANNEL_COLOR[t] ?? "text-muted-foreground";

interface ReplyComposerProps {
  conversationId: string;
  contactId: string;
  defaultChannelType?: string;
  /** Optional: passed by the parent when known (avoids a contact fetch). */
  contactPhone?: string | null;
  contactEmail?: string | null;
}

export function ReplyComposer({
  conversationId,
  contactId,
  defaultChannelType = "TYPE_SMS",
  contactPhone,
  contactEmail,
}: ReplyComposerProps) {
  const { replyDraft, setReplyDraft, clearReplyDraft } = useInboxStore();
  const send = useCrossChannelSend();
  const [results, setResults] = useState<CrossChannelResult[] | null>(null);
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Contact identifiers decide which extra channels are reachable. Use props when given, else fetch.
  const { data: contactData } = useQuery<{ contact?: { phone?: string; email?: string } }>({
    queryKey: ["ghl-contact", contactId], // shared with the contact panel so edits refresh both
    queryFn: () => fetch(`/api/ghl/contacts/${contactId}`).then((r) => r.json()),
    enabled: !!contactId && (contactPhone === undefined || contactEmail === undefined),
    staleTime: 60_000,
  });
  const phone = contactPhone ?? contactData?.contact?.phone ?? null;
  const email = contactEmail ?? contactData?.contact?.email ?? null;

  // Reachable channels: the current thread's channel (always, carries its conversationId), plus
  // SMS (if a phone) and Email (if an email). IG/FB/TikTok can't be initiated cold, so they only
  // appear when they ARE the current channel.
  const channels = useMemo(() => {
    const map = new Map<string, { type: string; conversationId?: string }>();
    map.set(defaultChannelType, { type: defaultChannelType, conversationId });
    if (phone && !map.has("TYPE_SMS")) map.set("TYPE_SMS", { type: "TYPE_SMS" });
    if (email && !map.has("TYPE_EMAIL")) map.set("TYPE_EMAIL", { type: "TYPE_EMAIL" });
    // Keep the current channel even if it's an unusual type — never strand a reply.
    return [...map.values()];
  }, [defaultChannelType, conversationId, phone, email]);

  const [selected, setSelected] = useState<Set<string>>(new Set([defaultChannelType]));
  useEffect(() => {
    setSelected(new Set([defaultChannelType]));
    setResults(null);
    setAttachments([]);
    setUploading(0);
  }, [conversationId, defaultChannelType]);

  const draft = replyDraft[conversationId] ?? "";
  const hasContent = !!draft.trim() || attachments.length > 0;
  const canSend = hasContent && selected.size > 0 && !send.isPending && uploading === 0;

  function toggle(type: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(type)) { if (next.size > 1) next.delete(type); } // keep at least one
      else next.add(type);
      return next;
    });
  }

  // Insert a quick message into the draft (append below existing text, else fill), then focus.
  function insertQuickMessage(text: string) {
    const current = replyDraft[conversationId] ?? "";
    const next = current.trim() ? `${current.replace(/\s+$/, "")}\n${text}` : text;
    setReplyDraft(conversationId, next);
    if (results) setResults(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) { el.focus(); el.setSelectionRange(next.length, next.length); }
    });
  }

  // Upload each picked file to Blob (via /api/inbox/upload) and add it to the attachment tray.
  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    for (const file of Array.from(list)) {
      setUploading((n) => n + 1);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/inbox/upload", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Upload failed");
        setAttachments((a) => [...a, { url: data.url, name: data.name, contentType: data.contentType }]);
      } catch {
        toast.error(`Couldn't attach ${file.name}`);
      } finally {
        setUploading((n) => Math.max(0, n - 1));
      }
    }
  }

  function removeAttachment(url: string) {
    setAttachments((a) => a.filter((x) => x.url !== url));
  }

  function handleSend() {
    if (!canSend) return;
    const targets = channels.filter((c) => selected.has(c.type)).map((c) => ({ type: c.type, conversationId: c.conversationId }));
    send.mutate(
      { contactId, message: draft.trim(), targets, attachments: attachments.map((a) => a.url) },
      {
        onSuccess: (data) => {
          setResults(data.results);
          if (data.ok) {
            clearReplyDraft(conversationId);
            setAttachments([]);
          }
        },
      },
    );
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  }

  const multi = selected.size > 1;

  return (
    <div data-r10n-composer className="border-t border-border bg-card px-4 py-3 shrink-0">
      {/* Channel pills — tick every channel to reach at once. Current is pre-selected. */}
      {channels.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          <span className="text-[11px] text-muted-foreground mr-0.5">Send on</span>
          {channels.map((c) => {
            const Icon = iconFor(c.type);
            const on = selected.has(c.type);
            return (
              <button
                key={c.type}
                type="button"
                onClick={() => toggle(c.type)}
                aria-pressed={on}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  on
                    ? "border-foreground/15 bg-muted text-foreground"
                    : "border-border bg-background text-muted-foreground hover:text-foreground hover:border-foreground/20",
                )}
              >
                <Icon className={cn("h-3 w-3 shrink-0", colorFor(c.type))} />
                {labelFor(c.type)}
                {on && <Check className="h-2.5 w-2.5 text-foreground/50" />}
              </button>
            );
          })}
        </div>
      )}

      <div
        data-r10n-composer-field
        className="rounded-[14px] border border-border bg-background transition-all focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15"
      >
        {/* Attachment tray */}
        {(attachments.length > 0 || uploading > 0) && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {attachments.map((a) => (
              <AttachmentChip key={a.url} att={a} onRemove={() => removeAttachment(a.url)} />
            ))}
            {uploading > 0 && (
              <div className="flex h-16 items-center gap-1.5 rounded-[10px] border border-border bg-muted/40 px-3 text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading…
              </div>
            )}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => { setReplyDraft(conversationId, e.target.value); if (results) setResults(null); }}
          onKeyDown={handleKeyDown}
          placeholder={multi ? "Type once, send on every ticked channel…" : "Type a reply…"}
          rows={2}
          className="w-full resize-none bg-transparent px-3.5 pt-3 pb-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none leading-relaxed"
        />
        <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1">
          <div className="min-w-0 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {/* Composer tools: quick messages + attach */}
            <QuickMessagesPopover onInsert={insertQuickMessage} />
            <button
              type="button"
              data-r10n-composer-tool
              onClick={() => fileInputRef.current?.click()}
              title="Attach a file"
              aria-label="Attach a file"
              className="flex items-center justify-center h-8 w-8 rounded-[9px] border border-border text-muted-foreground transition-all active:scale-95 hover:border-primary/40 hover:text-primary hover:bg-primary/[0.04]"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
            />
            <span className="mx-0.5 hidden sm:block h-4 w-px bg-border" aria-hidden />
            {results ? (
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                {results.map((r) => (
                  <span key={r.type} className={cn("inline-flex items-center gap-1", r.ok ? "text-success" : "text-destructive")}>
                    {r.ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                    {labelFor(r.type)}
                  </span>
                ))}
              </span>
            ) : (
              <span data-r10n-composer-kbd className="text-[10px] text-muted-foreground/55 tabular-nums">⌘↵ to send</span>
            )}
          </div>
          <button
            onClick={handleSend}
            disabled={!canSend}
            data-r10n-composer-send
            data-can-send={canSend}
            className={cn(
              "flex items-center gap-1.5 pl-3 pr-3.5 py-1.5 rounded-[9px] text-sm font-semibold transition-all active:scale-[0.97]",
              canSend
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground cursor-not-allowed",
            )}
          >
            {send.isPending ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending</>
            ) : (
              <>{multi ? `Send · ${selected.size}` : "Send"} <Send className="w-3.5 h-3.5" /></>
            )}
          </button>
        </div>
      </div>

      {send.isError && (
        <p className="text-xs text-destructive mt-1.5 px-1">
          {(send.error as Error)?.message ?? "Failed to send. Try again."}
        </p>
      )}
    </div>
  );
}

function AttachmentChip({ att, onRemove }: { att: UploadedAttachment; onRemove: () => void }) {
  const isImage = att.contentType.startsWith("image/");
  return (
    <div className="group relative">
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={att.url} alt={att.name} className="h-16 w-16 rounded-[10px] border border-border object-cover" />
      ) : (
        <div className="flex h-16 items-center gap-1.5 rounded-[10px] border border-border bg-background px-3 max-w-[170px]">
          <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="truncate text-xs text-foreground">{att.name}</span>
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        title="Remove attachment"
        aria-label="Remove attachment"
        className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background shadow ring-2 ring-card opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
