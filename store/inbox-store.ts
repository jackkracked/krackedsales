"use client";

import { create } from "zustand";

interface InboxStore {
  selectedConversationId: string | null;
  replyDraft: Record<string, string>; // conversationId -> draft text
  setSelectedConversationId: (id: string | null) => void;
  setReplyDraft: (conversationId: string, text: string) => void;
  clearReplyDraft: (conversationId: string) => void;
}

export const useInboxStore = create<InboxStore>()((set) => ({
  selectedConversationId: null,
  replyDraft: {},
  setSelectedConversationId: (id) => set({ selectedConversationId: id }),
  setReplyDraft: (conversationId, text) =>
    set((s) => ({ replyDraft: { ...s.replyDraft, [conversationId]: text } })),
  clearReplyDraft: (conversationId) =>
    set((s) => {
      const draft = { ...s.replyDraft };
      delete draft[conversationId];
      return { replyDraft: draft };
    }),
}));
