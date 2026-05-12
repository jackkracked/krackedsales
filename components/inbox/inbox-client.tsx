"use client";

import { useState } from "react";
import { useConversations, useMessages } from "@/lib/hooks/use-conversations";
import { useInboxStore } from "@/store/inbox-store";
import { ConversationList } from "./conversation-list";
import { MessageThread } from "./message-thread";
import { ReplyComposer } from "./reply-composer";
import type { ChannelFilter } from "./channel-filter-pills";
import { MetaConversations } from "./meta-conversations";
import { TikTokConversations } from "./tiktok-conversations";
import { LeadDetailsSidebar } from "./lead-details-sidebar";
import { RefreshCw, ArrowLeft, Move, Inbox } from "lucide-react";
import { TikTokIcon } from "@/components/shared/channel-icon";
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
  { key: "GHL", label: "GHL" },
  { key: "Meta", label: "Meta" },
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
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Top-level tab switcher ── */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1 w-fit">
          {INBOX_TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setInboxTab(key)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                inboxTab === key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {Icon && <Icon className="w-3 h-3" />}
              {label}
            </button>
          ))}
        </div>
      </div>

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
        <div className="px-4 py-3 border-b border-border space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
              Inbox
            </h2>
            <div className="flex items-center gap-1.5">
              {isFetching && <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
              {/* Unread / All toggle */}
              <div className="flex items-center bg-muted rounded-lg p-0.5">
                <button
                  onClick={() => setUnreadOnly(true)}
                  className={cn(
                    "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                    unreadOnly
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Unread
                </button>
                <button
                  onClick={() => setUnreadOnly(false)}
                  className={cn(
                    "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                    !unreadOnly
                      ? "bg-card text-foreground shadow-sm"
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
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {selectedConversation.fullName ?? selectedConversation.contact?.name ?? "Unknown"}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {selectedConversation.contact?.email ?? selectedConversation.email ?? selectedConversation.contact?.phone ?? selectedConversation.phone ?? ""}
                  </p>
                </div>
                <div className="ml-auto">
                  <button
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-foreground border border-border rounded-[7px] hover:bg-muted transition-colors"
                    title="Move to pipeline"
                  >
                    <Move className="w-3 h-3" />
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
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2 bg-background">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <RefreshCw className="w-5 h-5" />
            </div>
            <p className="text-sm">Select a conversation</p>
          </div>
        )}
      </div>
      </div>
      )}
    </div>
  );
}
