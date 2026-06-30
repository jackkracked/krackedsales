"use client";

import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Activity } from "lucide-react";
import { formatActivitySentence, avatarColour, initials, type ActivityEvent } from "@/lib/activity/format";
import { outcomeMeta, OUTCOME_TONES } from "@/lib/activity/outcomes";

interface ActivityTabProps {
  entityType: string;
  entityId: string;
  /** When set, call outcomes for this contact are merged into the feed. */
  contactId?: string;
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const colour = avatarColour(event.userName);
  const sentence = formatActivitySentence(event);
  const time = formatDistanceToNow(new Date(event.createdAt), { addSuffix: true });

  return (
    <div data-r10n-activity-row className="flex items-start gap-2.5 py-2 border-b border-border/50 last:border-0">
      {/* Avatar */}
      <div
        data-r10n-activity-avatar
        className={`shrink-0 w-6 h-6 rounded-full ${colour} flex items-center justify-center mt-0.5`}
      >
        <span className="text-[9px] font-bold text-white">{initials(event.userName)}</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p data-r10n-activity-sentence className="text-[13px] text-foreground leading-snug">
          <span data-r10n-activity-actor className="font-semibold">{event.userName.split(" ")[0]}</span>
          {" "}{sentence}
        </p>
        {/* Note preview */}
        {(event.action === "note.created" || event.action === "note.updated") &&
          !!event.metadata?.note_preview && (
          <p data-r10n-activity-detail className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {String(event.metadata.note_preview)}
          </p>
        )}
        {event.action === "call.dispositioned" && !!event.metadata?.outcome && (() => {
          const meta = outcomeMeta(String(event.metadata.outcome));
          return (
            <span
              data-r10n-activity-outcome
              data-tone={meta.tone}
              className={`inline-block mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${OUTCOME_TONES[meta.tone].pill}`}
            >
              {meta.label}
            </span>
          );
        })()}
        <p data-r10n-activity-time className="text-[11px] text-muted-foreground/60 mt-0.5">{time}</p>
      </div>
    </div>
  );
}

export function ActivityTab({ entityType, entityId, contactId }: ActivityTabProps) {
  const { data, isLoading } = useQuery<{ events: ActivityEvent[] }>({
    queryKey: ["activity", entityType, entityId, contactId ?? null],
    queryFn: () => {
      const params = new URLSearchParams({ entityType, entityId, limit: "50" });
      if (contactId) params.set("contactId", contactId);
      return fetch(`/api/activity?${params}`).then((r) => r.json());
    },
    staleTime: 30 * 1000,
    enabled: !!entityId,
  });

  const events = data?.events ?? [];

  if (isLoading) {
    return (
      <div className="space-y-3 py-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-start gap-2.5 py-2">
            <div data-r10n-activity-skeleton className="w-6 h-6 rounded-full bg-muted animate-pulse shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1.5">
              <div data-r10n-activity-skeleton className="h-3.5 bg-muted animate-pulse rounded w-3/4" />
              <div data-r10n-activity-skeleton className="h-3 bg-muted animate-pulse rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Activity data-r10n-activity-empty-icon className="w-7 h-7 text-muted-foreground/30 mb-2" />
        <p data-r10n-activity-empty-sub className="text-sm text-muted-foreground">No activity yet</p>
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
