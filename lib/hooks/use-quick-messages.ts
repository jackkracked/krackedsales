"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface QuickMessage {
  id: string;
  title: string | null;
  body: string;
  active: boolean;
  sortOrder: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const KEY = ["quick-messages"];

async function jsonOrThrow(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Request failed");
  return body;
}

/** All quick messages, ordered for display (sortOrder asc). */
export function useQuickMessages() {
  return useQuery<{ quickMessages: QuickMessage[] }>({
    queryKey: KEY,
    queryFn: () => fetch("/api/quick-messages").then(jsonOrThrow),
    staleTime: 30 * 1000,
  });
}

export function useCreateQuickMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title?: string; body: string }) =>
      fetch("/api/quick-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }).then(jsonOrThrow),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateQuickMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string; title?: string; body?: string; active?: boolean; sortOrder?: number }) =>
      fetch(`/api/quick-messages/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).then(jsonOrThrow),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteQuickMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetch(`/api/quick-messages/${id}`, { method: "DELETE" }).then(jsonOrThrow),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useReorderQuickMessages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      fetch("/api/quick-messages/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      }).then(jsonOrThrow),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onMutate: async (ids) => {
      // Optimistic reorder so the Settings list feels instant.
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<{ quickMessages: QuickMessage[] }>(KEY);
      if (prev) {
        const byId = new Map(prev.quickMessages.map((q) => [q.id, q]));
        const reordered = ids.map((id, i) => ({ ...(byId.get(id) as QuickMessage), sortOrder: i })).filter(Boolean);
        qc.setQueryData(KEY, { quickMessages: reordered });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
  });
}

/** The active quick messages shown in the composer popup (curated top N by sortOrder). */
export function topQuickMessages(all: QuickMessage[] | undefined, limit = 5): QuickMessage[] {
  return (all ?? []).filter((q) => q.active).slice(0, limit);
}
