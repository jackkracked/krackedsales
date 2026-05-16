"use client";

import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Activity } from "lucide-react";
import { formatActivitySentence, avatarColour, initials, type ActivityEvent } from "@/lib/activity/format";

interface ActivityTabProps {
  entityType: string;
  entityId: string;
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const colour = avatarColour(event.userName);
  const sentence = formatActivitySentence(event);
  const time = formatDistanceToNow(new Date(event.createdAt), { addSuffix: true });

  return (
    <div className="flex items-start gap-2.5 py-2 border-b border-border/50 last:border-0">
      {/* Avatar */}
      <div className={`shrink-0 w-6 h-6 rounded-full ${colour} flex items-center justify-center mt-0.5`}>
        <span className="text-[9px] font-bold text-white">{initials(event.userName)}</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-foreground leading-snug">
          <span className="font-semibold">{event.userName.split(" ")[0]}</span>
          {" "}{sentence}
        </p>
        {/* Note preview */}
        {(event.action === "note.created" || event.action === "note.updated") &&
          !!event.metadata?.note_preview && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {String(event.metadata.note_preview)}
          </p>
        )}
        {event.action === "call.dispositioned" && !!event.metadata?.outcome && (
          <span className="inline-block mt-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
            {String(event.metadata.outcome).replace(/_/g, " ")}
          </span>
        )}
        <p className="text-[11px] text-muted-foreground/60 mt-0.5">{time}</p>
      </div>
    </div>
  );
}

export function ActivityTab({ entityType, entityId }: ActivityTabProps) {
  const { data, isLoading } = useQuery<{ events: ActivityEvent[] }>({
    queryKey: ["activity", entityType, entityId],
    queryFn: () =>
      fetch(`/api/activity?entityType=${entityType}&entityId=${encodeURIComponent(entityId)}&limit=50`)
        .then((r) => r.json()),
    staleTime: 30 * 1000,
    enabled: !!entityId,
  });

  const events = data?.events ?? [];

  if (isLoading) {
    return (
      <div className="space-y-3 py-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-start gap-2.5 py-2">
            <div className="w-6 h-6 rounded-full bg-muted animate-pulse shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 bg-muted animate-pulse rounded w-3/4" />
              <div className="h-3 bg-muted animate-pulse rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Activity className="w-7 h-7 text-muted-foreground/30 mb-2" />
        <p className="text-sm text-muted-foreground">No activity yet</p>
      </div>
    );
  }

  return (
    <div className="py-1">
      {events.map((event) => (
        <ActivityRow key={event.id} event={event} />
      ))}
    </div>
  );
}
