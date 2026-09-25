"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils/cn";
import { formatDateTime, relativeTime } from "@/lib/utils/date";
import { Mail, ChevronDown, RefreshCw } from "lucide-react";
import type { GHLMessage } from "@/lib/ghl/types";
import { useStageHistoryStore, findStageChange } from "@/store/stage-history-store";
import { MessageBody } from "@/components/shared/message-body";
import { SmartBanner, EnrichChip, type AttachTarget } from "@/components/shared/chat-bubble";
import { extractContactData, scanThread, filterAlreadyOnFile } from "@/lib/utils/extract-contact-data";
import { ContactAvatar } from "@/components/inbox/channel-avatar";
import { MessageAttachments } from "@/components/inbox/message-attachments";

interface MessageThreadProps {
  messages: GHLMessage[];
  /** GHL contact for this conversation — enables click-to-attach chips when present. */
  contactId?: string;
  /** Optional display name for the contact's avatar. Falls back to the fetched
   *  contact name, then "Contact", when not supplied by the caller. */
  contactName?: string;
  /** Contact's real profile photo (e.g. Instagram/Facebook), from the conversation.
   *  Used on every inbound message avatar, matching the thread header. */
  contactAvatarUrl?: string | null;
  /** Optional. Fired after a field is attached from the thread, so a host that keeps its own
   *  caches can refresh them. The Inbox needs nothing extra; the contact modal uses it to
   *  refresh its left-hand panel and the contacts list, which this component does not know
   *  about (it only invalidates ghl-contact-basic and contact-opportunity). */
  onFieldSaved?: (field: string, value: string) => void;
  /** Scopes stage-change lookups to ONE opportunity. Without it, findStageChange matches purely
   *  on timestamp, which mislabels a contact who has several deals. The Inbox shows a contact's
   *  whole conversation and has no single opportunity, so it omits this; the opportunity modal
   *  passes the deal it is showing. */
  opportunityId?: string;
  /** Fallback label for the most recent stage change when the local store has no record of it,
   *  e.g. "Moved to Demo Sent". The opportunity modal knows its current stage; the Inbox does not. */
  currentStageName?: string;
}

export function MessageThread({ messages, contactId, contactName, contactAvatarUrl, onFieldSaved, opportunityId, currentStageName }: MessageThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const stageChanges = useStageHistoryStore((s) => s.changes);
  const [expandedEmails, setExpandedEmails] = useState<Set<string>>(new Set());
  const [emailHtml, setEmailHtml] = useState<Record<string, string | null>>({});
  const [emailLoading, setEmailLoading] = useState<Set<string>>(new Set());

  // Current contact data — powers click-to-attach + the "only show new data" filter.
  // websiteRaw is the custom field GHL actually reads website from.
  const hasContact = !!contactId;
  const { data: contactData } = useQuery<{
    contact?: { email?: string; phone?: string; fullName?: string; firstName?: string; lastName?: string } | null;
    website?: string | null;
    websiteRaw?: string | null;
  }>({
    queryKey: ["ghl-contact-basic", contactId],
    queryFn: () => fetch(`/api/ghl/contacts/${contactId}`).then((r) => r.json()),
    enabled: hasContact,
    staleTime: 60_000,
  });

  // Resolve the contact's display name for the inbound avatar (prop → fetched
  // name → generic fallback). Outbound messages use a fixed rep identity so the
  // avatar reads clearly as "us".
  // Our own brand avatars (connected IG/FB) — the outbound "us" photo, per channel.
  const { data: brand } = useQuery<{ instagram?: string | null; facebook?: string | null }>({
    queryKey: ["inbox-identity"],
    queryFn: () => fetch("/api/inbox/identity").then((r) => r.json()),
    staleTime: 10 * 60_000,
  });

  const fetchedName =
    contactData?.contact?.fullName?.trim() ||
    [contactData?.contact?.firstName, contactData?.contact?.lastName].filter(Boolean).join(" ").trim() ||
    "";
  const contactDisplayName = contactName?.trim() || fetchedName || "Contact";
  const repDisplayName = "Kracked";
  const attachTarget: AttachTarget | null = hasContact
    ? { kind: "ghl", contactId: contactId! }
    : null;
  const existing = hasContact
    ? {
        email: contactData?.contact?.email ?? null,
        phone: contactData?.contact?.phone ?? null,
        // Resolved website (standard field → legacy CF), not just the raw CF, so a site
        // stored in the standard field still filters out its detection chip.
        website: contactData?.website ?? contactData?.websiteRaw ?? null,
      }
    : null;

  function handleFieldSaved(field?: string, value?: string) {
    if (!contactId) return;
    queryClient.invalidateQueries({ queryKey: ["ghl-contact-basic", contactId] });
    queryClient.invalidateQueries({ queryKey: ["contact-opportunity", contactId] });
    onFieldSaved?.(field ?? "", value ?? "");
  }

  const fetchEmailHtml = useCallback(async (stateId: string, fetchId: string) => {
    if (emailHtml[stateId] !== undefined || emailLoading.has(stateId)) return;
    setEmailLoading((prev) => new Set(prev).add(stateId));
    try {
      const res = await fetch(`/api/ghl/conversations/messages/email/${fetchId}`);
      const data = await res.json();
      // GHL returns HTML in `body` when contentType is text/html;
      // fall back through known field names in case the schema differs
      const html = data.html ?? data.htmlBody ?? data.body ?? null;
      setEmailHtml((prev) => ({ ...prev, [stateId]: html }));
    } catch {
      setEmailHtml((prev) => ({ ...prev, [stateId]: null }));
    } finally {
      setEmailLoading((prev) => { const s = new Set(prev); s.delete(stateId); return s; });
    }
  }, [emailHtml, emailLoading]);

  function toggleEmail(id: string, fetchId: string) {
    setExpandedEmails((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        fetchEmailHtml(id, fetchId);
      }
      return next;
    });
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        No messages yet
      </div>
    );
  }

  // Reverse to oldest-first (GHL returns newest first)
  const sorted = [...messages].reverse();

  // Detected contact data not already on file — gates the top banner so we never show an
  // empty bar (the banner is OUTSIDE the scroll area; inside it auto-scrolls out of view).
  const newData = attachTarget ? filterAlreadyOnFile(scanThread(sorted), existing) : null;
  const hasNewData =
    !!newData && newData.urls.length + newData.emails.length + newData.phones.length > 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {attachTarget && hasNewData && (
        <div className="px-5 pt-3 shrink-0">
          <SmartBanner
            messages={sorted}
            target={attachTarget}
            existing={existing}
            onFieldSaved={handleFieldSaved}
          />
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
      {sorted.map((msg) => {
        const isOutbound = msg.direction === "outbound";
        const isActivity = msg.messageType === "TYPE_ACTIVITY_OPPORTUNITY";
        const isEmail = msg.messageType === "TYPE_EMAIL";

        // ── Activity: centred system pill ────────────────────────────
        if (isActivity) {
          const isCreated = msg.body === "Opportunity created";
          // Matched by timestamp, and by opportunity when the host supplies one — a contact with
          // several deals would otherwise pick up another deal's stage change.
          const stored = !isCreated && msg.dateAdded
            ? findStageChange(stageChanges, msg.dateAdded, opportunityId)
            : null;
          const isLatest = !isCreated && msg.id === sorted
            .filter(m => m.messageType === "TYPE_ACTIVITY_OPPORTUNITY" && m.body !== "Opportunity created")
            .slice(-1)[0]?.id;
          const label = isCreated
            ? "📥 New Lead"
            : stored
            ? `🔄 ${stored.fromStage} → ${stored.toStage}`
            : isLatest
            ? (currentStageName ? `🔄 Moved to ${currentStageName}` : "🔄 Stage updated")
            : "🔄 Stage changed";
          return (
            <div key={msg.id} className="flex justify-center my-1">
              <span data-r10n-activity-pill className="text-xs text-muted-foreground bg-muted/60 px-3 py-1 rounded-full">
                {label} · {msg.dateAdded ? relativeTime(msg.dateAdded) : ""}
              </span>
            </div>
          );
        }

        // ── Email: expandable card with rendered HTML ────────────────
        if (isEmail) {
          // GHL email messages have a separate emailMessageId used for the HTML fetch endpoint
          const fetchId = (msg as GHLMessage & { emailMessageId?: string }).emailMessageId ?? msg.id;
          const subject = msg.meta?.email?.subject ?? "Email";
          const emailDir = msg.meta?.email?.direction ?? (isOutbound ? "outbound" : "inbound");
          const sentByUs = emailDir === "outbound";
          const isExpanded = expandedEmails.has(msg.id);
          const hasBody = !!msg.body?.trim();

          return (
            <div key={msg.id} className={cn("flex items-end gap-2", sentByUs ? "flex-row-reverse" : "flex-row")}>
              <ContactAvatar
                name={sentByUs ? repDisplayName : contactDisplayName}
                channelType="TYPE_EMAIL"
                variant={sentByUs ? "rep" : "contact"}
                size={32}
              />
              <div data-r10n-email-card data-sent={sentByUs} className={cn(
                "flex-1 max-w-[72%] rounded-[16px] border overflow-hidden",
                sentByUs ? "border-[#C8A96E]/40" : "border-border"
              )}>
                {/* Email header strip */}
                <div data-r10n-email-strip data-sent={sentByUs} className={cn(
                  "flex items-center gap-2 px-3 py-1.5 border-b",
                  sentByUs ? "bg-[#C8A96E]/12 border-[#C8A96E]/20" : "bg-muted/60 border-border"
                )}>
                  <Mail data-r10n-email-icon className={cn("w-3 h-3 shrink-0", sentByUs ? "text-[#C8A96E]" : "text-muted-foreground")} />
                  <span data-r10n-email-label className={cn(
                    "text-[10px] font-semibold uppercase tracking-widest flex-1",
                    sentByUs ? "text-[#C8A96E]" : "text-muted-foreground"
                  )}>
                    {sentByUs ? "Email Sent" : "Email Received"}
                  </span>
                </div>
                {/* Subject + expand toggle */}
                <button
                  onClick={() => toggleEmail(msg.id, fetchId)}
                  className={cn(
                    "w-full text-left px-3.5 py-2.5 flex items-start justify-between gap-2 transition-colors",
                    sentByUs ? "bg-[#C8A96E]/6 hover:bg-[#C8A96E]/10" : "bg-muted/20 hover:bg-muted/40"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground leading-snug">{subject}</p>
                    {msg.dateAdded && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {formatDateTime(msg.dateAdded)}
                      </p>
                    )}
                  </div>
                  <ChevronDown className={cn(
                    "w-3.5 h-3.5 shrink-0 mt-0.5 transition-transform text-muted-foreground",
                    isExpanded && "rotate-180"
                  )} />
                </button>
                {/* Expanded email body */}
                {isExpanded && (
                  <div className="border-t border-border/50">
                    {emailLoading.has(msg.id) ? (
                      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Loading email…
                      </div>
                    ) : emailHtml[msg.id] ? (
                      <iframe
                        srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:0;font-family:-apple-system,sans-serif;font-size:14px;line-height:1.5;color:#111;background:#fff;}img{max-width:100%;height:auto;}a{color:#1a56db;}</style></head><body>${emailHtml[msg.id]}</body></html>`}
                        sandbox="allow-same-origin allow-popups"
                        className="w-full border-none bg-white"
                        style={{ minHeight: 200 }}
                        onLoad={(e) => {
                          const iframe = e.currentTarget;
                          const doc = iframe.contentDocument;
                          if (doc) {
                            iframe.style.height = doc.documentElement.scrollHeight + "px";
                          }
                        }}
                        title={`Email: ${subject}`}
                      />
                    ) : emailHtml[msg.id] === null ? (
                      // API returned no HTML — fall back to cleaned plain text body if available
                      hasBody ? (
                        <div className="px-3.5 py-3 text-xs text-foreground/80 bg-muted/10 whitespace-pre-wrap leading-relaxed">
                          {msg.body
                            // Strip GHL [storage-url] image placeholders
                            .replace(/\[https?:\/\/storage\.googleapis\.com\/[^\]]+\]/g, "")
                            // Strip remaining bare storage URLs
                            .replace(/https?:\/\/storage\.googleapis\.com\/\S+/g, "")
                            // Clean up excess blank lines left behind
                            .replace(/\n{3,}/g, "\n\n")
                            .trim()}
                        </div>
                      ) : (
                        <div className="px-3.5 py-3 text-xs text-muted-foreground italic bg-muted/10">
                          Email body not available — this was sent via a GHL automation workflow.
                        </div>
                      )
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          );
        }

        // ── Channel label helper ──────────────────────────────────────
        const channelLabel =
          msg.messageType === "TYPE_SMS" ? "SMS"
          : msg.messageType === "TYPE_FB" ? "Facebook"
          : msg.messageType === "TYPE_INSTAGRAM" ? "Instagram"
          : msg.messageType === "TYPE_WHATSAPP" ? "WhatsApp"
          : msg.messageType === "TYPE_CALL" ? "Call"
          : null;

        // ── Regular message bubble (SMS / FB / IG / etc.) ────────────
        const chips =
          !isOutbound && attachTarget
            ? filterAlreadyOnFile(extractContactData(msg.body), existing)
            : null;
        const hasChips =
          !!chips && chips.urls.length + chips.emails.length + chips.phones.length > 0;
        // Channel type for the avatar badge — matches the conversation list's
        // known channels; unknown types (call/whatsapp) simply show no badge.
        const badgeChannel =
          msg.messageType === "TYPE_SMS" || msg.messageType === "TYPE_EMAIL"
            ? msg.messageType
            : msg.messageType === "TYPE_FB"
            ? "TYPE_FB"
            : msg.messageType === "TYPE_INSTAGRAM"
            ? "TYPE_INSTAGRAM"
            : undefined;
        // Our reply avatar = our real brand photo for that channel (IG/FB), else initials.
        // Inbound = the contact's photo.
        const outboundAvatar =
          badgeChannel === "TYPE_INSTAGRAM" ? brand?.instagram ?? null
          : badgeChannel === "TYPE_FB" ? brand?.facebook ?? null
          : null;
        // Images/files GHL sent with the message. Rendering these fixes the "blank bubble"
        // (image-only messages had no text body).
        const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
        const hasText = !!msg.body && msg.body.trim().length > 0;
        return (
          <div key={msg.id} className={cn("flex items-end gap-2", isOutbound ? "flex-row-reverse" : "flex-row")}>
            <ContactAvatar
              name={isOutbound ? repDisplayName : contactDisplayName}
              channelType={badgeChannel}
              variant={isOutbound ? "rep" : "contact"}
              size={32}
              avatarUrl={isOutbound ? outboundAvatar : contactAvatarUrl}
            />
            <div className={cn("flex flex-col gap-1 min-w-0 max-w-[76%]", isOutbound ? "items-end" : "items-start")}>
              <div data-r10n-bubble data-dir={isOutbound ? "out" : "in"} className={cn(
                "max-w-full w-fit px-3.5 py-2.5 text-sm leading-relaxed",
                isOutbound
                  ? "bg-[#EEF4FF] text-[#1C1C21] rounded-[16px] rounded-br-[5px]"
                  : "bg-card text-[#1C1C21] border border-border rounded-[16px] rounded-bl-[5px]"
              )}>
                {hasText && (
                  <MessageBody
                    body={msg.body}
                    linkClassName={isOutbound ? "text-[#2563EB] underline" : "text-primary"}
                  />
                )}
                {attachments.length > 0 && (
                  <MessageAttachments urls={attachments} className={cn(hasText && "mt-2", isOutbound && "justify-end")} />
                )}
                {!hasText && attachments.length === 0 && (
                  <span className="text-xs italic text-muted-foreground/70">No content</span>
                )}
                <p data-r10n-bubble-time className={cn(
                  "text-[10px] mt-1.5 text-right tabular-nums",
                  isOutbound ? "text-[#1C1C21]/50" : "text-muted-foreground"
                )}>
                  {msg.dateAdded ? formatDateTime(msg.dateAdded) : ""}
                </p>
              </div>
              {channelLabel && (
                <span data-r10n-bubble-channel className="text-[10px] text-muted-foreground/70 px-1.5">
                  {channelLabel}
                </span>
              )}
              {hasChips && attachTarget && (
                <div className={cn("flex flex-wrap gap-1.5 mt-1", isOutbound ? "justify-end" : "justify-start")}>
                  {chips!.urls.map((v) => (
                    <EnrichChip key={v} type="url" value={v} target={attachTarget} onSaved={handleFieldSaved} />
                  ))}
                  {chips!.emails.map((v) => (
                    <EnrichChip key={v} type="email" value={v} target={attachTarget} onSaved={handleFieldSaved} />
                  ))}
                  {chips!.phones.map((v) => (
                    <EnrichChip key={v} type="phone" value={v} target={attachTarget} onSaved={handleFieldSaved} />
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
      </div>
    </div>
  );
}
