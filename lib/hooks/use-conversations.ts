"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { GHLConversation, GHLMessage } from "@/lib/ghl/types";

type ChannelFilter = "ALL" | "TYPE_SMS" | "TYPE_EMAIL" | "TYPE_INSTAGRAM" | "TYPE_FB" | "TYPE_TIKTOK";

interface ConversationsResponse {
  conversations: GHLConversation[];
}

interface MessagesResponse {
  messages: GHLMessage[];
}

// ─── localStorage cache helpers ───────────────────────────────────────────────
// Shows last-known conversations instantly on mount while the fresh fetch runs
// in the background — eliminates the "Loading…" blank state after cold starts.

function cacheKey(channel: ChannelFilter) {
  return `ghl-convs-v1-${channel}`;
}

function readCache(channel: ChannelFilter): ConversationsResponse | undefined {
  try {
    const raw = localStorage.getItem(cacheKey(channel));
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function readCacheTimestamp(channel: ChannelFilter): number {
  try {
    const ts = localStorage.getItem(`${cacheKey(channel)}-ts`);
    return ts ? parseInt(ts, 10) : 0;
  } catch {
    return 0;
  }
}

function writeCache(channel: ChannelFilter, data: ConversationsResponse) {
  try {
    localStorage.setItem(cacheKey(channel), JSON.stringify(data));
    localStorage.setItem(`${cacheKey(channel)}-ts`, Date.now().toString());
  } catch {}
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useConversations(channel: ChannelFilter, unreadOnly = false) {
  return useQuery<ConversationsResponse>({
    queryKey: ["conversations", channel, unreadOnly],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (channel !== "ALL") params.set("type", channel);
      // Email and TikTok convs often live under TYPE_PHONE in GHL — fetch more to catch them
      const needsBigFetch = unreadOnly || channel === "TYPE_EMAIL" || channel === "TYPE_TIKTOK";
      params.set("limit", needsBigFetch ? "100" : "25");
      const res = await fetch(`/api/ghl/conversations?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();

      let convs: Array<{ unreadCount?: number; type?: string }> = data.conversations ?? [];

      // GHL's unreadOnly param is unreliable — filter client-side
      if (unreadOnly) {
        convs = convs.filter((c) => (c.unreadCount ?? 0) > 0);
      }

      // GHL's type filter may return wrong results — apply client-side too.
      // Also check lastMessageType because GHL often keeps conversations as TYPE_PHONE
      // even when the last message was email or TikTok.
      if (channel !== "ALL") {
        const normalise = (t: string | undefined) =>
          (t ?? "").toUpperCase().replace(/^TYPE_/, "");
        const target = normalise(channel);
        convs = convs.filter(
          (c) =>
            normalise(c.type) === target ||
            normalise((c as { lastMessageType?: string }).lastMessageType) === target
        );
      }

      const result: ConversationsResponse = { ...data, conversations: convs };

      // Cache the "all conversations" view (not filtered unread) so the list
      // loads instantly on next mount even before the network request completes.
      if (!unreadOnly) {
        writeCache(channel, result);
      }

      return result;
    },
    // Use cached data as initial data so the list renders immediately
    initialData: !unreadOnly ? () => readCache(channel) : undefined,
    initialDataUpdatedAt: !unreadOnly ? () => readCacheTimestamp(channel) : undefined,
    staleTime: 30 * 1000,
    refetchInterval: 20 * 1000,
  });
}

export function useMessages(conversationId: string | null) {
  return useQuery<MessagesResponse>({
    queryKey: ["messages", conversationId],
    queryFn: async () => {
      const res = await fetch(`/api/ghl/conversations/${conversationId}/messages`);
      if (!res.ok) throw new Error("Failed to fetch messages");
      return res.json();
    },
    enabled: !!conversationId,
    staleTime: 10 * 1000,
    refetchInterval: 15 * 1000,
  });
}

export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      conversationId,
      message,
      type,
      contactId,
    }: {
      conversationId: string;
      message: string;
      type: string;
      contactId: string;
    }) => {
      const res = await fetch(`/api/ghl/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, type, contactId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to send message");
      }
      return res.json();
    },
    onSuccess: (_, { conversationId }) => {
      queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}
