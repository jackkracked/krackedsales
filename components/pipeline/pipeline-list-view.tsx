"use client";

import { useState } from "react";
import { relativeTime } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
import { Check } from "lucide-react";
import type { GHLOpportunity, GHLPipeline } from "@/lib/ghl/types";
import { OpportunityModal } from "./opportunity-modal";

interface PipelineListViewProps {
  pipeline: GHLPipeline;
  opportunities: GHLOpportunity[];
}

const STATUS_STYLES: Record<string, string> = {
  open: "bg-primary/10 text-primary",
  won: "bg-green-50 text-green-700",
  lost: "bg-red-50 text-red-700",
  abandoned: "bg-muted text-muted-foreground",
};

type OppTab = "overview" | "qualification" | "notes" | "messages";

export function PipelineListView({ pipeline, opportunities }: PipelineListViewProps) {
  const stageMap = Object.fromEntries(pipeline.stages.map((s) => [s.id, s.name]));

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openOpp, setOpenOpp] = useState<GHLOpportunity | null>(null);
  const [openOppTab, setOpenOppTab] = useState<OppTab>("overview");

  const allSelected = opportunities.length > 0 && opportunities.every((o) => selectedIds.has(o.id));

  function toggleAll() {
    setSelectedIds(allSelected
      ? new Set()
      : new Set(opportunities.map((o) => o.id))
    );
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleRowClick(opp: GHLOpportunity) {
    setOpenOpp(opp);
    setOpenOppTab("overview");
  }

  // Queue: selected contacts in their visible (table row) order
  const queueOpps: GHLOpportunity[] | undefined = selectedIds.size >= 2
    ? opportunities.filter((o) => selectedIds.has(o.id))
    : undefined;

  return (
    <>
      <div className="bg-card border border-border rounded-[10px] flex flex-col h-full overflow-hidden">
        {/* Sticky table header */}
        <div className="grid grid-cols-[32px_1fr_140px_140px_120px_100px] gap-4 px-4 py-2.5 border-b border-border bg-muted/30 shrink-0">
          {/* Select all checkbox */}
          <div className="flex items-center">
            <button
              onClick={toggleAll}
              className={cn(
                "w-4 h-4 rounded-[3px] flex items-center justify-center border transition-colors shrink-0",
                allSelected
                  ? "bg-primary border-primary"
                  : "bg-card border-border hover:border-primary/50"
              )}
              aria-label={allSelected ? "Deselect all" : "Select all"}
            >
              {allSelected && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
            </button>
          </div>
          {["Contact", "Stage", "Source", "Created", "Status"].map((h) => (
            <span key={h} className="text-xs font-medium text-muted-foreground uppercase tracking-wide self-center">
              {h}
            </span>
          ))}
        </div>

        {/* Scrollable rows */}
        <div className="divide-y divide-border overflow-y-auto flex-1">
          {opportunities.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No leads in this pipeline
            </div>
          )}
          {opportunities.map((opp) => {
            const name = opp.contact?.name ?? opp.name ?? "Unknown";
            const stageName = stageMap[opp.pipelineStageId] ?? "Unknown";
            const source = opp.source ?? "—";
            const isSelected = selectedIds.has(opp.id);

            return (
              <div
                key={opp.id}
                onClick={() => handleRowClick(opp)}
                className={cn(
                  "group grid grid-cols-[32px_1fr_140px_140px_120px_100px] gap-4 px-4 py-3 cursor-pointer transition-colors",
                  isSelected
                    ? "bg-primary/[0.03]"
                    : "hover:bg-muted/20"
                )}
              >
                {/* Checkbox */}
                <div
                  className="flex items-center"
                  onClick={(e) => { e.stopPropagation(); toggleOne(opp.id); }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <div className={cn(
                    "w-4 h-4 rounded-[3px] flex items-center justify-center border transition-colors",
                    isSelected
                      ? "bg-primary border-primary opacity-100"
                      : "bg-card border-border opacity-0 group-hover:opacity-100 hover:border-primary/50"
                  )}>
                    {isSelected && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                  </div>
                </div>

                {/* Contact */}
                <div className="flex flex-col min-w-0 self-center">
                  <span className="text-sm font-medium text-foreground truncate">{name}</span>
                  {opp.contact?.email && (
                    <span className="text-xs text-muted-foreground truncate mt-0.5">{opp.contact.email}</span>
                  )}
                </div>

                {/* Stage */}
                <span className="text-sm text-foreground self-center truncate">{stageName}</span>

                {/* Source */}
                <span className="text-sm text-muted-foreground self-center truncate">{String(source)}</span>

                {/* Created */}
                <span className="text-sm text-muted-foreground self-center">
                  {relativeTime(opp.createdAt)}
                </span>

                {/* Status */}
                <div className="self-center">
                  <span className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize",
                    STATUS_STYLES[opp.status] ?? "bg-muted text-muted-foreground"
                  )}>
                    {opp.status}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selection bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2.5 bg-card border border-border rounded-[10px] shadow-lg">
          <span className="text-sm font-medium text-foreground tabular-nums">
            {selectedIds.size} selected
          </span>
          <div className="w-px h-4 bg-border" />
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {openOpp && (
        <OpportunityModal
          opportunity={openOpp}
          stageName={stageMap[openOpp.pipelineStageId] ?? "Unknown"}
          onClose={() => setOpenOpp(null)}
          initialTab={openOppTab}
          queue={queueOpps}
          queueIndex={queueOpps ? queueOpps.findIndex((o) => o.id === openOpp.id) : undefined}
          onNavigate={(i) => {
            if (queueOpps) {
              setOpenOpp(queueOpps[i]);
              setOpenOppTab("overview");
            }
          }}
        />
      )}
    </>
  );
}
