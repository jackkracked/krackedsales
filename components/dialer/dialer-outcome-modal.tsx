"use client";

import { useState } from "react";
import { CalendarCheck, PhoneForwarded, ThumbsDown, Ban, PhoneMissed, PhoneOff, Voicemail, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface DialerOutcome {
  key: string;
  label: string;
  requeue: boolean;
}

type Tone = "success" | "info" | "muted" | "destructive";
const OPTIONS: { key: string; label: string; group: "connected" | "nocontact"; tone: Tone; requeue: boolean; icon: React.ReactNode }[] = [
  { key: "demo_booked", label: "Demo Booked", group: "connected", tone: "success", requeue: false, icon: <CalendarCheck className="h-4 w-4" /> },
  { key: "follow_up", label: "Follow-up", group: "connected", tone: "info", requeue: false, icon: <PhoneForwarded className="h-4 w-4" /> },
  { key: "not_interested", label: "Not Interested", group: "connected", tone: "muted", requeue: false, icon: <ThumbsDown className="h-4 w-4" /> },
  { key: "do_not_call", label: "Do Not Call", group: "connected", tone: "destructive", requeue: false, icon: <Ban className="h-4 w-4" /> },
  { key: "no_answer", label: "No Answer", group: "nocontact", tone: "muted", requeue: true, icon: <PhoneMissed className="h-4 w-4" /> },
  { key: "busy", label: "Busy", group: "nocontact", tone: "muted", requeue: true, icon: <PhoneOff className="h-4 w-4" /> },
  { key: "voicemail", label: "Voicemail", group: "nocontact", tone: "muted", requeue: true, icon: <Voicemail className="h-4 w-4" /> },
  { key: "bad_number", label: "Bad Number", group: "nocontact", tone: "destructive", requeue: false, icon: <AlertTriangle className="h-4 w-4" /> },
];

/**
 * Mandatory call-outcome modal: outcome grid → REQUIRED note + optional pipeline-stage
 * move (stages scoped to the contact's own pipeline). No dismiss; you must set an
 * outcome before the next contact loads.
 */
export function DialerOutcomeModal({
  contactName,
  durationLabel,
  onSave,
  stages,
  currentStageId,
  canMoveStage,
}: {
  contactName: string;
  durationLabel: string;
  onSave: (o: DialerOutcome, notes: string, stageId: string | null) => void;
  stages: { id: string; name: string }[];
  currentStageId: string | null;
  canMoveStage: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [moveStage, setMoveStage] = useState(false);
  const [stageId, setStageId] = useState<string | null>(null);
  const opt = OPTIONS.find((o) => o.key === selected) ?? null;
  const stageInvalid = moveStage && (!stageId || stageId === currentStageId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "var(--overlay)" }}>
      <div
        data-r10n-card
        className="w-full max-w-md overflow-hidden rounded-[16px] border border-border bg-card shadow-[0_24px_60px_-20px_rgba(28,35,51,0.4)] motion-safe:animate-[dialerFade_180ms_ease-out]"
      >
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-[15px] font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>Call outcome</h2>
          <p className="text-[12px] text-muted-foreground">{contactName} · {durationLabel}</p>
        </div>

        <div className="px-5 py-4 space-y-4">
          <Group title="Connected">
            {OPTIONS.filter((o) => o.group === "connected").map((o) => (
              <OutcomeBtn key={o.key} o={o} active={selected === o.key} onClick={() => setSelected(o.key)} />
            ))}
          </Group>
          <Group title="Didn't connect">
            {OPTIONS.filter((o) => o.group === "nocontact").map((o) => (
              <OutcomeBtn key={o.key} o={o} active={selected === o.key} onClick={() => setSelected(o.key)} />
            ))}
          </Group>

          {opt?.requeue && (
            <p className="rounded-[8px] bg-info-subtle px-3 py-2 text-[11.5px] font-medium text-info">
              Requeues to the back of the campaign for another attempt.
            </p>
          )}

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Notes <span className="text-destructive">*</span> <span className="font-normal normal-case tracking-normal text-muted-foreground/70">required</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="What happened on the call…"
              className="w-full resize-none rounded-[8px] border border-border bg-input px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-ring/60 focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>

          {canMoveStage && (
            <div>
              <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-medium text-foreground select-none">
                <input
                  type="checkbox"
                  checked={moveStage}
                  onChange={(e) => { setMoveStage(e.target.checked); if (!e.target.checked) setStageId(null); }}
                  className="h-3.5 w-3.5 accent-primary"
                />
                Move pipeline stage
              </label>
              {moveStage && (
                <select
                  value={stageId ?? ""}
                  onChange={(e) => setStageId(e.target.value || null)}
                  className="mt-2 w-full rounded-[8px] border border-border bg-input px-3 py-2 text-[13px] text-foreground focus:border-ring/60 focus:outline-none focus:ring-2 focus:ring-ring/20"
                >
                  <option value="">Select the new stage…</option>
                  {stages.map((s) => (
                    <option key={s.id} value={s.id} disabled={s.id === currentStageId}>
                      {s.name}{s.id === currentStageId ? " (current)" : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-border px-5 py-3.5">
          {opt && !notes.trim() && (
            <p className="mb-2 text-center text-[11.5px] font-medium text-muted-foreground">Add a note to save this outcome.</p>
          )}
          {opt && notes.trim() && stageInvalid && (
            <p className="mb-2 text-center text-[11.5px] font-medium text-muted-foreground">Pick the stage to move to, or uncheck &ldquo;Move pipeline stage&rdquo;.</p>
          )}
          <button
            type="button"
            disabled={!opt || !notes.trim() || stageInvalid}
            onClick={() => opt && notes.trim() && !stageInvalid && onSave({ key: opt.key, label: opt.label, requeue: opt.requeue }, notes.trim(), moveStage && stageId ? stageId : null)}
            className="flex h-11 w-full items-center justify-center rounded-[10px] bg-primary text-[14px] font-semibold text-primary-foreground transition-all duration-150 hover:brightness-110 active:scale-[0.99] disabled:opacity-35 disabled:pointer-events-none"
          >
            Save &amp; next contact
          </button>
        </div>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground/70">{title}</p>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </div>
  );
}

function OutcomeBtn({ o, active, onClick }: { o: (typeof OPTIONS)[number]; active: boolean; onClick: () => void }) {
  const toneCls: Record<Tone, string> = {
    success: "text-success",
    info: "text-info",
    muted: "text-muted-foreground",
    destructive: "text-destructive",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-[10px] border px-3 py-2.5 text-left text-[12.5px] font-medium transition-all duration-150 active:scale-[0.98]",
        active ? "border-primary/40 bg-primary/[0.06] text-foreground" : "border-border/70 bg-card hover:border-border hover:bg-muted/30",
      )}
    >
      <span className={cn(active ? "text-foreground" : toneCls[o.tone])}>{o.icon}</span>
      {o.label}
    </button>
  );
}
