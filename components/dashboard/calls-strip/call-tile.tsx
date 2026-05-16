"use client";

import { useState } from "react";
import { format, formatDistanceToNow, isPast, isToday } from "date-fns";
import { cn } from "@/lib/utils/cn";
import { X, CheckCircle, FileText, Loader2 } from "lucide-react";
import { OpportunityModal } from "@/components/pipeline/opportunity-modal";
import type { GHLOpportunity } from "@/lib/ghl/types";

export type Outcome =
  | "no_show"
  | "closed"
  | "preparing_proposal"
  | "rebooked"
  | "not_interested"
  | "follow_up";

const OUTCOMES: { value: Outcome; label: string }[] = [
  { value: "no_show",            label: "No Show" },
  { value: "closed",             label: "Closed" },
  { value: "preparing_proposal", label: "Preparing Proposal" },
  { value: "rebooked",           label: "Rebooked" },
  { value: "not_interested",     label: "Not Interested" },
  { value: "follow_up",          label: "Follow Up" },
];

export interface CallEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  contactId?: string;
  contactName?: string;
  repEmail?: string;
  repName?: string;
  isPast: boolean;
}

interface CallTileProps {
  event: CallEvent;
  isNext: boolean;
  isAdmin: boolean;
  onDispositioned: (eventId: string) => void;
}

function formatEventTime(startTime: string): string {
  const d = new Date(startTime);
  if (isToday(d)) return `Today · ${format(d, "h:mm a")}`;
  if (isPast(d)) return formatDistanceToNow(d, { addSuffix: true });
  return format(d, "EEE d MMM · h:mm a");
}

function formatClientName(title: string): string {
  const parts = title.split(/\s+x\s+/i);
  return parts[0]?.trim() || title;
}

// ─── Outcome Modal ────────────────────────────────────────────────────────────

interface OutcomeModalProps {
  event: CallEvent;
  clientName: string;
  onClose: () => void;
  onDispositioned: (eventId: string) => void;
}

function OutcomeModal({ event, clientName, onClose, onDispositioned }: OutcomeModalProps) {
  const [step, setStep] = useState<"outcomes" | "notes">("outcomes");
  const [selectedOutcome, setSelectedOutcome] = useState<Outcome | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function saveOutcome(skipNotes = false) {
    if (!selectedOutcome) return;
    setSaving(true);
    try {
      await fetch(`/api/dashboard/calls/${event.id}/outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome: selectedOutcome,
          notes: skipNotes ? undefined : notes || undefined,
          contactId: event.contactId,
          contactName: event.contactName,
          repEmail: event.repEmail,
        }),
      });
      onDispositioned(event.id);
      onClose();
    } catch {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-[12px] shadow-xl w-full max-w-sm p-6 z-10">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Event info */}
        <div className="mb-5">
          <p className="text-xs text-muted-foreground mb-0.5">{formatEventTime(event.startTime)}</p>
          <p className="text-lg font-bold text-foreground leading-tight" style={{ fontFamily: "var(--font-heading)" }}>
            {clientName}
          </p>
        </div>

        {step === "outcomes" && (
          <>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              What was the outcome?
            </p>
            <div className="grid grid-cols-2 gap-2">
              {OUTCOMES.map((o) => (
                <button
                  key={o.value}
                  onClick={() => { setSelectedOutcome(o.value); setStep("notes"); }}
                  className="px-3 py-2.5 text-sm font-medium border border-border rounded-[8px] text-foreground hover:border-primary hover:bg-primary/5 hover:text-primary transition-all text-left"
                >
                  {o.label}
                </button>
              ))}
            </div>
          </>
        )}

        {step === "notes" && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle className="w-4 h-4 text-primary shrink-0" />
              <p className="text-sm font-semibold text-foreground capitalize">
                {selectedOutcome?.replace(/_/g, " ")}
              </p>
              <button
                onClick={() => setStep("outcomes")}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition-colors"
              >
                Change
              </button>
            </div>

            <p className="text-xs text-muted-foreground mb-2">
              Add a note to the opportunity card? (optional)
            </p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Call notes…"
              rows={3}
              autoFocus
              className="w-full text-sm px-3 py-2.5 border border-border rounded-[8px] bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none transition-colors mb-3"
            />

            <div className="flex gap-2">
              <button
                onClick={() => saveOutcome(true)}
                disabled={saving}
                className="flex-1 py-2 text-sm font-medium border border-border rounded-[8px] text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
              >
                Skip
              </button>
              <button
                onClick={() => saveOutcome(false)}
                disabled={saving}
                className="flex-1 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-[8px] hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save & Clear"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Tile ─────────────────────────────────────────────────────────────────────

export function CallTile({ event, isNext, isAdmin, onDispositioned }: CallTileProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [cardOpp, setCardOpp] = useState<GHLOpportunity | null>(null);
  const [cardStageName, setCardStageName] = useState("");
  const [cardLoading, setCardLoading] = useState(false);

  const isOverdue = event.isPast;
  const clientName = event.contactName || formatClientName(event.title);

  function handleDispositioned(eventId: string) {
    setLeaving(true);
    setTimeout(() => onDispositioned(eventId), 300);
  }

  async function openCard() {
    if (!event.contactId) return;
    setCardLoading(true);
    try {
      const params = new URLSearchParams({ name: clientName });
      const res = await fetch(`/api/ghl/contacts/${event.contactId}/opportunity?${params}`);
      const data = await res.json();
      if (data.opportunity) {
        setCardOpp(data.opportunity);
        setCardStageName(data.stageName ?? "");
      }
    } finally {
      setCardLoading(false);
    }
  }

  return (
    <>
      <div
        className={cn(
          "flex flex-col rounded-[10px] border bg-card p-4 h-full transition-all duration-300",
          leaving && "opacity-0 scale-95",
          isNext && "border-primary shadow-sm shadow-primary/10",
          isOverdue && !isNext && "border-amber-400",
          !isNext && !isOverdue && "border-border"
        )}
      >
        {/* Badge row */}
        <div className="flex items-center justify-between mb-3">
          {isNext ? (
            <span className="text-[10px] font-bold uppercase tracking-widest bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
              Next
            </span>
          ) : isOverdue ? (
            <span className="text-[10px] font-bold uppercase tracking-widest bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
              Overdue
            </span>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-1.5">
            {isAdmin && event.repName && (
              <span className="text-[10px] text-muted-foreground font-medium truncate max-w-[80px]">
                {event.repName.split(" ")[0]}
              </span>
            )}
            {/* View opportunity card */}
            {event.contactId && (
              <button
                onClick={openCard}
                disabled={cardLoading}
                title="View opportunity card"
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              >
                {cardLoading
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <FileText className="w-3.5 h-3.5" />
                }
              </button>
            )}
          </div>
        </div>

        {/* Client name */}
        <p
          className="text-base font-semibold text-foreground truncate leading-tight mb-1"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {clientName}
        </p>

        {/* Time */}
        <p className="text-xs text-muted-foreground mb-4">
          {formatEventTime(event.startTime)}
        </p>

        {/* CTA — always at bottom, fixed height */}
        <button
          onClick={() => setModalOpen(true)}
          className="mt-auto w-full py-1.5 text-xs font-medium border border-border rounded-[7px] text-muted-foreground hover:border-primary hover:text-primary transition-colors"
        >
          Set Outcome
        </button>
      </div>

      {modalOpen && (
        <OutcomeModal
          event={event}
          clientName={clientName}
          onClose={() => setModalOpen(false)}
          onDispositioned={handleDispositioned}
        />
      )}

      {cardOpp && (
        <OpportunityModal
          opportunity={cardOpp}
          stageName={cardStageName}
          onClose={() => setCardOpp(null)}
        />
      )}
    </>
  );
}
