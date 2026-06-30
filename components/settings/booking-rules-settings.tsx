"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Zap, RefreshCw, Trash2, Plus, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface BookingRule {
  id: string;
  ghlCalendarId: string;
  calendarName: string;
  trigger: string;
  pipelineId: string;
  stageId: string;
  stageName: string;
  isActive: boolean;
}

interface GHLStage {
  id: string;
  name: string;
  position?: number;
}

interface GHLPipeline {
  id: string;
  name: string;
  stages: GHLStage[];
}

async function fetchBookingRules(): Promise<BookingRule[]> {
  const res = await fetch("/api/settings/booking-rules");
  if (!res.ok) throw new Error("Failed to load booking rules");
  const data = await res.json();
  return data.bookingRules;
}

async function fetchPipelines(): Promise<GHLPipeline[]> {
  const res = await fetch("/api/ghl/pipelines");
  if (!res.ok) throw new Error("Failed to load pipelines");
  const data = await res.json();
  return data.pipelines ?? [];
}

async function createBookingRule(payload: {
  ghlCalendarId: string;
  calendarName: string;
  trigger: string;
  pipelineId: string;
  stageId: string;
  stageName: string;
}): Promise<BookingRule> {
  const res = await fetch("/api/settings/booking-rules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to create rule");
  return data.bookingRule;
}

async function deleteBookingRule(id: string): Promise<void> {
  const res = await fetch(`/api/settings/booking-rules/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to delete rule");
  }
}

async function toggleBookingRule(id: string, isActive: boolean): Promise<void> {
  const res = await fetch(`/api/settings/booking-rules/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isActive }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to update rule");
  }
}

const INPUT_CLASS = cn(
  "w-full rounded-[6px] border border-border bg-background px-3 py-2",
  "text-sm text-foreground placeholder:text-muted-foreground",
  "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
  "transition-colors"
);

const SELECT_CLASS = cn(
  "w-full rounded-[6px] border border-border bg-background px-3 py-2",
  "text-sm text-foreground",
  "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
  "transition-colors"
);

function TriggerBadge({ trigger }: { trigger: string }) {
  const isConfirmed = trigger === "call_confirmed";
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
        isConfirmed
          ? "bg-green-100 text-green-700"
          : "bg-blue-100 text-blue-700"
      )}
    >
      {isConfirmed ? "Confirmed" : "Booked"}
    </span>
  );
}

export function BookingRulesSettings() {
  const queryClient = useQueryClient();

  const { data: rules = [], isLoading: rulesLoading } = useQuery<BookingRule[]>({
    queryKey: ["booking-rules"],
    queryFn: fetchBookingRules,
  });

  const { data: pipelines = [], isLoading: pipelinesLoading } = useQuery<GHLPipeline[]>({
    queryKey: ["ghl-pipelines"],
    queryFn: fetchPipelines,
  });

  // Form state
  const [ghlCalendarId, setGhlCalendarId] = useState("");
  const [calendarName, setCalendarName] = useState("");
  const [trigger, setTrigger] = useState<"call_booked" | "call_confirmed">("call_booked");
  const [selectedPipelineId, setSelectedPipelineId] = useState("");
  const [selectedStageId, setSelectedStageId] = useState("");
  const [addSuccess, setAddSuccess] = useState(false);

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId) ?? null;
  const selectedStage = selectedPipeline?.stages.find((s) => s.id === selectedStageId) ?? null;

  function handlePipelineChange(pipelineId: string) {
    setSelectedPipelineId(pipelineId);
    setSelectedStageId(""); // reset stage when pipeline changes
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["booking-rules"] });

  const createMutation = useMutation({
    mutationFn: createBookingRule,
    onSuccess: () => {
      invalidate();
      setGhlCalendarId("");
      setCalendarName("");
      setTrigger("call_booked");
      setSelectedPipelineId("");
      setSelectedStageId("");
      setAddSuccess(true);
      setTimeout(() => setAddSuccess(false), 3000);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteBookingRule,
    onSuccess: invalidate,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      toggleBookingRule(id, isActive),
    onSuccess: invalidate,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedStage || !selectedPipeline) return;
    createMutation.mutate({
      ghlCalendarId,
      calendarName,
      trigger,
      pipelineId: selectedPipeline.id,
      stageId: selectedStage.id,
      stageName: selectedStage.name,
    });
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`Delete rule for "${name}"? This cannot be undone.`)) return;
    deleteMutation.mutate(id);
  }

  const canSubmit =
    ghlCalendarId.trim() &&
    calendarName.trim() &&
    trigger &&
    selectedPipelineId &&
    selectedStageId;

  return (
    <div className="bg-card border border-border rounded-[10px] p-5" data-r10n-settings-card>
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <Zap className="w-4 h-4 text-muted-foreground" data-r10n-settings-cardicon />
        <h2
          className="text-sm font-semibold text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
          data-r10n-settings-cardtitle
        >
          Booking Automation Rules
        </h2>
      </div>
      <p className="text-xs text-muted-foreground mb-5">
        When a call is booked or confirmed on a calendar, automatically move the opportunity to a stage.
      </p>

      {/* Existing rows */}
      {rulesLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-5">
          <RefreshCw className="w-3 h-3 animate-spin" />
          Loading…
        </div>
      ) : rules.length > 0 ? (
        <div className="mb-5 rounded-[8px] border border-border overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_auto_1fr_auto_auto] items-center gap-3 px-3.5 py-2 border-b border-border bg-muted/30">
            <span className="text-xs font-medium text-muted-foreground">Calendar</span>
            <span className="text-xs font-medium text-muted-foreground">Trigger</span>
            <span className="text-xs font-medium text-muted-foreground">Pipeline → Stage</span>
            <span className="text-xs font-medium text-muted-foreground">Active</span>
            <span className="w-7" />
          </div>

          {/* Table rows */}
          {rules.map((rule, i) => (
            <div
              key={rule.id}
              className={cn(
                "grid grid-cols-[1fr_auto_1fr_auto_auto] items-center gap-3 px-3.5 py-2.5",
                i < rules.length - 1 && "border-b border-border"
              )}
            >
              <div>
                <p className="text-sm font-medium text-foreground truncate">{rule.calendarName}</p>
                <p className="text-xs text-muted-foreground font-mono truncate">{rule.ghlCalendarId}</p>
              </div>

              <TriggerBadge trigger={rule.trigger} />

              <span className="text-sm text-muted-foreground truncate">
                {rule.stageName}
              </span>

              {/* Active toggle */}
              <button
                type="button"
                onClick={() => toggleMutation.mutate({ id: rule.id, isActive: !rule.isActive })}
                disabled={toggleMutation.isPending}
                data-r10n-settings-toggle
                data-state={rule.isActive ? "on" : "off"}
                className={cn(
                  "relative w-9 h-5 rounded-full transition-colors flex-shrink-0",
                  rule.isActive ? "bg-primary" : "bg-border",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
                aria-label={rule.isActive ? "Deactivate" : "Activate"}
              >
                <span
                  className={cn(
                    "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
                    rule.isActive && "translate-x-4"
                  )}
                />
              </button>

              {/* Delete */}
              <button
                type="button"
                onClick={() => handleDelete(rule.id, rule.calendarName)}
                disabled={deleteMutation.isPending}
                className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                aria-label="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-5 px-3.5 py-3 rounded-[8px] border border-dashed border-border text-xs text-muted-foreground">
          No rules yet — add the first one below.
        </div>
      )}

      {/* Add form */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          Add Rule
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">GHL Calendar ID</label>
            <input
              type="text"
              value={ghlCalendarId}
              onChange={(e) => setGhlCalendarId(e.target.value)}
              placeholder="calendar_abc123"
              className={INPUT_CLASS}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Calendar Name</label>
            <input
              type="text"
              value={calendarName}
              onChange={(e) => setCalendarName(e.target.value)}
              placeholder="Sarah's Discovery Calls"
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Trigger</label>
          <select
            value={trigger}
            onChange={(e) => setTrigger(e.target.value as "call_booked" | "call_confirmed")}
            className={SELECT_CLASS}
          >
            <option value="call_booked">Booked — fires when a call is first scheduled</option>
            <option value="call_confirmed">Confirmed — fires when a call is confirmed</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Pipeline</label>
            <select
              value={selectedPipelineId}
              onChange={(e) => handlePipelineChange(e.target.value)}
              disabled={pipelinesLoading}
              className={SELECT_CLASS}
            >
              <option value="">
                {pipelinesLoading ? "Loading pipelines…" : "Select a pipeline"}
              </option>
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Stage</label>
            <select
              value={selectedStageId}
              onChange={(e) => setSelectedStageId(e.target.value)}
              disabled={!selectedPipeline}
              className={cn(SELECT_CLASS, !selectedPipeline && "opacity-50 cursor-not-allowed")}
            >
              <option value="">
                {!selectedPipeline ? "Select a pipeline first" : "Select a stage"}
              </option>
              {(selectedPipeline?.stages ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={!canSubmit || createMutation.isPending}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-[6px] text-sm font-medium transition-colors",
              "bg-primary text-white hover:bg-primary/90",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {createMutation.isPending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            Add Rule
          </button>

          {addSuccess && (
            <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Rule added
            </span>
          )}
          {createMutation.isError && (
            <span className="text-xs text-destructive">
              {(createMutation.error as Error).message}
            </span>
          )}
          {deleteMutation.isError && (
            <span className="text-xs text-destructive">
              {(deleteMutation.error as Error).message}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
