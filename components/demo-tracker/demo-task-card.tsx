"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import { Clock, ExternalLink } from "lucide-react";
import { getStageBadge, getStageRiskDays } from "@/lib/utils/demo-stage";
import { DemoTaskModal } from "./demo-task-modal";
import type { EnrichedTask } from "@/app/api/clickup/tasks/route";
import type { DemoLinkData } from "@/app/api/demo-tracker/ghl-links/route";

function MiroLogo({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M21.6632 -0.000366211H78.3368C90.293 -0.000366211 100 9.70665 100 21.6628V78.3364C100 90.2926 90.293 99.9996 78.3368 99.9996H21.6632C9.70702 99.9996 0 90.2926 0 78.3364V21.6628C0 9.70665 9.70702 -0.000366211 21.6632 -0.000366211Z" fill="#FFD02F"/>
      <path d="M69.488 12.4886H58.5084L67.6531 28.5584L47.5288 12.4886H36.5492L46.6114 32.1393L25.5697 12.4886H14.5901L25.5697 37.496L14.5901 87.5107H25.5697L46.6114 33.915L36.5492 87.5107H47.5288L67.6531 30.3637L58.5084 87.5107H69.488L89.6123 24.9775L69.488 12.4886Z" fill="#050038"/>
    </svg>
  );
}

/** Returns Tailwind colour classes based on absolute days in queue. */
function getAgeClasses(days: number): string {
  if (days <= 3) return "text-emerald-600";
  if (days <= 7) return "text-amber-600";
  return "text-destructive";
}

function CallBadge({ link, daysSinceSent }: { link: DemoLinkData; daysSinceSent: number }) {
  if (link.callStatus === "booked") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200"
        data-r10n-status-pill
        data-status="won"
      >
        ✅ Booked{link.daysToCall != null ? ` · Day ${link.daysToCall}` : ""}
      </span>
    );
  }
  if (link.callStatus === "no_response") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200"
        data-r10n-status-pill
        data-status="no_response"
      >
        ❌ No response · {daysSinceSent}d
      </span>
    );
  }
  // awaiting
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200"
      data-r10n-status-pill
      data-status="needs_attention"
    >
      ⏳ Awaiting · {daysSinceSent}d
    </span>
  );
}

export function DemoTaskCard({ task, link }: { task: EnrichedTask; link?: DemoLinkData }) {
  const [showModal, setShowModal] = useState(false);
  const badge = getStageBadge(task.status);
  const isDemoSent = task.bucket === "DEMO_SENT";

  // Per-stage risk threshold (not a one-size-fits-all >3d)
  const riskThreshold = getStageRiskDays(task.status);
  const isAtRisk = !isDemoSent && task.daysInStage > riskThreshold;
  const ageClasses = isDemoSent ? "" : getAgeClasses(task.daysInStage);

  // Extract brand/domain from task name — everything before the first ": "
  const brand = task.name.includes(": ")
    ? task.name.split(": ")[0].trim()
    : null;

  // "Sent X days ago" label for demo-sent cards
  const daysSinceSent = isDemoSent && task.dateSent
    ? Math.floor((Date.now() - new Date(task.dateSent).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // Age tier for the inert r10n hook (mirrors getAgeClasses): fast / mid / late.
  const ageTier = task.daysInStage <= 3 ? "fast" : task.daysInStage <= 7 ? "mid" : "late";

  return (
    <>
      <div
        onClick={() => setShowModal(true)}
        className="group bg-card border border-border rounded-[10px] p-3 hover:border-primary/30 transition-all duration-150 hover:shadow-sm cursor-pointer"
        data-r10n-demo-card
        data-r10n-demo-bucket={task.bucket}
      >
        {/* Name + ClickUp link */}
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="text-sm font-semibold text-foreground leading-tight line-clamp-2 flex-1" data-r10n-demo-card-name>
            {task.name}
          </p>
          <a
            href={task.url}
            target="_blank"
            rel="noopener noreferrer"
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-muted-foreground hover:text-foreground shrink-0"
            aria-label="Open in ClickUp"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {/* Brand subtitle */}
        {brand && (
          <p className="text-[11px] text-muted-foreground mb-2 truncate" data-r10n-demo-card-brand>{brand}</p>
        )}

        {/* Stage badge */}
        <span
          className={cn(
            "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
            badge.className
          )}
          data-r10n-demo-stagebadge
        >
          {badge.label}
        </span>

        {/* Footer row */}
        <div className="flex items-center justify-between mt-2">
          {/* Age indicator */}
          {!isDemoSent && (
            <div
              className={cn("flex items-center gap-1 text-xs font-medium", ageClasses)}
              data-r10n-demo-age={ageTier}
              data-r10n-demo-atrisk={isAtRisk ? "true" : "false"}
            >
              <Clock className="w-3 h-3" />
              <span>{task.daysInStage === 0 ? "Today" : `Day ${task.daysInStage}`}</span>
              {isAtRisk && <span className="ml-0.5">⚠</span>}
            </div>
          )}
          {isDemoSent && daysSinceSent != null && (
            link && link.callStatus !== "unlinked"
              ? <CallBadge link={link} daysSinceSent={daysSinceSent} />
              : <span className="text-xs text-muted-foreground">
                  {daysSinceSent === 0 ? "Sent today" : `Sent ${daysSinceSent}d ago`}
                </span>
          )}

          {/* Miro link */}
          {task.miroUrl && (
            <a
              href={task.miroUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="ml-auto flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <MiroLogo size={14} />
              Miro
            </a>
          )}
        </div>
      </div>

      {showModal && (
        <DemoTaskModal task={task} onClose={() => setShowModal(false)} />
      )}
    </>
  );
}
