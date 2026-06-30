"use client";

import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow, addDays } from "date-fns";
import { cn } from "@/lib/utils/cn";
import { useUserTimezone } from "@/providers/timezone-provider";
import { toZonedDate, isTodayInTz, isPastInTz } from "@/lib/utils/timezone";
import {
  X, CheckCircle, FileText, Loader2, Sparkles,
  UserX, BadgeCheck, FileEdit, Send, CalendarCheck, XCircle,
  CircleDollarSign, Clock, type LucideIcon,
} from "lucide-react";
import { OpportunityModal } from "@/components/pipeline/opportunity-modal";
import { CallPrepModal } from "@/components/calls/call-prep/call-prep-modal";
import type { GHLOpportunity } from "@/lib/ghl/types";

// ─── Outcome definitions ──────────────────────────────────────────────────────

export type Outcome =
  | "no_show"
  | "closed"
  | "preparing_proposal"
  | "sent_proposal"
  | "rebooked"
  | "not_interested"
  | "budget_objection"
  | "needs_time";

const OUTCOMES: { value: Outcome; label: string; sub?: string; icon: LucideIcon }[] = [
  { value: "no_show",            label: "No Show",            sub: "Didn't attend the call",     icon: UserX },
  { value: "closed",             label: "Closed",             sub: "Deal won",                   icon: BadgeCheck },
  { value: "preparing_proposal", label: "Preparing Proposal", sub: "Building their offer",       icon: FileEdit },
  { value: "sent_proposal",      label: "Sent Proposal",      sub: "Awaiting decision",          icon: Send },
  { value: "rebooked",           label: "Rebooked",           sub: "New call scheduled",         icon: CalendarCheck },
  { value: "not_interested",     label: "Not Interested",     sub: "No fit or declined",         icon: XCircle },
  { value: "budget_objection",   label: "Budget Objection",   sub: "Cost concerns",              icon: CircleDollarSign },
  { value: "needs_time",         label: "Needs Time",         sub: "Follow up later",            icon: Clock },
];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CallEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  contactId?: string;
  contactName?: string;
  repEmail?: string;
  repName?: string;
  calendarName?: string | null;
  isPast: boolean;
}

interface CallTileProps {
  event: CallEvent;
  isNext: boolean;
  isAdmin: boolean;
  onDispositioned: (eventId: string) => void;
}

interface PipelineStage {
  id: string;
  name: string;
}

interface OppData {
  id: string;
  pipelineId: string;
  stageName: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatEventTime(startTime: string, tz: string): string {
  const d = new Date(startTime);
  if (isTodayInTz(d, tz)) return `Today · ${format(toZonedDate(d, tz), "h:mm a")}`;
  if (isPastInTz(d, tz)) return formatDistanceToNow(d, { addSuffix: true });
  return format(toZonedDate(d, tz), "EEE d MMM · h:mm a");
}

function formatClientName(title: string): string {
  const parts = title.split(/\s+x\s+/i);
  return parts[0]?.trim() || title;
}

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── Outcome Modal ────────────────────────────────────────────────────────────

interface OutcomeModalProps {
  event: CallEvent;
  clientName: string;
  onClose: () => void;
  onDispositioned: (eventId: string) => void;
  suggestedOutcome?: string;
  suggestedNotes?: string;
}

function OutcomeModal({ event, clientName, onClose, onDispositioned, suggestedOutcome: initialSuggestedOutcome, suggestedNotes: initialSuggestedNotes }: OutcomeModalProps) {
  const tz = useUserTimezone();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"outcomes" | "pipeline">("outcomes");
  const [selectedOutcome, setSelectedOutcome] = useState<Outcome | null>(
    initialSuggestedOutcome && OUTCOMES.some((o) => o.value === initialSuggestedOutcome)
      ? (initialSuggestedOutcome as Outcome)
      : null
  );
  const [notes, setNotes] = useState(initialSuggestedNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [aiSuggestedLabel, setAiSuggestedLabel] = useState<string | null>(() => {
    if (initialSuggestedOutcome) {
      return OUTCOMES.find((o) => o.value === initialSuggestedOutcome)?.label ?? null;
    }
    return null;
  });

  // Pick up AI suggestions that arrive after the modal is already open
  useEffect(() => {
    if (!initialSuggestedOutcome) return;
    const isValidOutcome = OUTCOMES.some((o) => o.value === initialSuggestedOutcome);
    if (isValidOutcome && selectedOutcome === null) {
      setSelectedOutcome(initialSuggestedOutcome as Outcome);
      setAiSuggestedLabel(OUTCOMES.find((o) => o.value === initialSuggestedOutcome)?.label ?? null);
    }
  }, [initialSuggestedOutcome]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (initialSuggestedNotes && notes === "") {
      setNotes(initialSuggestedNotes);
    }
  }, [initialSuggestedNotes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pipeline step state
  const [opp, setOpp] = useState<OppData | null>(null);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [fetchingOpp, setFetchingOpp] = useState(false);
  const [wantsToMoveStage, setWantsToMoveStage] = useState(false);
  const [moveToStageId, setMoveToStageId] = useState("");
  const [wantsToAddTask, setWantsToAddTask] = useState(false);
  const [nextTask, setNextTask] = useState("");
  const [reminderDate, setReminderDate] = useState(toYMD(addDays(new Date(), 1)));
  const [reminderTime, setReminderTime] = useState("09:00");
  const [assignedTo, setAssignedTo] = useState(event.repName ?? event.repEmail ?? "You");
  const [teamMembers, setTeamMembers] = useState<Array<{ name: string; email: string }>>([]);

  const selectedOutcomeDef = OUTCOMES.find((o) => o.value === selectedOutcome);
  const canProceed = selectedOutcome !== null && notes.trim().length > 0;
  const canSubmit = (!wantsToAddTask || (nextTask.trim() && reminderDate)) && (!wantsToMoveStage || moveToStageId);

  async function handleNext() {
    setStep("pipeline");

    // Fetch team members for assignee dropdown
    fetch("/api/settings/team").then((r) => r.json()).then((d) => {
      if (d?.users) setTeamMembers(d.users.filter((u: { isActive: boolean }) => u.isActive));
    }).catch(() => {});

    if (!event.contactId) return;

    setFetchingOpp(true);
    try {
      const [oppRes, pipelinesRes] = await Promise.all([
        fetch(`/api/ghl/contacts/${event.contactId}/opportunity?name=${encodeURIComponent(clientName)}`).then((r) => r.json()),
        fetch("/api/ghl/pipelines").then((r) => r.json()),
      ]);

      const opportunity = oppRes.opportunity;
      if (opportunity) {
        setOpp({
          id: opportunity.id,
          pipelineId: opportunity.pipelineId,
          stageName: oppRes.stageName ?? "Unknown",
        });
        const pipeline = (pipelinesRes.pipelines ?? []).find(
          (p: { id: string }) => p.id === opportunity.pipelineId
        );
        setStages(pipeline?.stages ?? []);
      }
    } finally {
      setFetchingOpp(false);
    }
  }

  async function handleSave() {
    if (!selectedOutcome) return;
    setSaving(true);
    try {
      // 1. Log the call outcome
      await fetch(`/api/dashboard/calls/${event.id}/outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome: selectedOutcome,
          notes: notes.trim() || undefined,
          contactId: event.contactId,
          contactName: event.contactName,
          repEmail: event.repEmail,
          opportunityName: clientName,
        }),
      });

      // 2. Move pipeline stage (non-fatal, only if toggled on)
      if (wantsToMoveStage && opp?.id && moveToStageId) {
        const movedStage = stages.find((s) => s.id === moveToStageId);
        await fetch(`/api/ghl/opportunities/${opp.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pipelineStageId: moveToStageId,
            stageName: movedStage?.name,
            fromStageName: opp.stageName,
            opportunityName: clientName,
          }),
        }).catch((err) => console.error("[OutcomeModal] stage move failed:", err));
      }

      // 3. Create task (non-fatal, only if opted in)
      if (wantsToAddTask && nextTask.trim() && reminderDate) {
        const dueDate = new Date(`${reminderDate}T${reminderTime}:00`);
        await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: nextTask.trim(),
            notes: `After call outcome: ${selectedOutcome.replace(/_/g, " ")} with ${clientName}`,
            dueDate: dueDate.toISOString(),
            contactId: event.contactId || null,
            contactName: event.contactName || clientName,
            priority: "medium",
          }),
        }).then(() => {
          queryClient.invalidateQueries({ queryKey: ["tasks"] });
        }).catch((err) => console.error("[OutcomeModal] task creation failed:", err));
      }

      onDispositioned(event.id);
      onClose();
    } catch {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-[16px] shadow-2xl w-full max-w-sm p-6 z-10">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Event info */}
        <div className="mb-5">
          <p className="text-xs text-muted-foreground mb-0.5">{formatEventTime(event.startTime, tz)}</p>
          <p className="text-lg font-bold text-foreground leading-tight" style={{ fontFamily: "var(--font-heading)" }}>
            {clientName}
          </p>
        </div>

        {/* ── Step 1: Outcomes + Notes ─────────────────────────────────────── */}
        {step === "outcomes" && (
          <>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">
              What was the outcome?
            </p>

            {aiSuggestedLabel && (
              <p className="text-[11px] text-muted-foreground mb-2">
                AI suggested: <span className="font-medium text-foreground/70">{aiSuggestedLabel}</span>
              </p>
            )}

            <div className="grid grid-cols-2 gap-2 mb-4">
              {OUTCOMES.map((o) => {
                const Icon = o.icon;
                const isSelected = selectedOutcome === o.value;
                return (
                  <button
                    key={o.value}
                    onClick={() => setSelectedOutcome(o.value)}
                    className={cn(
                      "px-3 py-2.5 text-left rounded-[10px] border transition-all duration-150",
                      isSelected
                        ? "border-primary bg-primary/8 shadow-sm"
                        : "border-border hover:border-primary/40 hover:bg-muted/30"
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <Icon
                        className={cn(
                          "w-3.5 h-3.5 mt-0.5 shrink-0",
                          isSelected ? "text-primary" : "text-muted-foreground"
                        )}
                      />
                      <div className="min-w-0">
                        <p className={cn(
                          "text-[12px] font-semibold leading-snug",
                          isSelected ? "text-primary" : "text-foreground"
                        )}>
                          {o.label}
                        </p>
                        {o.sub && (
                          <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
                            {o.sub}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Notes — required */}
            <div className="mb-4">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5 block">
                Outcome Notes <span className="text-destructive">*</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={
                  selectedOutcome
                    ? "Add context about this call…"
                    : "Select an outcome above, then add context here…"
                }
                rows={3}
                className={cn(
                  "w-full text-sm px-3 py-2.5 border rounded-[10px] bg-background text-foreground",
                  "placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary",
                  "resize-none transition-colors",
                  !selectedOutcome ? "opacity-50 cursor-not-allowed" : "border-border"
                )}
                disabled={!selectedOutcome}
              />
            </div>

            <button
              onClick={handleNext}
              disabled={!canProceed}
              className={cn(
                "w-full py-2.5 text-sm font-semibold rounded-[10px] transition-all",
                canProceed
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
            >
              Next
            </button>
          </>
        )}

        {/* ── Step 2: Pipeline update ──────────────────────────────────────── */}
        {step === "pipeline" && (
          <>
            {/* Outcome logged pill */}
            <div className="flex items-center gap-2 mb-5">
              <div className="flex items-center gap-2 flex-1 bg-primary/[0.06] border border-primary/15 rounded-[8px] px-3 py-2">
                <CheckCircle className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="text-[12px] text-foreground">
                  Outcome logged:{" "}
                  <strong>{selectedOutcomeDef?.label}</strong>
                </span>
              </div>
              <button
                onClick={() => setStep("outcomes")}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline shrink-0"
              >
                Back
              </button>
            </div>

            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-4">
              Update Pipeline
            </p>

            {/* Current stage */}
            <div className="mb-3">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 block">
                Current Stage
              </label>
              <div className="flex items-center gap-2 px-3 py-2 border border-border rounded-[8px] bg-muted/30 text-sm text-muted-foreground">
                {fetchingOpp ? (
                  <><Loader2 className="w-3 h-3 animate-spin" /> Loading…</>
                ) : (
                  opp?.stageName ?? "—"
                )}
              </div>
            </div>

            {/* Move to stage — optional toggle */}
            <div className="mb-3">
              <label className="flex items-center gap-2 mb-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={wantsToMoveStage}
                  onChange={(e) => {
                    setWantsToMoveStage(e.target.checked);
                    if (!e.target.checked) setMoveToStageId("");
                  }}
                  className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary/20 accent-primary"
                />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Move Pipeline Stage
                </span>
              </label>
              {wantsToMoveStage && (
                <select
                  value={moveToStageId}
                  onChange={(e) => setMoveToStageId(e.target.value)}
                  disabled={fetchingOpp || stages.length === 0}
                  className="w-full text-sm px-3 py-2 border border-border rounded-[8px] bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors disabled:opacity-50"
                >
                  <option value="">Select a stage…</option>
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Add task toggle */}
            <label className="flex items-center gap-2 mb-3 cursor-pointer select-none">
              <input type="checkbox" checked={wantsToAddTask} onChange={(e) => setWantsToAddTask(e.target.checked)} className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary/20 accent-primary" />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Add a task</span>
            </label>

            {wantsToAddTask && (<>
            <div className="mb-3">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 block">
                Next Task <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={nextTask}
                onChange={(e) => setNextTask(e.target.value)}
                placeholder={`e.g. Send proposal to ${clientName}…`}
                className="w-full text-sm px-3 py-2 border border-border rounded-[8px] bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
              />
            </div>

            {/* Reminder date + time */}
            <div className="mb-3">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 block">
                Reminder <span className="text-destructive">*</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={reminderDate}
                  onChange={(e) => setReminderDate(e.target.value)}
                  className="flex-1 text-sm px-3 py-2 border border-border rounded-[8px] bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                />
                <input
                  type="time"
                  value={reminderTime}
                  onChange={(e) => setReminderTime(e.target.value)}
                  className="w-[110px] text-sm px-3 py-2 border border-border rounded-[8px] bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                />
              </div>
            </div>

            {/* Assigned to — dropdown with team members */}
            <div className="mb-5">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 block">
                Assigned To
              </label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-border rounded-[8px] bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
              >
                <option value={event.repName ?? event.repEmail ?? "You"}>
                  {event.repName ?? event.repEmail ?? "You"}
                </option>
                {teamMembers
                  .filter((m) => m.name !== (event.repName ?? event.repEmail))
                  .map((m) => (
                    <option key={m.email} value={m.name}>{m.name}</option>
                  ))
                }
              </select>
            </div>
            </>)}

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={() => setStep("outcomes")}
                disabled={saving}
                className="flex-1 py-2.5 text-sm font-semibold border border-border rounded-[10px] text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
              >
                Back
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !canSubmit}
                className={cn(
                  "flex-1 py-2.5 text-sm font-semibold rounded-[10px] transition-all",
                  canSubmit && !saving
                    ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                    : "bg-muted text-muted-foreground cursor-not-allowed"
                )}
              >
                {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1.5" />Saving…</> : "Submit"}
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
  const tz = useUserTimezone();
  const [outcomeModalOpen, setOutcomeModalOpen] = useState(false);
  const [prepModalOpen, setPrepModalOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [cardOpp, setCardOpp] = useState<GHLOpportunity | null>(null);
  const [cardStageName, setCardStageName] = useState("");
  const [cardLoading, setCardLoading] = useState(false);
  const [suggestedOutcome, setSuggestedOutcome] = useState<string | undefined>();
  const [suggestedNotes, setSuggestedNotes] = useState<string | undefined>();

  const isOverdue = event.isPast;
  const clientName = event.contactName || formatClientName(event.title);

  function handleDispositioned(eventId: string) {
    setLeaving(true);
    setTimeout(() => onDispositioned(eventId), 300);
  }

  async function openCard(e: React.MouseEvent) {
    e.stopPropagation(); // Prevent tile click from firing
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

  async function handleSetOutcome(e: React.MouseEvent) {
    e.stopPropagation(); // Prevent tile click from firing
    setOutcomeModalOpen(true);
    // Fetch AI suggestions in the background
    if (event.contactId && !suggestedOutcome) {
      try {
        const res = await fetch(`/api/contacts/${event.contactId}/call-insights`);
        const data = await res.json();
        if (data.insights?.suggestedOutcome) {
          setSuggestedOutcome(data.insights.suggestedOutcome);
        }
        if (data.insights?.suggestedNotes) {
          setSuggestedNotes(data.insights.suggestedNotes);
        }
      } catch {
        // Non-critical
      }
    }
  }

  return (
    <>
      <div
        data-r10n-call-tile
        data-state={isNext ? "next" : isOverdue ? "overdue" : "default"}
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
            <span data-r10n-call-badge data-state="next" className="text-[10px] font-bold uppercase tracking-widest bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
              Next
            </span>
          ) : isOverdue ? (
            <span data-r10n-call-badge data-state="overdue" className="text-[10px] font-bold uppercase tracking-widest bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
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
            {event.contactId && (
              <button
                onClick={(e) => { e.stopPropagation(); setPrepModalOpen(true); }}
                title="Pre-call prep"
                className="p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/[0.06] transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
              </button>
            )}
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

        {/* Call type — which GHL calendar was booked, so reps know what to prep */}
        {event.calendarName && (
          <span
            data-r10n-call-calendar
            className="inline-flex items-center gap-1 self-start max-w-full mb-1.5 px-2 py-0.5 rounded-full bg-primary/[0.06] ring-1 ring-inset ring-primary/15 text-[11px] font-medium text-primary"
            title={event.calendarName}
          >
            <CalendarCheck className="w-3 h-3 shrink-0" />
            <span className="truncate">{event.calendarName}</span>
          </span>
        )}

        {/* Time */}
        <p className="text-xs text-muted-foreground mb-4">
          {formatEventTime(event.startTime, tz)}
        </p>

        {/* Set Outcome button — separate from tile click */}
        <button
          onClick={handleSetOutcome}
          className="mt-auto w-full py-1.5 text-xs font-medium border border-border rounded-[7px] text-muted-foreground hover:border-primary hover:text-primary transition-colors"
        >
          Set Outcome
        </button>
      </div>

      {/* Call Prep Modal — opens via the prep (sparkles) icon, not the whole tile */}
      {prepModalOpen && event.contactId && (
        <CallPrepModal
          eventId={event.id}
          contactId={event.contactId}
          contactName={clientName}
          startTime={event.startTime}
          onClose={() => setPrepModalOpen(false)}
        />
      )}

      {/* Outcome Modal — opens when Set Outcome button is clicked */}
      {outcomeModalOpen && (
        <OutcomeModal
          event={event}
          clientName={clientName}
          onClose={() => setOutcomeModalOpen(false)}
          onDispositioned={handleDispositioned}
          suggestedOutcome={suggestedOutcome}
          suggestedNotes={suggestedNotes}
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
