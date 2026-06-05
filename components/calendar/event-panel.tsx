"use client";

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { useUserTimezone } from "@/providers/timezone-provider";
import { toZonedDate } from "@/lib/utils/timezone";
import {
  X, Video, Clock, ExternalLink, Calendar, Phone, Mail,
  RefreshCw, XCircle, Loader2, Globe, Tag, Briefcase,
  Building2, DollarSign, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { isQualificationNote, parseQualificationNote } from "@/lib/utils/url";
import { OpportunityModal } from "@/components/pipeline/opportunity-modal";
import type { CalendarEvent } from "./calendar-client";
import type { GHLOpportunity } from "@/lib/ghl/types";

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
  onCancelled?: () => void;
}

interface GHLContact {
  id: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  website?: string;
  tags?: string[];
  source?: string;
  customFields?: Array<{ id: string; value: string }>;
  customField?: Array<{ id: string; value: string }>;
}

interface GHLNote {
  id: string;
  body: string;
}

interface QualificationQA {
  question: string;
  answer: string;
  isUrl: boolean;
  cleanedUrl?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatEventDate(dt: string, tz: string): string {
  return format(toZonedDate(parseISO(dt), tz), "EEE, MMM d, yyyy");
}

function formatEventTime(dt: string, tz: string): string {
  return format(toZonedDate(parseISO(dt), tz), "h:mm a");
}

function contactDisplayName(c: GHLContact): string {
  if (c.fullName?.trim()) return c.fullName.trim();
  const parts = [c.firstName, c.lastName].filter(Boolean);
  if (parts.length) return parts.join(" ");
  return "Unknown";
}

// ─── Contact Detail Row ───────────────────────────────────────────────────────

function DetailRow({
  icon: Icon,
  label,
  value,
  href,
  external,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  href?: string;
  external?: boolean;
}) {
  const content = href ? (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className="text-sm text-foreground hover:text-primary transition-colors truncate"
    >
      {value}
    </a>
  ) : (
    <span className="text-sm text-foreground truncate">{value}</span>
  );

  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <Icon className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium leading-none mb-0.5">
          {label}
        </p>
        {content}
      </div>
    </div>
  );
}

// ─── Qualification Section ────────────────────────────────────────────────────

function QualificationSection({ pairs }: { pairs: QualificationQA[] }) {
  if (pairs.length === 0) return null;

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium mb-2.5">
        Qualification
      </p>
      <div className="space-y-2.5">
        {pairs.map((qa, i) => (
          <div key={i}>
            <p className="text-[11px] text-muted-foreground leading-snug">{qa.question}</p>
            {qa.isUrl && qa.cleanedUrl ? (
              <a
                href={qa.cleanedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-primary hover:underline break-all"
              >
                {qa.answer}
              </a>
            ) : (
              <p className="text-sm font-medium text-foreground leading-snug">{qa.answer}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function EventPanel({
  event,
  repColors,
  userCalendars,
  onClose,
  onBook,
  onCancelled,
}: EventPanelProps) {
  const tz = useUserTimezone();
  const isOpen = event !== null;
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showOppModal, setShowOppModal] = useState(false);
  const queryClient = useQueryClient();

  // Reset state when event changes
  useEffect(() => {
    setConfirmingCancel(false);
    setCancelling(false);
    setShowOppModal(false);
  }, [event?.id]);

  // Escape to close
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen && !showOppModal) {
        if (confirmingCancel) setConfirmingCancel(false);
        else onClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose, confirmingCancel, showOppModal]);

  const contactId = event?.contactId;
  const isGhl = event?.source === "ghl";

  // ── Fetch contact + notes + opportunity in one call ──────────────────────
  const { data: contactDetails } = useQuery<{
    contact: GHLContact | null;
    notes: GHLNote[];
    opportunity: GHLOpportunity | null;
  }>({
    queryKey: ["event-contact-details", contactId],
    queryFn: () =>
      fetch(`/api/calendar/contact-details?contactId=${contactId}`).then((r) => r.json()),
    enabled: !!contactId && isOpen,
    staleTime: 5 * 60_000,
  });

  const contact = contactDetails?.contact ?? null;
  const opportunity = contactDetails?.opportunity ?? null;

  const qualPairs: QualificationQA[] = (() => {
    const notes = contactDetails?.notes ?? [];
    const qualNote = notes.find((n) => isQualificationNote(n.body));
    if (!qualNote) return [];
    return parseQualificationNote(qualNote.body);
  })();

  // ── Derived values ─────────────────────────────────────────────────────────
  const color = event
    ? (repColors[event.repId ?? ""] ?? repColors[event.repEmail] ?? "#6366f1")
    : "#6366f1";
  const repCal = event
    ? userCalendars.find((uc) => uc.repEmail === event.repEmail)
      ?? (event.repId ? userCalendars.find((uc) => repColors[event.repId!] === uc.color) : null)
    : null;

  const startDt = event?.start.dateTime;
  const endDt = event?.end.dateTime;
  const canCancel = isGhl;

  async function handleCancel() {
    if (!event) return;
    setCancelling(true);
    try {
      const res = await fetch("/api/calendar/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: event.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to cancel");
      }
      await queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
      onCancelled?.();
      onClose();
    } catch (err) {
      console.error("[EventPanel] Cancel failed:", err);
      setCancelling(false);
      setConfirmingCancel(false);
    }
  }

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
        {/* ── Header: title + close ─────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 shrink-0">
          <div className="flex items-start gap-3 min-w-0">
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
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-xs text-muted-foreground">{repCal.repName}</span>
                </div>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Date/time + status + actions (compact) ────────────────── */}
        <div className="px-5 pb-4 space-y-3 shrink-0 border-b border-border">
          {startDt && (
            <div className="flex items-center gap-2.5 text-sm">
              <Calendar className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
              <span className="font-medium text-foreground">{formatEventDate(startDt, tz)}</span>
              {endDt && (
                <>
                  <Clock className="w-3 h-3 text-muted-foreground/60 shrink-0 ml-1" />
                  <span className="text-muted-foreground text-xs">
                    {formatEventTime(startDt, tz)} – {formatEventTime(endDt, tz)}
                  </span>
                </>
              )}
            </div>
          )}

          {event?.appointmentStatus && (
            <span className={cn(
              "inline-flex items-center px-2 py-0.5 rounded-[4px] text-[10px] font-semibold uppercase tracking-wide",
              event.appointmentStatus === "confirmed" && "bg-emerald-500/10 text-emerald-700",
              event.appointmentStatus === "cancelled" && "bg-destructive/10 text-destructive",
              event.appointmentStatus === "no_show" && "bg-amber-500/10 text-amber-700",
              !["confirmed", "cancelled", "no_show"].includes(event.appointmentStatus) && "bg-muted text-muted-foreground",
            )}>
              {event.appointmentStatus.replace(/_/g, " ")}
            </span>
          )}

          {/* Action buttons: Meet + Reschedule/Cancel */}
          <div className="flex items-center gap-2">
            {event?.hangoutLink && (
              <a
                href={event.hangoutLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-[8px] text-xs font-medium bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 border border-emerald-500/20 transition-colors"
              >
                <Video className="w-3.5 h-3.5" />
                Join Meet
              </a>
            )}
            {canCancel && !confirmingCancel && (
              <>
                <button
                  onClick={onBook}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-[8px] text-xs font-medium border border-border text-foreground hover:bg-muted transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Reschedule
                </button>
                <button
                  onClick={() => setConfirmingCancel(true)}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-[8px] text-xs font-medium border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <XCircle className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            {canCancel && confirmingCancel && (
              <div className="flex items-center gap-1.5 w-full">
                <p className="text-[11px] text-destructive whitespace-nowrap">Cancel?</p>
                <button
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-[6px] text-[11px] font-semibold bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-60"
                >
                  {cancelling ? <Loader2 className="w-3 h-3 animate-spin" /> : "Yes"}
                </button>
                <button
                  onClick={() => setConfirmingCancel(false)}
                  disabled={cancelling}
                  className="flex-1 px-2 py-1.5 rounded-[6px] text-[11px] font-semibold border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-60"
                >
                  No
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Scrollable body: contact + qualification ──────────────── */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Contact card */}
          {contact && (
            <div className="px-5 py-4 space-y-3">
              {/* Name + stage */}
              <div>
                <p className="text-base font-semibold text-foreground leading-tight">
                  {contactDisplayName(contact)}
                </p>
                {opportunity?.pipelineStageId_name && (
                  <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded-[4px] text-[10px] font-semibold uppercase tracking-wide bg-primary/10 text-primary">
                    {opportunity.pipelineStageId_name}
                  </span>
                )}
              </div>

              {/* Contact details */}
              <div className="space-y-2.5">
                {contact.phone && (
                  <DetailRow icon={Phone} label="Phone" value={contact.phone} href={`tel:${contact.phone}`} />
                )}
                {contact.email && (
                  <DetailRow icon={Mail} label="Email" value={contact.email} href={`mailto:${contact.email}`} />
                )}
                {(contact.companyName || opportunity?.contact?.companyName) && (
                  <DetailRow
                    icon={Building2}
                    label="Company"
                    value={contact.companyName || opportunity?.contact?.companyName || ""}
                  />
                )}
                {(contact.website || opportunity?.contact?.website) && (
                  <DetailRow
                    icon={Globe}
                    label="Website"
                    value={(contact.website || opportunity?.contact?.website || "").replace(/^https?:\/\//, "")}
                    href={contact.website || opportunity?.contact?.website}
                    external
                  />
                )}
                {opportunity?.monetaryValue != null && opportunity.monetaryValue > 0 && (
                  <DetailRow
                    icon={DollarSign}
                    label="Deal Value"
                    value={`$${opportunity.monetaryValue.toLocaleString()}`}
                  />
                )}
                {contact.source && (
                  <DetailRow icon={Sparkles} label="Source" value={contact.source} />
                )}
              </div>

              {/* Tags */}
              {contact.tags && contact.tags.length > 0 && (
                <div className="flex items-start gap-2.5">
                  <Tag className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0 mt-0.5" />
                  <div className="flex flex-wrap gap-1">
                    {contact.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[10px] font-medium bg-muted text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Open Opportunity button */}
              {opportunity && (
                <button
                  onClick={() => setShowOppModal(true)}
                  className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-[8px] text-xs font-medium border border-border text-foreground hover:bg-muted transition-colors"
                >
                  <Briefcase className="w-3.5 h-3.5" />
                  Open Opportunity
                </button>
              )}
            </div>
          )}

          {/* Loading skeleton for contact */}
          {contactId && !contact && isOpen && (
            <div className="px-5 py-4 space-y-3">
              <div className="h-5 w-40 bg-muted rounded animate-pulse" />
              <div className="h-4 w-32 bg-muted rounded animate-pulse" />
              <div className="h-4 w-48 bg-muted rounded animate-pulse" />
              <div className="h-4 w-36 bg-muted rounded animate-pulse" />
            </div>
          )}

          {/* Qualification Q&A */}
          {qualPairs.length > 0 && (
            <div className="px-5 pb-4">
              <div className="border-t border-border/50 pt-4">
                <QualificationSection pairs={qualPairs} />
              </div>
            </div>
          )}

          {/* Description (if present and not empty) */}
          {event?.description && event.description.trim() && (
            <div className="px-5 pb-4">
              <div className="border-t border-border/50 pt-4">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium mb-1.5">
                  Notes
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
                  {event.description}
                </p>
              </div>
            </div>
          )}

          {/* Book follow-up (always at bottom of scroll area) */}
          {isGhl && (
            <div className="px-5 pb-4">
              <button
                onClick={onBook}
                className="flex items-center justify-center gap-2 w-full px-3 py-2.5 rounded-[8px] text-xs font-medium border border-border text-foreground hover:bg-muted transition-colors"
              >
                <Phone className="w-3.5 h-3.5" />
                Book follow-up
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Opportunity modal overlay */}
      {showOppModal && opportunity && (
        <OpportunityModal
          opportunity={opportunity}
          stageName={opportunity.pipelineStageId_name ?? ""}
          onClose={() => setShowOppModal(false)}
        />
      )}
    </>
  );
}
