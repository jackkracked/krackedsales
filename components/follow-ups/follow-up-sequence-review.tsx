"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { FollowUpMessageEditor } from "./follow-up-message-editor";

interface SequenceMessage {
  subject?: string;
  body: string;
  channel: string;
  delayDays: number;
  angle: string;
}

interface Props {
  messages: SequenceMessage[];
  onChange: (messages: SequenceMessage[]) => void;
}

export function FollowUpSequenceReview({ messages, onChange }: Props) {
  const [expanded, setExpanded] = useState<number | null>(0);

  function updateMessage(index: number, body: string, subject?: string) {
    const next = messages.map((m, i) =>
      i === index ? { ...m, body, subject: subject ?? m.subject } : m
    );
    onChange(next);
  }

  return (
    <div className="space-y-2">
      {messages.map((msg, i) => {
        const isExpanded = expanded === i;
        const dayLabel =
          msg.delayDays === 0
            ? "Today"
            : `Day ${msg.delayDays}`;

        return (
          <div
            key={i}
            data-r10n-followup-seqstep
            data-expanded={isExpanded}
            className={cn(
              "rounded-[8px] border transition-colors",
              isExpanded ? "border-primary/40 bg-background" : "border-border bg-muted/20"
            )}
          >
            {/* Header row */}
            <button
              onClick={() => setExpanded(isExpanded ? null : i)}
              className="w-full flex items-center justify-between px-3 py-2.5 text-left"
            >
              <div className="flex items-center gap-2">
                <span data-r10n-followup-seqnum className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                  {i + 1}
                </span>
                <span data-r10n-followup-seqday className="text-xs font-medium text-foreground">{dayLabel}</span>
                {!isExpanded && (
                  <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                    · {msg.body.slice(0, 50)}…
                  </span>
                )}
              </div>
              {isExpanded ? (
                <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              )}
            </button>

            {/* Expanded editor */}
            {isExpanded && (
              <div className="px-3 pb-3">
                <FollowUpMessageEditor
                  body={msg.body}
                  subject={msg.subject}
                  channel={msg.channel}
                  onChange={(body, subject) => updateMessage(i, body, subject)}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
