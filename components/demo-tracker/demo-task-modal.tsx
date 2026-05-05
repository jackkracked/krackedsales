"use client";

import { useEffect, useState } from "react";
import { X, ExternalLink, Clock, RefreshCw, TrendingUp, Globe } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { getStageBadge, getStageRiskDays } from "@/lib/utils/demo-stage";
import { OpportunityModal } from "@/components/pipeline/opportunity-modal";
import type { EnrichedTask } from "@/app/api/clickup/tasks/route";
import type { GHLOpportunity } from "@/lib/ghl/types";

function MiroLogo({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M21.6632 -0.000366211H78.3368C90.293 -0.000366211 100 9.70665 100 21.6628V78.3364C100 90.2926 90.293 99.9996 78.3368 99.9996H21.6632C9.70702 99.9996 0 90.2926 0 78.3364V21.6628C0 9.70665 9.70702 -0.000366211 21.6632 -0.000366211Z" fill="#FFD02F"/>
      <path d="M69.488 12.4886H58.5084L67.6531 28.5584L47.5288 12.4886H36.5492L46.6114 32.1393L25.5697 12.4886H14.5901L25.5697 37.496L14.5901 87.5107H25.5697L46.6114 33.915L36.5492 87.5107H47.5288L67.6531 30.3637L58.5084 87.5107H69.488L89.6123 24.9775L69.488 12.4886Z" fill="#050038"/>
    </svg>
  );
}

interface DemoTaskModalProps {
  task: EnrichedTask;
  onClose: () => void;
}

export function DemoTaskModal({ task, onClose }: DemoTaskModalProps) {
  const badge = getStageBadge(task.status);
  const isDemoSent = task.bucket === "DEMO_SENT";
  const isAtRisk = !isDemoSent && task.daysInStage > getStageRiskDays(task.status);

  const [opportunity, setOpportunity] = useState<GHLOpportunity | null>(null);
  const [loadingOpp, setLoadingOpp] = useState(false);
  const [oppModal, setOppModal] = useState(false);
  const [resolvedDomain, setResolvedDomain] = useState<string | null>(null);

  useEffect(() => {
    if (!task.id) return;

    // Use Brand Hub URL if set; otherwise fall back to the brand name extracted from the
    // task name (format: "BrandName: Email Demo"). The by-domain endpoint searches GHL
    // contacts by either domain or plain text name, so both work.
    const searchTerm = task.brandHubUrl ?? (
      task.name.includes(": ") ? task.name.split(": ")[0].trim() : null
    );

    if (!searchTerm) {
      setLoadingOpp(false);
      setOpportunity(null);
      return;
    }

    setLoadingOpp(true);
    setResolvedDomain(searchTerm);

    fetch(`/api/ghl/opportunities/by-domain?domain=${encodeURIComponent(searchTerm)}`)
      .then((r) => r.json())
      .then((data) => setOpportunity(data.opportunity ?? null))
      .catch(() => setOpportunity(null))
      .finally(() => setLoadingOpp(false));
  }, [task.id, task.brandHubUrl, task.name]);

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: "rgba(0,0,0,0.4)" }}
        onClick={onClose}
      >
        <div
          className="bg-card border border-border rounded-[12px] w-full max-w-sm shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between px-5 py-4 border-b border-border">
            <div className="flex-1 min-w-0 pr-3">
              <p className="text-sm font-semibold text-foreground leading-snug">{task.name}</p>
              <span className={cn(
                "inline-flex items-center mt-1.5 px-2 py-0.5 rounded-full text-xs font-medium",
                badge.className
              )}>
                {badge.label}
              </span>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 p-1 rounded-[6px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Details */}
          <div className="px-5 py-4 space-y-4">
            {/* Days in stage */}
            {!isDemoSent && (
              <div className="flex items-center gap-1.5">
                <Clock className={cn("w-3.5 h-3.5", isAtRisk ? "text-destructive" : "text-muted-foreground")} />
                <span className={cn("text-sm", isAtRisk ? "text-destructive font-medium" : "text-muted-foreground")}>
                  {task.daysInStage === 0 ? "Started today" : `Day ${task.daysInStage} in this stage`}
                  {isAtRisk && " ⚠"}
                </span>
              </div>
            )}

            {/* Website URL */}
            {task.brandHubUrl && (
              <div className="flex items-start gap-1.5">
                <Globe className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                <a
                  href={task.brandHubUrl.startsWith("http") ? task.brandHubUrl : `https://${task.brandHubUrl}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline break-all"
                >
                  {task.brandHubUrl}
                </a>
              </div>
            )}

            {/* Links row */}
            <div className="flex items-center gap-3">
              <a
                href={task.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open in ClickUp
              </a>
              {task.miroUrl && (
                <a
                  href={task.miroUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <MiroLogo size={14} />
                  Miro Board
                </a>
              )}
            </div>

            {/* Linked opportunity */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5" />
                Linked Opportunity
              </p>

              {loadingOpp ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Looking up opportunity…
                </div>
              ) : opportunity ? (
                <button
                  onClick={() => setOppModal(true)}
                  className="w-full text-left bg-muted/40 border border-border/60 rounded-[8px] px-3 py-2.5 hover:bg-muted/70 hover:border-primary/20 transition-colors group"
                >
                  <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                    {opportunity.contact?.name ?? opportunity.name}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground">
                      {opportunity.pipelineStageId_name ?? "Unknown stage"}
                    </span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className={cn(
                      "text-xs font-medium",
                      opportunity.status === "open" ? "text-primary" :
                      opportunity.status === "won" ? "text-green-600" : "text-muted-foreground"
                    )}>
                      {opportunity.status.charAt(0).toUpperCase() + opportunity.status.slice(1)}
                    </span>
                  </div>
                </button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No match found for <span className="font-medium">{resolvedDomain}</span>.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {oppModal && opportunity && (
        <OpportunityModal
          opportunity={opportunity}
          stageName={opportunity.pipelineStageId_name ?? "Unknown Stage"}
          onClose={() => setOppModal(false)}
        />
      )}
    </>
  );
}
