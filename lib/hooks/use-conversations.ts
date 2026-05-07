"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { GHLConversation, GHLMessage } from "@/lib/ghl/types";

type ChannelFilter = "ALL" | "TYPE_SMS" | "TYPE_EMAIL" | "TYPE_INSTAGRAM" | "TYPE_FB";

interface ConversationsResponse {
  conversations: GHLConversation[];
}

interface MessagesResponse {
  messages: GHLMessage[];
}

export function useConversations(channel: ChannelFilter, unreadOnly = false) {
  return useQuery<ConversationsResponse>({
    queryKey: ["conversations", channel, unreadOnly],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (channel !== "ALL") params.set("type", channel);
      // Fetch more when filtering unread so we don't miss any
      params.set("limit", unreadOnly ? "100" : "25");
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
      // Normalise both sides to handle GHL returning "SMS" vs "TYPE_SMS" inconsistently.
      if (channel !== "ALL") {
        const normalise = (t: string | undefined) =>
          (t ?? "").toUpperCase().replace(/^TYPE_/, "");
        const target = normalise(channel);
        convs = convs.filter((c) => normalise(c.type) === target);
      }

      return { ...data, conversations: convs };
    },
    staleTime: 10 * 1000,
    refetchInterval: 15 * 1000,
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
    staleTime: 5 * 1000,
    refetchInterval: 10 * 1000,
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
