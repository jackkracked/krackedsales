"use client";

import { useEffect, useState } from "react";
import { X, Check, ArrowRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { stageClass, r10nStageColor } from "@/lib/contacts/stage-colors";
import type { UnifiedContact } from "@/lib/contacts/types";

interface Pipeline {
  id: string;
  name: string;
  stages: Array<{ id: string; name: string }>;
}

/**
 * Move a contact's pipeline stage, mirroring the call-outcome "Move Pipeline Stage"
 * step: pick the new stage from its pipeline + a required reason, then save. The move
 * + reason are logged to the contact's timeline via PATCH /api/ghl/opportunities/{id}.
 */
export function ChangeStageModal({
  contact,
  pipelines,
  onClose,
  onMoved,
}: {
  contact: UnifiedContact;
  pipelines: Pipeline[];
  onClose: () => void;
  onMoved: (newStageId: string, newStageName: string) => void;
}) {
  const pipeline = pipelines.find((p) => p.id === contact.pipelineId);
  const stages = pipeline?.stages ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(t);
  }, []);

  // Esc to close
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);

  const selectedStage = stages.find((s) => s.id === selectedId) ?? null;
  const isDifferent = selectedId != null && selectedId !== contact.stageId;
  const canSubmit = isDifferent && reason.trim().length > 0 && !submitting;

  async function handleSave() {
    if (!canSubmit || !selectedStage || !contact.opportunityId) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/ghl/opportunities/${contact.opportunityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipelineStageId: selectedStage.id,
          stageName: selectedStage.name,
          fromStageName: contact.stage,
          reason: reason.trim(),
          opportunityName: contact.name,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to move stage");
      }
      onMoved(selectedStage.id, selectedStage.name);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
    }
  }

  return (
    <div
      data-r10n-stagemodal-overlay
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 transition-opacity duration-200",
        mounted ? "opacity-100" : "opacity-0"
      )}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Move stage for ${contact.name}`}
        data-r10n-stagemodal
        className={cn(
          "bg-card border border-border rounded-[14px] w-full max-w-[440px] max-h-[85vh] flex flex-col shadow-2xl transition-all duration-200",
          mounted ? "opacity-100 scale-100" : "opacity-0 scale-[0.97]"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div data-r10n-stagemodal-header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border shrink-0">
          <div className="min-w-0">
            <p data-r10n-stagemodal-label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Move stage</p>
            <p data-r10n-stagemodal-name className="text-[15px] font-semibold text-foreground mt-0.5 truncate" style={{ fontFamily: "var(--font-heading)" }}>
              {contact.name}
            </p>
            {pipeline && (
              <p data-r10n-stagemodal-meta className="text-[11px] text-muted-foreground/80 mt-0.5 truncate">in {pipeline.name}</p>
            )}
            {contact.stage && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className="text-[11px] text-muted-foreground">Currently</span>
                <span data-r10n-stage-pill style={{ "--r10n-stage": r10nStageColor(contact.stage) } as Record<string, string>} className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border", stageClass(contact.stage))}>
                  {contact.stage}
                </span>
              </div>
            )}
          </div>
          <button onClick={onClose} data-r10n-stagemodal-close className="p-1.5 -mr-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stage list */}
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
          {stages.length === 0 ? (
            <div className="px-2 py-8 text-center">
              <p className="text-sm font-medium text-foreground mb-1">No stages available</p>
              <p className="text-xs text-muted-foreground">This contact isn&apos;t in a pipeline we can move.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {stages.map((s) => {
                const isCurrent = s.id === contact.stageId;
                const isSelected = s.id === selectedId;
                return (
                  <button
                    key={s.id}
                    onClick={() => setSelectedId(s.id)}
                    data-r10n-stageoption
                    data-selected={isSelected ? "true" : undefined}
                    data-current={isCurrent ? "true" : undefined}
                    className={cn(
                      "w-full flex items-center gap-3 px-2.5 py-2 rounded-[8px] border text-left transition-colors",
                      isSelected
                        ? "border-primary/40 bg-primary/[0.06]"
                        : "border-transparent hover:bg-muted/50"
                    )}
                  >
                    <span data-r10n-stageoption-radio className={cn(
                      "w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors",
                      isSelected ? "border-primary bg-primary" : "border-border"
                    )}>
                      {isSelected && <Check className="w-2.5 h-2.5 text-primary-foreground" strokeWidth={3} />}
                    </span>
                    <span data-r10n-stage-pill style={{ "--r10n-stage": r10nStageColor(s.name) } as Record<string, string>} className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border", stageClass(s.name))}>
                      {s.name}
                    </span>
                    {isCurrent && (
                      <span data-r10n-stageoption-current className="ml-auto text-[10px] text-muted-foreground/70 font-medium">Current</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Reason + actions */}
        {stages.length > 0 && (
          <div data-r10n-stagemodal-footer className="px-5 py-4 border-t border-border shrink-0 space-y-3">
            {/* Preview of the move */}
            {isDifferent && selectedStage && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span data-r10n-stage-pill style={{ "--r10n-stage": r10nStageColor(contact.stage) } as Record<string, string>} className={cn("inline-flex items-center px-1.5 py-0.5 rounded-full font-medium border", stageClass(contact.stage))}>{contact.stage ?? "—"}</span>
                <ArrowRight className="w-3 h-3 shrink-0" />
                <span data-r10n-stage-pill style={{ "--r10n-stage": r10nStageColor(selectedStage.name) } as Record<string, string>} className={cn("inline-flex items-center px-1.5 py-0.5 rounded-full font-medium border", stageClass(selectedStage.name))}>{selectedStage.name}</span>
              </div>
            )}
            <div>
              <label data-r10n-stagemodal-fieldlabel className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Reason for the move <span className="text-rose-500">*</span></label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why are you moving this contact?"
                rows={2}
                data-r10n-stagemodal-textarea
                className="mt-1 w-full px-3 py-2 text-sm border border-border rounded-[8px] bg-card resize-none placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/40 transition-all"
              />
            </div>

            {error && <p data-r10n-stagemodal-error className="text-xs text-rose-500 font-medium">{error}</p>}

            <div className="flex items-center justify-end gap-2">
              <button onClick={onClose} data-r10n-stagemodal-cancel className="px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground rounded-[8px] hover:bg-muted transition-colors">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!canSubmit}
                data-r10n-stagemodal-submit
                className="flex items-center gap-1.5 bg-primary text-primary-foreground rounded-[8px] px-4 py-1.5 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? (<><RefreshCw className="w-3.5 h-3.5 animate-spin" />Moving…</>) : "Move stage"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
