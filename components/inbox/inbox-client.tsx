"use client";

import { useState } from "react";
import { useConversations, useMessages } from "@/lib/hooks/use-conversations";
import { useInboxStore } from "@/store/inbox-store";
import { ConversationList } from "./conversation-list";
import { Avatar } from "@/components/ui/avatar";
import { MessageThread } from "./message-thread";
import { ReplyComposer } from "./reply-composer";
import type { ChannelFilter } from "./channel-filter-pills";
import { MetaConversations } from "./meta-conversations";
import { TikTokConversations } from "./tiktok-conversations";
import { LeadDetailsSidebar } from "./lead-details-sidebar";
import { InboxOverview } from "./inbox-overview";
import { RefreshCw, ArrowLeft, Move, Inbox, MessageCircle } from "lucide-react";
import { TikTokIcon, FacebookIcon } from "@/components/shared/channel-icon";
import { MessageSquare, Mail } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { ReplyQueue } from "./reply-queue";

type InboxTab = "Queue" | "GHL" | "Meta" | "SMS" | "Email" | "TikTok";

const TAB_TO_CHANNEL: Partial<Record<InboxTab, ChannelFilter>> = {
  GHL: "ALL",
  SMS: "TYPE_SMS",
  Email: "TYPE_EMAIL",
};

const INBOX_TABS: Array<{ key: InboxTab; label: string; icon?: React.ElementType }> = [
  { key: "Queue", label: "Queue", icon: Inbox },
  { key: "GHL", label: "GHL", icon: MessageCircle },
  { key: "Meta", label: "Meta", icon: FacebookIcon },
  { key: "SMS", label: "SMS", icon: MessageSquare },
  { key: "Email", label: "Email", icon: Mail },
  { key: "TikTok", label: "TikTok", icon: TikTokIcon },
];

export function InboxClient() {
  const [inboxTab, setInboxTab] = useState<InboxTab>("GHL");
  const [unreadOnly, setUnreadOnly] = useState(false); // Default: all conversations
  const [mobileView, setMobileView] = useState<"list" | "thread">("list");

  const channel: ChannelFilter = TAB_TO_CHANNEL[inboxTab] ?? "ALL";

  const { selectedConversationId, setSelectedConversationId } = useInboxStore();

  const { data, isLoading, isFetching, error } = useConversations(channel, unreadOnly);
  const { data: messagesData, isLoading: messagesLoading } = useMessages(selectedConversationId);

  // Instagram DMs are routed to the Meta tab — exclude them from GHL/SMS/Email views
  const rawConversations = data?.conversations ?? [];
  const conversations = inboxTab === "GHL"
    ? rawConversations.filter((c) => c.type !== "TYPE_INSTAGRAM" && c.lastMessageType !== "TYPE_INSTAGRAM")
    : rawConversations;
  const messages = messagesData?.messages ?? [];
  const selectedConversation = conversations.find((c) => c.id === selectedConversationId);

  function handleSelectConversation(id: string) {
    setSelectedConversationId(id);
    setMobileView("thread");
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Vertical channel rail ── */}
      <nav className="w-[68px] shrink-0 border-r border-border bg-card flex flex-col items-stretch py-2 overflow-y-auto">
        {INBOX_TABS.map(({ key, label, icon: Icon }) => {
          const active = inboxTab === key;
          return (
            <button
              key={key}
              onClick={() => setInboxTab(key)}
              title={label}
              className="group flex flex-col items-center gap-1 px-1 py-1.5 outline-none"
            >
              <span className={cn(
                "relative w-10 h-10 rounded-[12px] flex items-center justify-center transition-all duration-150 active:scale-[0.94]",
                active
                  ? "bg-primary text-primary-foreground shadow-[0_4px_12px_-6px_rgba(15,58,92,0.5)]"
                  : "text-muted-foreground group-hover:bg-muted group-hover:text-foreground"
              )}>
                {Icon ? <Icon className="w-[18px] h-[18px]" /> : <span className="text-[13px] font-bold">{label[0]}</span>}
              </span>
              <span className={cn("text-[10px] font-medium leading-none", active ? "text-foreground" : "text-muted-foreground")}>{label}</span>
            </button>
          );
        })}
      </nav>

      {/* ── Channel content ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

      {/* ── Reply Queue ── */}
      {inboxTab === "Queue" && (
        <div className="flex-1 overflow-hidden">
          <ReplyQueue />
        </div>
      )}

      {/* ── Meta inbox ── */}
      {inboxTab === "Meta" && (
        <div className="flex-1 overflow-hidden">
          <MetaConversations />
        </div>
      )}

      {/* ── TikTok inbox ── */}
      {inboxTab === "TikTok" && (
        <div className="flex-1 overflow-hidden">
          <TikTokConversations />
        </div>
      )}

      {/* ── GHL / SMS / Email inbox ── */}
      {(inboxTab === "GHL" || inboxTab === "SMS" || inboxTab === "Email") && (
      <div className="flex flex-1 overflow-hidden">
      {/* ── Left panel ── */}
      <div className={cn(
        "flex flex-col border-r border-border bg-card",
        "w-full lg:w-80 xl:w-96 shrink-0",
        mobileView === "thread" ? "hidden lg:flex" : "flex"
      )}>
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-border">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-bold text-foreground tracking-[-0.01em]" style={{ fontFamily: "var(--font-heading)" }}>
              Inbox
            </h2>
            <div className="flex items-center gap-2">
              {isFetching && <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
              {/* Unread / All toggle */}
              <div className="flex items-center bg-muted/60 rounded-[9px] p-0.5">
                <button
                  onClick={() => setUnreadOnly(true)}
                  className={cn(
                    "px-2.5 py-1 text-xs font-medium rounded-[7px] transition-all",
                    unreadOnly
                      ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/[0.04]"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Unread
                </button>
                <button
                  onClick={() => setUnreadOnly(false)}
                  className={cn(
                    "px-2.5 py-1 text-xs font-medium rounded-[7px] transition-all",
                    !unreadOnly
                      ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/[0.04]"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  All
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Conversation list */}
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin mr-2" />
            Loading…
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 px-4">
            <p className="text-xs text-destructive font-mono text-center break-all">
              {(error as Error).message}
            </p>
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
            <p className="text-sm">
              {unreadOnly ? "No unread conversations" : "No conversations found"}
            </p>
            {unreadOnly && (
              <button
                onClick={() => setUnreadOnly(false)}
                className="text-xs text-primary hover:underline"
              >
                Show all conversations
              </button>
            )}
          </div>
        ) : (
          <ConversationList
            conversations={conversations}
            selectedId={selectedConversationId}
            onSelect={handleSelectConversation}
          />
        )}
      </div>

      {/* ── Right panel: message thread + lead sidebar ── */}
      <div className={cn(
        "flex-1 flex min-w-0",
        mobileView === "list" ? "hidden lg:flex" : "flex"
      )}>
        {selectedConversationId && selectedConversation ? (
          <>
            {/* Middle: thread */}
            <div className="flex-1 flex flex-col min-w-0 bg-background">
              {/* Thread header */}
              <div className="flex items-center gap-3 px-5 py-3 border-b border-border bg-card shrink-0">
                <button
                  onClick={() => setMobileView("list")}
                  className="lg:hidden p-1.5 -ml-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <Avatar name={selectedConversation.fullName ?? selectedConversation.contact?.name ?? "Unknown"} size={36} />
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-foreground truncate tracking-[-0.01em]" style={{ fontFamily: "var(--font-heading)" }}>
                    {selectedConversation.fullName ?? selectedConversation.contact?.name ?? "Unknown"}
                  </h3>
                  <p className="text-xs text-muted-foreground truncate">
                    {selectedConversation.contact?.email ?? selectedConversation.email ?? selectedConversation.contact?.phone ?? selectedConversation.phone ?? ""}
                  </p>
                </div>
                <div className="ml-auto">
                  <button
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-foreground border border-border rounded-[8px] hover:border-primary/40 hover:bg-primary/[0.03] transition-all active:scale-[0.97]"
                    title="Move to pipeline"
                  >
                    <Move className="w-3.5 h-3.5 text-muted-foreground" />
                    Pipeline
                  </button>
                </div>
              </div>

              {/* Messages */}
              {messagesLoading ? (
                <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                  Loading messages…
                </div>
              ) : (
                <MessageThread messages={messages} />
              )}

              {/* Reply */}
              <ReplyComposer
                conversationId={selectedConversationId}
                contactId={selectedConversation.contactId ?? selectedConversation.contact?.id ?? ""}
                defaultChannelType={
                  inboxTab === "Email" ? "TYPE_EMAIL"
                  : inboxTab === "SMS" ? "TYPE_SMS"
                  // TYPE_PHONE/TYPE_CALL are call-only channels; fall back to SMS
                  : (selectedConversation.type === "TYPE_PHONE" || selectedConversation.type === "TYPE_CALL")
                    ? "TYPE_SMS"
                    : selectedConversation.type
                }
              />
            </div>

            {/* Right: lead details sidebar */}
            <LeadDetailsSidebar
              contactId={selectedConversation.contactId ?? selectedConversation.contact?.id ?? ""}
              contactName={selectedConversation.fullName ?? selectedConversation.contact?.name ?? ""}
            />
          </>
        ) : (
          <InboxOverview conversations={conversations} onSelect={handleSelectConversation} />
        )}
      </div>
      </div>
      )}
      </div>
    </div>
  );
}
