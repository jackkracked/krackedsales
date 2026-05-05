"use client";

import { relativeTime } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
import type { GHLOpportunity, GHLPipeline } from "@/lib/ghl/types";
import { Mail, Phone } from "lucide-react";

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

export function PipelineListView({ pipeline, opportunities }: PipelineListViewProps) {
  const stageMap = Object.fromEntries(pipeline.stages.map((s) => [s.id, s.name]));

  return (
    <div className="bg-card border border-border rounded-[10px] flex flex-col h-full overflow-hidden">
      {/* Sticky table header */}
      <div className="grid grid-cols-[1fr_140px_140px_120px_100px] gap-4 px-4 py-2.5 border-b border-border bg-muted/30 shrink-0">
        {["Contact", "Stage", "Source", "Created", "Status"].map((h) => (
          <span key={h} className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
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

          return (
            <div
              key={opp.id}
              className="grid grid-cols-[1fr_140px_140px_120px_100px] gap-4 px-4 py-3 hover:bg-muted/20 transition-colors"
            >
              {/* Contact */}
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium text-foreground truncate">{name}</span>
                <div className="flex items-center gap-2 mt-0.5">
                  {opp.contact?.email && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Mail className="w-3 h-3" />
                      <span className="truncate max-w-[120px]">{opp.contact.email}</span>
                    </span>
                  )}
                  {opp.contact?.phone && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Phone className="w-3 h-3" />
                    </span>
                  )}
                </div>
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
  );
}
