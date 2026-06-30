"use client";

import { cn } from "@/lib/utils/cn";
import { formatMessageTime } from "@/lib/utils/date";
import { Inbox, Check, CornerUpLeft, ChevronRight } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import type { GHLConversation } from "@/lib/ghl/types";

function cleanPreview(body: string | undefined): string {
  if (!body?.trim()) return "No messages yet";
  return body.replace(/<[^>]+>/g, "").replace(/\[https?:\/\/[^\]]+\]/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim() || "📎 Attachment";
}

function Stat({ value, label, tone }: { value: number; label: string; tone: "navy" | "amber" }) {
  return (
    <div data-r10n-overview-stat data-tone={tone} className={cn("flex-1 rounded-[12px] border px-4 py-3.5", tone === "navy" ? "bg-primary/[0.05] border-primary/15" : "bg-amber-50 border-amber-200/70")}>
      <p data-r10n-overview-statvalue className={cn("text-[1.9rem] leading-none font-bold tabular-nums", tone === "navy" ? "text-primary" : "text-amber-600")} style={{ fontFamily: "var(--font-heading)" }}>
        {value}
      </p>
      <p data-r10n-overview-statlabel className="text-[11px] font-medium text-muted-foreground mt-1.5">{label}</p>
    </div>
  );
}

export function InboxOverview({ conversations, onSelect }: { conversations: GHLConversation[]; onSelect: (id: string) => void }) {
  const unread = conversations.filter((c) => c.unreadCount > 0);
  const awaiting = conversations.filter((c) => c.lastMessageDirection === "inbound");
  const seen = new Set<string>();
  const attention = [...unread, ...awaiting]
    .filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    })
    .slice(0, 6);
  const allClear = unread.length === 0 && awaiting.length === 0;

  return (
    <div data-r10n-overview className="flex-1 flex flex-col items-center justify-center bg-background px-6 py-10 overflow-y-auto">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-7">
          <div data-r10n-overview-glyph className="inline-flex w-12 h-12 rounded-[14px] bg-primary/[0.07] items-center justify-center mb-3">
            <Inbox className="w-5 h-5 text-primary" />
          </div>
          <h2 data-r10n-overview-title className="text-xl font-bold text-foreground tracking-[-0.01em]" style={{ fontFamily: "var(--font-heading)" }}>
            {allClear ? "You're all caught up" : "Here's where things stand"}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {allClear ? "Nothing waiting on a reply. Nice." : "Pick a conversation, or jump straight to what needs you."}
          </p>
        </div>

        {/* Stats */}
        <div className="flex gap-3 mb-7">
          <Stat value={unread.length} label="unread" tone="navy" />
          <Stat value={awaiting.length} label="waiting on a reply" tone="amber" />
        </div>

        {/* Needs attention */}
        {allClear ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-11 h-11 rounded-full bg-accent-green/10 flex items-center justify-center mb-2">
              <Check className="w-5 h-5 text-accent-green" />
            </div>
            <p className="text-sm text-muted-foreground">Inbox zero. Everything has a reply.</p>
          </div>
        ) : attention.length > 0 ? (
          <div>
            <p data-r10n-overview-section className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70 mb-2 px-1">Needs your attention</p>
            <div data-r10n-overview-list className="rounded-[12px] border border-border bg-card overflow-hidden divide-y divide-border/60">
              {attention.map((c) => {
                const name = c.fullName || c.phone || c.email || "Unknown";
                const hasUnread = c.unreadCount > 0;
                return (
                  <button key={c.id} onClick={() => onSelect(c.id)} data-r10n-overview-row className="group flex items-center gap-3 w-full px-3 py-2.5 text-left hover:bg-primary/[0.04] transition-colors">
                    <Avatar name={name} size={36} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span data-r10n-convo-name className={cn("text-sm truncate", hasUnread ? "font-semibold text-foreground" : "font-medium text-foreground/90")}>{name}</span>
                        <span data-r10n-convo-time className="text-[11px] text-muted-foreground shrink-0 tabular-nums">{c.lastMessageDate ? formatMessageTime(c.lastMessageDate) : ""}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {!hasUnread && <CornerUpLeft data-r10n-convo-awaiticon className="w-3 h-3 text-amber-500 shrink-0" />}
                        <span data-r10n-convo-preview className="text-xs text-muted-foreground truncate">{cleanPreview(c.lastMessageBody)}</span>
                      </div>
                    </div>
                    {hasUnread ? (
                      <span data-r10n-convo-unread className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center shrink-0">{c.unreadCount > 9 ? "9+" : c.unreadCount}</span>
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-foreground/40 shrink-0 group-hover:text-muted-foreground transition-colors" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <p className="text-center text-[11px] text-muted-foreground/60 mt-6">Select any conversation on the left to open it.</p>
      </div>
    </div>
  );
}
