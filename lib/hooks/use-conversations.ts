"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { GHLConversation, GHLMessage } from "@/lib/ghl/types";

export type ChannelFilter = "ALL" | "TYPE_SMS" | "TYPE_EMAIL" | "TYPE_INSTAGRAM" | "TYPE_FB" | "TYPE_TIKTOK";

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
      // GHL's server-side `type` filter is UNRELIABLE: conversations are often stored as
      // TYPE_PHONE regardless of the real channel (SMS, Instagram, Facebook, TikTok, Email), so
      // filtering by type server-side silently drops real conversations. We NEVER send it — we
      // fetch a full page and filter client-side by type/lastMessageType (below) instead.
      //
      // Always fetch the max page (100), for EVERY channel and both tabs, so that:
      //   • "All" is a true superset of "Unread" — both pull the same set, so Unread can never
      //     show more than All (the bug: Unread listed conversations All had never loaded), and
      //   • a single channel view (e.g. Instagram / Facebook) finds all of its recent
      //     conversations rather than only those inside the 25 most-recent across all channels
      //     (the bug: Instagram showed 2, Facebook showed 0).
      params.set("limit", "100");
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

      // Channel matching is done client-side (GHL's server type filter is unreliable). Match on
      // BOTH `type` and `lastMessageType` because GHL often keeps a conversation as TYPE_PHONE even
      // when the last message was Instagram/Facebook/etc. Accept known aliases per channel so a
      // Facebook/Instagram conversation is caught regardless of which string GHL uses.
      if (channel !== "ALL") {
        const normalise = (t: string | undefined) => (t ?? "").toUpperCase().replace(/^TYPE_/, "");
        const ALIASES: Record<string, string[]> = {
          TYPE_SMS: ["SMS"],
          TYPE_EMAIL: ["EMAIL"],
          TYPE_INSTAGRAM: ["INSTAGRAM", "IG"],
          TYPE_FB: ["FB", "FACEBOOK", "MESSENGER"],
          TYPE_TIKTOK: ["TIKTOK"],
        };
        const targets = new Set(ALIASES[channel] ?? [normalise(channel)]);
        convs = convs.filter(
          (c) =>
            targets.has(normalise(c.type)) ||
            targets.has(normalise((c as { lastMessageType?: string }).lastMessageType)),
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
    refetchInterval: 90 * 1000, // Pusher pushes new conversations/unread; poll is a slow drift-catch
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

export type BulkConversationAction = "read" | "unread" | "star" | "unstar" | "delete" | "restore";

/** Apply a bulk action to a cached conversation list, mirroring what the server will do, so the
 *  UI updates instantly. `isUnreadView` = the "Unread" tab's query, where a read item should drop. */
function applyBulkOptimistic(
  convs: GHLConversation[],
  ids: Set<string>,
  action: BulkConversationAction,
  isUnreadView: boolean,
): GHLConversation[] {
  switch (action) {
    case "read":
      return isUnreadView
        ? convs.filter((c) => !ids.has(c.id))
        : convs.map((c) => (ids.has(c.id) ? { ...c, unreadCount: 0 } : c));
    case "unread":
      return convs.map((c) => (ids.has(c.id) ? { ...c, unreadCount: Math.max(c.unreadCount ?? 0, 1) } : c));
    case "star":
      return convs.map((c) => (ids.has(c.id) ? { ...c, starred: true } : c));
    case "unstar":
      return convs.map((c) => (ids.has(c.id) ? { ...c, starred: false } : c));
    case "delete":
      return convs.filter((c) => !ids.has(c.id));
    case "restore":
      return convs;
    default:
      return convs;
  }
}

/**
 * GHL-style bulk actions on selected conversations (mark read/unread, star/unstar, delete/restore).
 * Optimistically updates every cached ["conversations", ...] list and rolls back on error, so the
 * inbox feels instant and never lies about state (a failed action snaps back + surfaces).
 */
export function useBulkConversationAction() {
  const queryClient = useQueryClient();
  return useMutation<
    { ok: boolean; action: BulkConversationAction; count: number },
    Error,
    { ids: string[]; action: BulkConversationAction },
    { snapshots: Array<[readonly unknown[], ConversationsResponse | undefined]> }
  >({
    mutationFn: async ({ ids, action }) => {
      const res = await fetch("/api/inbox/conversations/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Action failed");
      }
      return res.json();
    },
    onMutate: async ({ ids, action }) => {
      await queryClient.cancelQueries({ queryKey: ["conversations"] });
      const idSet = new Set(ids);
      const snapshots = queryClient.getQueriesData<ConversationsResponse>({ queryKey: ["conversations"] });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        const isUnreadView = key[2] === true; // ["conversations", channel, unreadOnly]
        queryClient.setQueryData(key, {
          ...data,
          conversations: applyBulkOptimistic(data.conversations ?? [], idSet, action, isUnreadView),
        });
      }
      return { snapshots };
    },
    onError: (_e, _v, ctx) => {
      ctx?.snapshots?.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      // The inbox may be rendering search results instead of the live list.
      queryClient.invalidateQueries({ queryKey: ["inbox-search"] });
    },
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
      queryClient.invalidateQueries({ queryKey: ["inbox-search"] });
    },
  });
}

export interface CrossChannelTarget {
  type: string;
  conversationId?: string;
}
export interface CrossChannelResult {
  type: string;
  channel: string;
  ok: boolean;
  error?: string;
}

/** Compose once, send to one or more channels via /api/inbox/send. Returns per-channel results. */
export function useCrossChannelSend() {
  const queryClient = useQueryClient();

  return useMutation<
    { results: CrossChannelResult[]; ok: boolean },
    Error,
    { contactId: string; message: string; subject?: string; html?: string; targets: CrossChannelTarget[]; attachments?: string[] }
  >({
    mutationFn: async ({ contactId, message, subject, html, targets, attachments }) => {
      const res = await fetch(`/api/inbox/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, message, subject, html, targets, attachments }),
      });
      const body = await res.json().catch(() => ({}));
      // The route returns per-channel results even on partial failure (502). Only throw when we
      // got no structured results at all (hard failure).
      if (!Array.isArray(body?.results)) {
        throw new Error(body?.error ?? "Failed to send message");
      }
      return body;
    },
    onSuccess: (_data, { targets }) => {
      for (const t of targets) {
        if (t.conversationId) queryClient.invalidateQueries({ queryKey: ["messages", t.conversationId] });
      }
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}
