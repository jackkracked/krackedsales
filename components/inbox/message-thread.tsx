"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils/cn";
import { formatDateTime, relativeTime } from "@/lib/utils/date";
import { Mail, ChevronDown, RefreshCw } from "lucide-react";
import type { GHLMessage } from "@/lib/ghl/types";
import { useStageHistoryStore, findStageChange } from "@/store/stage-history-store";
import { MessageBody } from "@/components/shared/message-body";

interface MessageThreadProps {
  messages: GHLMessage[];
}

export function MessageThread({ messages }: MessageThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const stageChanges = useStageHistoryStore((s) => s.changes);
  const [expandedEmails, setExpandedEmails] = useState<Set<string>>(new Set());
  const [emailHtml, setEmailHtml] = useState<Record<string, string | null>>({});
  const [emailLoading, setEmailLoading] = useState<Set<string>>(new Set());

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

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
      {sorted.map((msg) => {
        const isOutbound = msg.direction === "outbound";
        const isActivity = msg.messageType === "TYPE_ACTIVITY_OPPORTUNITY";
        const isEmail = msg.messageType === "TYPE_EMAIL";

        // ── Activity: centred system pill ────────────────────────────
        if (isActivity) {
          const isCreated = msg.body === "Opportunity created";
          // Look up from/to stage from local store (matched by timestamp, no opportunityId needed)
          const stored = !isCreated && msg.dateAdded
            ? findStageChange(stageChanges, msg.dateAdded)
            : null;
          const isLatest = !isCreated && msg.id === sorted
            .filter(m => m.messageType === "TYPE_ACTIVITY_OPPORTUNITY" && m.body !== "Opportunity created")
            .slice(-1)[0]?.id;
          const label = isCreated
            ? "📥 New Lead"
            : stored
            ? `🔄 ${stored.fromStage} → ${stored.toStage}`
            : isLatest
            ? "🔄 Stage updated"
            : "🔄 Stage changed";
          return (
            <div key={msg.id} className="flex justify-center my-1">
              <span className="text-xs text-muted-foreground bg-muted/60 px-3 py-1 rounded-full">
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
            <div key={msg.id} className={cn("flex flex-col gap-0.5", sentByUs ? "items-end" : "items-start")}>
              <div className={cn(
                "w-[72%] rounded-[10px] border overflow-hidden",
                sentByUs ? "border-[#C8A96E]/40" : "border-border"
              )}>
                {/* Email header strip */}
                <div className={cn(
                  "flex items-center gap-2 px-3 py-1.5 border-b",
                  sentByUs ? "bg-[#C8A96E]/12 border-[#C8A96E]/20" : "bg-muted/60 border-border"
                )}>
                  <Mail className={cn("w-3 h-3 shrink-0", sentByUs ? "text-[#C8A96E]" : "text-muted-foreground")} />
                  <span className={cn(
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
        return (
          <div key={msg.id} className={cn("flex flex-col gap-1", isOutbound ? "items-end" : "items-start")}>
            <div className={cn(
              "max-w-[68%] px-3.5 py-2.5 text-sm leading-relaxed",
              isOutbound
                ? "bg-primary text-primary-foreground rounded-[16px] rounded-br-[5px] shadow-[0_4px_14px_-8px_rgba(15,58,92,0.5)]"
                : "bg-card text-foreground border border-border/70 rounded-[16px] rounded-bl-[5px] shadow-[0_2px_8px_-6px_rgba(15,23,42,0.18)]"
            )}>
              <MessageBody
                body={msg.body}
                linkClassName={isOutbound ? "text-primary-foreground underline" : "text-primary"}
              />
              <p className={cn(
                "text-[10px] mt-1.5 text-right tabular-nums",
                isOutbound ? "text-primary-foreground/65" : "text-muted-foreground"
              )}>
                {msg.dateAdded ? formatDateTime(msg.dateAdded) : ""}
              </p>
            </div>
            {channelLabel && (
              <span className="text-[10px] text-muted-foreground/70 px-1.5">
                {channelLabel}
              </span>
            )}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
