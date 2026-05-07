"use client";

import { useEffect } from "react";
import { format, parseISO } from "date-fns";
import { X, Video, Clock, ExternalLink, Calendar, Phone } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { CalendarEvent } from "./calendar-client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserCalendar {
  id: string;
  repName: string;
  repEmail: string;
  color: string;
}

interface EventPanelProps {
  event: CalendarEvent | null;
  repColors: Record<string, string>;
  userCalendars: UserCalendar[];
  onClose: () => void;
  onBook: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatEventDateTime(dt: string): string {
  const d = parseISO(dt);
  return format(d, "EEE, MMM d, yyyy");
}

function formatEventTime(dt: string): string {
  const d = parseISO(dt);
  return format(d, "h:mm a");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function EventPanel({
  event,
  repColors,
  userCalendars,
  onClose,
  onBook,
}: EventPanelProps) {
  const isOpen = event !== null;

  // Escape key to close
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen) onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  const color = event ? (repColors[event.repEmail] ?? "#6366f1") : "#6366f1";
  const repCal = event ? userCalendars.find((uc) => uc.repEmail === event.repEmail) : null;

  const startDt = event?.start.dateTime;
  const endDt   = event?.end.dateTime;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={cn(
          "fixed inset-0 z-40 bg-black/30 transition-opacity duration-200",
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Event details"
        className={cn(
          "fixed right-0 top-0 z-50 h-full w-[380px] max-w-[90vw]",
          "bg-card border-l border-border shadow-xl flex flex-col",
          "transition-transform duration-200 ease-in-out",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            {/* Color accent */}
            <div
              className="w-1 rounded-full shrink-0 mt-0.5"
              style={{ backgroundColor: color, height: 36 }}
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground leading-snug">
                {event?.summary ?? ""}
              </p>
              {repCal && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-xs text-muted-foreground">{repCal.repName}</span>
                </div>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            aria-label="Close event panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">

          {/* Date and time */}
          {startDt && (
            <div className="flex items-start gap-3">
              <Calendar className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-sm text-foreground font-medium">
                  {formatEventDateTime(startDt)}
                </p>
                {endDt && (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Clock className="w-3 h-3 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">
                      {formatEventTime(startDt)} – {formatEventTime(endDt)}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Attendees */}
          {event && event.attendees.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                Attendees
              </p>
              <div className="space-y-1.5">
                {event.attendees.map((att, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0">
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase">
                        {(att.displayName ?? att.email ?? "?")[0]}
                      </span>
                    </div>
                    <div className="min-w-0">
                      {att.displayName && (
                        <p className="text-xs font-medium text-foreground leading-tight truncate">
                          {att.displayName}
                        </p>
                      )}
                      {att.email && (
                        <p className="text-[11px] text-muted-foreground truncate">{att.email}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          {event?.description && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
                Description
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
                {event.description}
              </p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 py-4 border-t border-border shrink-0 space-y-2">
          {/* Google Meet link */}
          {event?.hangoutLink && (
            <a
              href={event.hangoutLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-[8px] text-sm font-medium bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 border border-emerald-500/20 transition-colors"
            >
              <Video className="w-4 h-4" />
              Join Meet
              <ExternalLink className="w-3 h-3 ml-auto opacity-60" />
            </a>
          )}

          {/* Book follow-up */}
          <button
            onClick={onBook}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-[8px] text-sm font-medium border border-border text-foreground hover:bg-muted transition-colors"
          >
            <Phone className="w-4 h-4" />
            Book follow-up
          </button>
        </div>
      </div>
    </>
  );
}
