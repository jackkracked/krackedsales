"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Activity, ChevronDown } from "lucide-react";
import { formatActivitySentence, avatarColour, initials, type ActivityEvent } from "@/lib/activity/format";

interface RepOption {
  id: string;
  name: string;
  email: string;
}

interface ActivityFeedProps {
  reps: RepOption[];
  currentUserRole: string;
}

const ACTION_LABELS: Record<string, string> = {
  "opportunity.created": "Lead Added",
  "lead.added": "Lead Added",
  "opportunity.stage_changed": "Stage Changed",
  "note.created": "Note Added",
  "note.updated": "Note Updated",
  "call.dispositioned": "Call Logged",
  "proposal.created": "Proposal Created",
  "proposal.sent": "Proposal Sent",
  "proposal.signed": "Proposal Signed",
  "message.sent": "Message Sent",
  "template.sent": "Template Sent",
  "task.created": "Task Created",
  "task.completed": "Task Completed",
  "demo.started": "Demo Started",
  "follow_up.sent": "Follow-up Sent",
};

function ActivityRow({ event }: { event: ActivityEvent }) {
  const colour = avatarColour(event.userName);
  const sentence = formatActivitySentence(event);
  const time = formatDistanceToNow(new Date(event.createdAt), { addSuffix: true });

  return (
    <div className="flex items-start gap-4 px-5 py-3.5 border-b border-border/40 hover:bg-muted/20 transition-colors">
      {/* Avatar */}
      <div className={`shrink-0 w-8 h-8 rounded-full ${colour} flex items-center justify-center mt-0.5`}>
        <span className="text-[11px] font-bold text-white">{initials(event.userName)}</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground leading-snug">
          <span className="font-semibold">{event.userName}</span>
          {" "}{sentence}
        </p>
        {(event.action === "note.created" || event.action === "note.updated") &&
          !!event.metadata?.note_preview && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
            &ldquo;{String(event.metadata.note_preview)}&rdquo;
          </p>
        )}
        {event.action === "opportunity.stage_changed" && !!event.metadata?.from_stage && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {String(event.metadata.from_stage)} &rarr; {String(event.metadata.to_stage ?? "")}
          </p>
        )}
      </div>

      {/* Action type chip */}
      <span className="shrink-0 text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full hidden sm:inline-block">
        {ACTION_LABELS[event.action] ?? event.action}
      </span>

      {/* Timestamp */}
      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums mt-0.5 min-w-[72px] text-right">{time}</span>
    </div>
  );
}

export function ActivityFeed({ reps, currentUserRole }: ActivityFeedProps) {
  const isAdmin = currentUserRole === "admin";
  const [selectedUserId, setSelectedUserId] = useState<string>("all");
  const [selectedAction, setSelectedAction] = useState<string>("all");

  function buildUrl() {
    const params = new URLSearchParams({ limit: "50" });
    if (selectedUserId !== "all") params.set("userId", selectedUserId);
    if (selectedAction !== "all") params.set("action", selectedAction);
    return `/api/activity?${params}`;
  }

  const { data, isLoading } = useQuery<{ events: ActivityEvent[] }>({
    queryKey: ["activity-feed", selectedUserId, selectedAction],
    queryFn: () => fetch(buildUrl()).then((r) => r.json()),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  const events = data?.events ?? [];

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border bg-card shrink-0 flex-wrap">
        {/* Rep filter — admin only */}
        {isAdmin && (
          <div className="relative">
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="appearance-none pl-3 pr-7 py-1.5 text-xs font-medium border border-border rounded-[7px] bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary cursor-pointer"
            >
              <option value="all">All reps</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>{r.name.split(" ")[0]}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
          </div>
        )}

        {/* Action type filter */}
        <div className="relative">
          <select
            value={selectedAction}
            onChange={(e) => setSelectedAction(e.target.value)}
            className="appearance-none pl-3 pr-7 py-1.5 text-xs font-medium border border-border rounded-[7px] bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary cursor-pointer"
          >
            <option value="all">All actions</option>
            {Object.entries(ACTION_LABELS).filter(([k]) => k !== "lead.added").map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
        </div>

        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {events.length} event{events.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-0">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex items-start gap-4 px-5 py-3.5 border-b border-border/40">
                <div className="w-8 h-8 rounded-full bg-muted animate-pulse shrink-0 mt-0.5" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-muted animate-pulse rounded w-3/4" />
                  <div className="h-3 bg-muted animate-pulse rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Activity className="w-8 h-8 text-muted-foreground/30 mb-2" />
            <p className="text-sm font-medium text-foreground">No activity yet</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Actions across the app will appear here.
            </p>
          </div>
        ) : (
          events.map((event) => (
            <ActivityRow key={event.id} event={event} />
          ))
        )}
      </div>
    </div>
  );
}
