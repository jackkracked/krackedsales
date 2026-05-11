"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { differenceInDays } from "date-fns";
import { Flame, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { OpportunityModal } from "@/components/pipeline/opportunity-modal";
import type { GHLOpportunity } from "@/lib/ghl/types";

export interface PipelineOpp {
  id: string;
  name: string;
  contactName: string;
  monetaryValue: number;
  status: string;
  pipelineStageId: string;
  updatedAt: string;
}

interface GoingColdWidgetProps {
  opps: PipelineOpp[];
  isLoading: boolean;
}

function DaysBadge({ days }: { days: number }) {
  const label = days === 1 ? "1d" : `${days}d`;
  const cls =
    days >= 14
      ? "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400"
      : days >= 7
      ? "bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400"
      : "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400";

  return (
    <span
      className={cn(
        "text-[10px] font-semibold px-1.5 py-0.5 rounded-[4px] tabular-nums shrink-0",
        cls
      )}
    >
      {label}
    </span>
  );
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function GoingColdWidget({ opps, isLoading }: GoingColdWidgetProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Fetch full opportunity only when a row is clicked — powers the modal
  const { data: fullOpp } = useQuery<GHLOpportunity>({
    queryKey: ["opp-detail", selectedId],
    queryFn: () =>
      fetch(`/api/ghl/opportunities/${selectedId}`).then((r) => r.json()),
    enabled: !!selectedId,
    staleTime: 60 * 1000,
  });

  // Open opps silent for 3+ days, sorted stalest first
  const stale = opps
    .filter((o) => o.status === "open")
    .map((o) => ({
      ...o,
      days: differenceInDays(new Date(), new Date(o.updatedAt)),
    }))
    .filter((o) => o.days >= 3)
    .sort((a, b) => b.days - a.days)
    .slice(0, 8);

  return (
    <>
      <div className="bg-card border border-border rounded-[10px] overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-orange-500 shrink-0" />
            <h3
              className="text-sm font-semibold text-foreground"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Going Cold
            </h3>
          </div>
          {!isLoading && stale.length > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {stale.length} stale
            </span>
          )}
        </div>

        <div className="divide-y divide-border max-h-64 overflow-y-auto">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="px-4 py-3 flex items-center justify-between gap-3"
              >
                <div className="space-y-1.5 flex-1">
                  <div className="h-3 bg-muted/60 rounded animate-pulse w-32" />
                  <div className="h-2.5 bg-muted/40 rounded animate-pulse w-20" />
                </div>
                <div className="h-5 bg-muted/40 rounded animate-pulse w-8" />
              </div>
            ))
          ) : stale.length === 0 ? (
            <div className="px-4 py-6 flex flex-col items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              <p className="text-xs text-muted-foreground text-center">
                All caught up — no stale deals
              </p>
            </div>
          ) : (
            stale.map((opp) => (
              <button
                key={opp.id}
                onClick={() => setSelectedId(opp.id)}
                className="px-4 py-3 flex items-center justify-between gap-3 w-full text-left hover:bg-muted/30 transition-colors"
              >
                <p className="text-sm font-medium text-foreground truncate leading-tight min-w-0">
                  {opp.contactName || opp.name || "Unnamed"}
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  {opp.monetaryValue > 0 && (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {formatCurrency(opp.monetaryValue)}
                    </span>
                  )}
                  <DaysBadge days={opp.days} />
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {fullOpp && (
        <OpportunityModal
          opportunity={fullOpp}
          stageName={fullOpp.pipelineStageId_name ?? ""}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  );
}
