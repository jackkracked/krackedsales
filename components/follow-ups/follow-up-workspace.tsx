"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { FollowUpItem } from "./follow-up-contact-card";
import { FollowUpRecommendation } from "./follow-up-recommendation";
import { FollowUpHistory } from "./follow-up-history";
import { WorkspaceEmpty } from "./follow-up-empty";

const ZONE_LABELS: Record<number, { label: string; className: string }> = {
  1: { label: "Demo Sent", className: "bg-blue-50 text-blue-700" },
  2: { label: "No-Show", className: "bg-amber-50 text-amber-700" },
  3: { label: "Sale In Progress", className: "bg-purple-50 text-purple-700" },
  4: { label: "Unresponsive", className: "bg-orange-50 text-orange-700" },
};

interface ContextData {
  conversationId: string | null;
  channel: string;
  hasEverReplied: boolean;
  messageHistory: Array<{
    source: "db" | "ghl";
    direction: "inbound" | "outbound";
    daysAgo: number;
    preview: string;
    angle: string | null;
    channel: string;
  }>;
  recommendation: {
    id: string;
    type: string;
    reasoning: string;
    messages: unknown;
    status: string;
  } | null;
}

interface Props {
  item: FollowUpItem | null;
  onSent: (oppId: string) => void;
  onSkipped: (oppId: string) => void;
  onRemoved: (oppId: string) => void;
}

export function FollowUpWorkspace({ item, onSent, onSkipped, onRemoved }: Props) {
  const [activeRec, setActiveRec] = useState<ContextData["recommendation"] | null>(null);

  // Reset active rec when item changes
  useEffect(() => {
    setActiveRec(null);
  }, [item?.oppId]);

  const { data: ctx, isLoading } = useQuery<ContextData>({
    queryKey: ["followup-context", item?.contactId, item?.oppId],
    queryFn: async () => {
      if (!item) throw new Error("No item");
      const params = new URLSearchParams({
        oppId: item.oppId,
        stageName: item.stageName,
        daysSince: String(item.daysSinceLastContact),
        contactName: item.contactName,
      });
      const res = await fetch(
        `/api/follow-ups/${item.contactId}/context?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to load context");
      return res.json();
    },
    enabled: !!item,
    staleTime: 2 * 60 * 1000,
    retry: false,
  });

  // Sync rec from context into local state
  useEffect(() => {
    if (ctx?.recommendation && !activeRec) {
      setActiveRec(ctx.recommendation);
    }
  }, [ctx?.recommendation]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) return <WorkspaceEmpty />;

  const zone = ZONE_LABELS[item.zone];
  const channel = ctx?.channel ?? item.channel;
  const conversationId = ctx?.conversationId ?? null;

  async function handleRemove() {
    if (!item) return;
    await fetch(`/api/follow-ups/${item.contactId}/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oppId: item.oppId }),
    });
    onRemoved(item.oppId);
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Contact header */}
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold text-foreground leading-tight">
                {item.contactName}
              </h2>
              <span
                className={cn(
                  "inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium",
                  zone.className
                )}
              >
                {zone.label}
              </span>
              {item.zone === 3 && (
                <span className="text-xs text-amber-600 font-medium">⚠ Handle carefully</span>
              )}
            </div>
            {item.pipelineName && (
              <p className="text-xs text-muted-foreground mt-0.5">{item.pipelineName}</p>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 mt-3">
          <StatCell label="In Stage" value={`${item.daysInStage}d`} />
          <StatCell
            label="Last Contact"
            value={
              item.daysSinceLastContact === 0
                ? "Today"
                : `${item.daysSinceLastContact}d ago`
            }
          />
          <StatCell label="Channel" value={channel} />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 px-5 py-4 space-y-5">
        {/* Message history — always shown */}
        <section>
          <SectionLabel>Message History</SectionLabel>
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
              <RefreshCw className="w-3 h-3 animate-spin" />
              Loading history…
            </div>
          ) : ctx && ctx.messageHistory.length > 0 ? (
            <FollowUpHistory messages={ctx.messageHistory} />
          ) : (
            <p className="text-xs text-muted-foreground py-2">
              No message history found for this contact.
            </p>
          )}
        </section>

        {/* AI Recommendation */}
        <section>
          <SectionLabel>AI Recommendation</SectionLabel>

          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              Thinking…
            </div>
          ) : activeRec ? (
            <FollowUpRecommendation
              recommendation={activeRec as Parameters<typeof FollowUpRecommendation>[0]["recommendation"]}
              contactId={item.contactId}
              oppId={item.oppId}
              stageName={item.stageName}
              daysSince={item.daysSinceLastContact}
              contactName={item.contactName}
              website={null}
              channel={channel}
              conversationId={conversationId}
              onSent={() => onSent(item.oppId)}
              onSkipped={() => onSkipped(item.oppId)}
              onRemoved={handleRemove}
              onRegenerate={(newRec) => setActiveRec(newRec)}
            />
          ) : (
            <div className="rounded-[10px] border border-border bg-muted/10 px-4 py-6 text-center">
              <p className="text-xs text-muted-foreground">
                Could not generate a recommendation. The AI may be unavailable.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] bg-muted/30 px-2.5 py-2">
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm font-semibold text-foreground truncate">{value}</p>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
      {children}
    </p>
  );
}
