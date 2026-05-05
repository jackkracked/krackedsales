"use client";

import Pusher from "pusher-js";
import { createContext, useContext, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

const PusherContext = createContext<Pusher | null>(null);

export function usePusher() {
  return useContext(PusherContext);
}

export function PusherProvider({ children }: { children: React.ReactNode }) {
  const pusherRef = useRef<Pusher | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const pusherKey = process.env.NEXT_PUBLIC_PUSHER_KEY;
    const pusherCluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

    if (!pusherKey || !pusherCluster) return;

    const pusher = new Pusher(pusherKey, { cluster: pusherCluster });
    pusherRef.current = pusher;

    // GHL pipeline real-time
    const pipelineChannel = pusher.subscribe("ghl-pipeline");
    pipelineChannel.bind("opportunity.created", () => {
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
    });
    pipelineChannel.bind("opportunity.updated", () => {
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
    });

    // GHL inbox real-time
    const inboxChannel = pusher.subscribe("ghl-inbox");
    inboxChannel.bind("message.received", (data: { conversationId?: string }) => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      if (data?.conversationId) {
        queryClient.invalidateQueries({
          queryKey: ["messages", data.conversationId],
        });
      }
    });
    inboxChannel.bind("conversation.updated", () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    });

    // Meta inbox real-time
    const metaChannel = pusher.subscribe("meta-inbox");

    metaChannel.bind("message.received", (data: {
      senderId?: string;
      text?: string;
      timestamp?: number;
    }) => {
      // Immediately patch the conversation preview so the list updates
      // and the unread dot appears without waiting for the Meta API poll.
      if (data?.senderId && data?.text) {
        const newUpdatedAt = new Date(data.timestamp ?? Date.now()).toISOString();
        queryClient.setQueryData(
          ["meta-conversations"],
          (old: { conversations: Array<{ participantId: string; lastMessage: string; updatedAt: string }> } | undefined) => {
            if (!old?.conversations) return old;
            const patched = old.conversations.map((conv) =>
              conv.participantId === data.senderId
                ? { ...conv, lastMessage: data.text!, updatedAt: newUpdatedAt }
                : conv
            );
            // Bubble the updated conversation to the top
            patched.sort(
              (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
            );
            return { ...old, conversations: patched };
          }
        );
      }

      // Also kick off a full refetch to stay in sync
      queryClient.invalidateQueries({ queryKey: ["meta-conversations"] });
      queryClient.invalidateQueries({ queryKey: ["meta-messages"] });
    });

    metaChannel.bind("comment.received", () => {
      queryClient.invalidateQueries({ queryKey: ["comment-leads-inbox"] });
    });

    // ClickUp demos real-time
    const demosChannel = pusher.subscribe("demos");
    demosChannel.bind("task.updated", () => {
      queryClient.invalidateQueries({ queryKey: ["demos"] });
    });
    demosChannel.bind("task.created", () => {
      queryClient.invalidateQueries({ queryKey: ["demos"] });
    });

    return () => {
      pusher.unsubscribe("ghl-pipeline");
      pusher.unsubscribe("ghl-inbox");
      pusher.unsubscribe("meta-inbox");
      pusher.unsubscribe("demos");
      pusher.disconnect();
    };
  }, [queryClient]);

  return (
    <PusherContext.Provider value={pusherRef.current}>
      {children}
    </PusherContext.Provider>
  );
}
