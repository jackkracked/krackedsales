"use client";

import { cn } from "@/lib/utils/cn";

interface HistoryMessage {
  source: "db" | "ghl";
  direction: "inbound" | "outbound";
  daysAgo: number;
  preview: string;
  angle: string | null;
  channel: string;
}

interface Props {
  messages: HistoryMessage[];
}

export function FollowUpHistory({ messages }: Props) {
  if (messages.length === 0) {
    return (
      <p className="text-xs text-muted-foreground/60 italic">
        No messages sent yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {messages.map((msg, i) => (
        <div
          key={i}
          className={cn(
            "rounded-[8px] px-3 py-2.5 border text-xs",
            msg.direction === "inbound"
              ? "bg-blue-50 border-blue-100 text-blue-900"
              : "bg-muted/40 border-border text-foreground"
          )}
        >
          <div className="flex items-center justify-between mb-1 gap-2">
            <span className="font-medium text-muted-foreground">
              {msg.direction === "inbound" ? "Them" : "You"}
              {msg.angle && (
                <span className="ml-1.5 text-muted-foreground/50 font-normal">
                  · {msg.angle.replace(/_/g, " ")}
                </span>
              )}
            </span>
            <span className="text-muted-foreground/50 shrink-0">
              {msg.daysAgo === 0 ? "today" : `${msg.daysAgo}d ago`}
            </span>
          </div>
          <p className="text-foreground leading-relaxed line-clamp-2">{msg.preview}</p>
        </div>
      ))}
    </div>
  );
}
