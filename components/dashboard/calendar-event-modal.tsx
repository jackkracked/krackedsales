"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Clock, User, TrendingUp, ExternalLink } from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils/cn";
import { OpportunityModal } from "@/components/pipeline/opportunity-modal";
import type { GHLCalendarEvent, GHLOpportunity } from "@/lib/ghl/types";

interface CalendarEventModalProps {
  event: GHLCalendarEvent;
  onClose: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  confirmed: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-red-50 text-red-600",
  showed: "bg-blue-50 text-blue-700",
  noshow: "bg-rose-50 text-rose-600",
  "no-show": "bg-rose-50 text-rose-600",
};

function formatTime(iso: string) {
  try { return format(parseISO(iso), "h:mm a"); } catch { return iso; }
}
function formatDate(iso: string) {
  try { return format(parseISO(iso), "EEEE, d MMMM yyyy"); } catch { return iso; }
}

export function CalendarEventModal({ event, onClose }: CalendarEventModalProps) {
  const [showOppModal, setShowOppModal] = useState(false);

  const { data: oppData, isLoading: loadingOpp } = useQuery<{
    opportunity: GHLOpportunity | null;
    stageName?: string;
  }>({
    queryKey: ["contact-opportunity", event.contactId],
    queryFn: () =>
      fetch(
        `/api/ghl/contacts/${event.contactId}/opportunity?name=${encodeURIComponent(event.contactName ?? "")}`
      ).then((r) => r.json()),
    enabled: !!event.contactId,
    staleTime: 2 * 60 * 1000,
  });

  const opp = oppData?.opportunity ?? null;
  const stageName = oppData?.stageName ?? opp?.pipelineStageId_name ?? "";
  const statusKey = event.status?.toLowerCase().replace(/\s/g, "");
  const statusClass = STATUS_COLORS[statusKey] ?? "bg-muted text-muted-foreground";

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-card border border-border rounded-[12px] shadow-2xl w-full max-w-md pointer-events-auto">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-border">
            <div className="flex-1 min-w-0">
              <p className="text-base font-semibold text-foreground leading-tight">
                {event.title}
              </p>
              {event.status && (
                <span
                  className={cn(
                    "inline-block mt-1.5 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full",
                    statusClass
                  )}
                >
                  {event.status}
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-4 space-y-4">
            {/* Time */}
            <div className="flex items-center gap-2.5 text-sm text-foreground">
              <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
              <span>
                {formatDate(event.startTime)} &middot; {formatTime(event.startTime)}
                {event.endTime && ` – ${formatTime(event.endTime)}`}
              </span>
            </div>

            {/* Contact */}
            {event.contactName && (
              <div className="flex items-center gap-2.5 text-sm text-foreground">
                <User className="w-4 h-4 text-muted-foreground shrink-0" />
                <span>{event.contactName}</span>
              </div>
            )}

            {/* Linked opportunity */}
            <div className="border-t border-border pt-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2.5">
                Linked Opportunity
              </p>

              {!event.contactId ? (
                <p className="text-sm text-muted-foreground">No contact linked to this event.</p>
              ) : loadingOpp ? (
                <div className="space-y-2">
                  <div className="h-3 bg-muted/60 rounded animate-pulse w-40" />
                  <div className="h-2.5 bg-muted/40 rounded animate-pulse w-24" />
                </div>
              ) : !opp ? (
                <p className="text-sm text-muted-foreground">No opportunity found for this contact.</p>
              ) : (
                <button
                  onClick={() => setShowOppModal(true)}
                  className="w-full text-left group"
                >
                  <div className="flex items-center justify-between gap-3 p-3 rounded-[8px] border border-border hover:border-primary/40 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <TrendingUp className="w-3.5 h-3.5 text-primary shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {opp.contact?.name || opp.name || "Unnamed"}
                        </p>
                        <p className="text-xs text-muted-foreground">{stageName}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {(opp.monetaryValue ?? 0) > 0 && (
                        <span className="text-xs font-semibold tabular-nums text-foreground">
                          ${(opp.monetaryValue ?? 0).toLocaleString()}
                        </span>
                      )}
                      <ExternalLink className="w-3 h-3 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </div>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Full opportunity modal — opened from the linked opp button */}
      {showOppModal && opp && (
        <OpportunityModal
          opportunity={opp}
          stageName={stageName}
          onClose={() => setShowOppModal(false)}
        />
      )}
    </>
  );
}
