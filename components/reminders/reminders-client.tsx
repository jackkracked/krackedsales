"use client";

import { useEffect, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BellRing, Mail, AlertCircle, Eye, BarChart2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { EmailEditor, type DraftTemplate, type ActiveMsg } from "@/components/reminders/email-editor";
import { PreviewPane } from "@/components/reminders/preview-pane";
import { ActivityPanel } from "@/components/reminders/activity-panel";
import type { VarDef, PreviewScenario } from "@/lib/reminders/variables";
import type { ScheduleStep } from "@/lib/reminders/defaults";

interface TemplateRow extends DraftTemplate { activeFrom: string | null; updatedAt: string }
interface ApiData { templates: TemplateRow[]; variables: VarDef[]; scenarios: PreviewScenario[] }

const CORE = (t: DraftTemplate) =>
  JSON.stringify({ subject: t.subject, bodyTemplate: t.bodyTemplate, ctaLabel: t.ctaLabel, schedule: t.schedule, notifyRep: t.notifyRep, enabled: t.enabled });

function toDraft(t: TemplateRow): DraftTemplate {
  return {
    key: t.key, name: t.name, kind: t.kind, subject: t.subject, bodyTemplate: t.bodyTemplate,
    ctaLabel: t.ctaLabel, schedule: (t.schedule as ScheduleStep[]) ?? [], notifyRep: t.notifyRep, enabled: t.enabled,
  };
}
const anchorFor = (key: string): "sent" | "due" => (key === "invoice_reminder" ? "due" : "sent");

export function RemindersClient() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery<ApiData>({
    queryKey: ["reminder-templates"],
    queryFn: async () => { const res = await fetch("/api/reminders/templates"); if (!res.ok) throw new Error("Failed to load"); return res.json(); },
  });

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedStep, setSelectedStep] = useState(0);
  const [draft, setDraft] = useState<DraftTemplate | null>(null);
  const [scenarioId, setScenarioId] = useState("retainer");
  const [rightTab, setRightTab] = useState<"preview" | "activity">("preview");
  const [preview, setPreview] = useState<{ subject: string; html: string }>({ subject: "", html: "" });
  const [previewLoading, setPreviewLoading] = useState(false);
  const [testState, setTestState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const templates = data?.templates ?? [];
  const server = templates.find((t) => t.key === selectedKey) ?? null;
  const dirty = !!(draft && server && CORE(draft) !== CORE(toDraft(server)));
  const isReminder = draft?.kind === "reminder";

  // active messaging = the selected step (reminders) or the template body (transactional)
  const step = isReminder && draft ? draft.schedule[selectedStep] ?? draft.schedule[0] : null;
  const activeMsg: ActiveMsg = step
    ? { subject: step.subject ?? "", bodyTemplate: step.bodyTemplate ?? "", ctaLabel: step.ctaLabel ?? "" }
    : draft ? { subject: draft.subject, bodyTemplate: draft.bodyTemplate, ctaLabel: draft.ctaLabel } : { subject: "", bodyTemplate: "", ctaLabel: "" };

  useEffect(() => {
    if (!selectedKey && templates.length) { setSelectedKey(templates[0].key); setDraft(toDraft(templates[0])); setSelectedStep(0); }
  }, [templates, selectedKey]);

  const selectTemplate = useCallback((key: string) => {
    if (dirty && !window.confirm("Discard your unsaved changes?")) return;
    const t = templates.find((x) => x.key === key);
    if (t) { setSelectedKey(key); setDraft(toDraft(t)); setSelectedStep(0); setTestState("idle"); setRightTab("preview"); }
  }, [dirty, templates]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // Debounced live preview of the ACTIVE step.
  useEffect(() => {
    if (!draft) return;
    setPreviewLoading(true);
    const id = setTimeout(async () => {
      try {
        const res = await fetch("/api/reminders/preview", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: draft.key, subject: activeMsg.subject, bodyTemplate: activeMsg.bodyTemplate, ctaLabel: activeMsg.ctaLabel, scenarioId }),
        });
        if (res.ok) setPreview(await res.json());
      } finally { setPreviewLoading(false); }
    }, 250);
    return () => clearTimeout(id);
  }, [draft?.key, activeMsg.subject, activeMsg.bodyTemplate, activeMsg.ctaLabel, scenarioId]);

  const saveMutation = useMutation({
    mutationFn: async (d: DraftTemplate) => {
      const res = await fetch("/api/reminders/templates", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Save failed");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reminder-templates"] }),
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/reminders/test", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: draft!.key, scenarioId, subject: activeMsg.subject, bodyTemplate: activeMsg.bodyTemplate, ctaLabel: activeMsg.ctaLabel }) });
      if (!res.ok) throw new Error("Test failed");
      return res.json();
    },
    onMutate: () => setTestState("sending"),
    onSuccess: () => { setTestState("sent"); setTimeout(() => setTestState("idle"), 3000); },
    onError: () => setTestState("error"),
  });

  // ── step ops (reminders) ─────────────────────────────────────────────────────
  const patchMsg = useCallback((p: Partial<ActiveMsg>) => {
    setDraft((d) => {
      if (!d) return d;
      if (d.kind === "reminder") {
        const sched = [...d.schedule];
        sched[selectedStep] = { ...sched[selectedStep], ...p };
        return { ...d, schedule: sched };
      }
      return { ...d, ...p };
    });
  }, [selectedStep]);

  const patchDraft = useCallback((p: Partial<DraftTemplate>) => setDraft((d) => (d ? { ...d, ...p } : d)), []);

  const addStep = useCallback(() => {
    setDraft((d) => {
      if (!d) return d;
      const last = d.schedule[d.schedule.length - 1];
      const next: ScheduleStep = {
        id: crypto.randomUUID(), // stable id so dedup never re-sends after edits
        delayDays: (last?.delayDays ?? 0) + 3, anchor: anchorFor(d.key),
        subject: last?.subject ?? d.subject, bodyTemplate: last?.bodyTemplate ?? d.bodyTemplate, ctaLabel: last?.ctaLabel ?? d.ctaLabel,
      };
      return { ...d, schedule: [...d.schedule, next] };
    });
    setSelectedStep(draft ? draft.schedule.length : 0);
  }, [draft]);

  const removeStep = useCallback((i: number) => {
    setDraft((d) => (d ? { ...d, schedule: d.schedule.filter((_, idx) => idx !== i) } : d));
    setSelectedStep((s) => Math.max(0, s >= i ? s - 1 : s));
  }, []);

  const stepDelay = useCallback((i: number, days: number) => {
    setDraft((d) => (d ? { ...d, schedule: d.schedule.map((s, idx) => (idx === i ? { ...s, delayDays: Math.max(0, Math.min(365, days)) } : s)) } : d));
  }, []);

  const reminders = templates.filter((t) => t.kind === "reminder");
  const emails = templates.filter((t) => t.kind === "transactional");

  return (
    <div className="flex h-full overflow-hidden bg-background">
      {/* Left rail */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-border">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>Client emails</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Reminders &amp; transactional</p>
        </div>
        <nav className="flex-1 overflow-y-auto p-3">
          {isError && (
            <div className="flex items-center gap-2 rounded-[8px] bg-destructive/8 px-3 py-2.5 text-destructive">
              <AlertCircle className="h-4 w-4" /><span className="text-xs">Failed to load</span>
            </div>
          )}
          {isLoading && <RailSkeleton />}
          {(["reminder", "transactional"] as const).map((kind) => {
            const items = kind === "reminder" ? reminders : emails;
            if (!items.length) return null;
            return (
              <div key={kind} className="mb-4">
                <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{kind === "reminder" ? "Reminders" : "Emails"}</p>
                <ul className="space-y-0.5">
                  {items.map((t) => {
                    const Icon = kind === "reminder" ? BellRing : Mail;
                    const active = t.key === selectedKey;
                    return (
                      <li key={t.key}>
                        <button type="button" onClick={() => selectTemplate(t.key)} title={t.name}
                          className={cn("flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                            active ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted/60")}>
                          <Icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                          <span className="flex-1 truncate text-sm font-medium">{t.name}</span>
                          {kind === "reminder" && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", t.enabled ? "bg-success" : "bg-muted-foreground/30")} />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
      </aside>

      {draft ? (
        <div className="flex min-w-0 flex-1 flex-col xl:flex-row">
          <div className="min-w-0 flex-1 xl:border-r xl:border-border">
            <EmailEditor
              draft={draft} activeMsg={activeMsg} selectedStep={isReminder ? selectedStep : -1}
              variables={data?.variables ?? []} dirty={dirty} saving={saveMutation.isPending}
              onPatchMsg={patchMsg} onPatchDraft={patchDraft}
              onSelectStep={setSelectedStep} onAddStep={addStep} onRemoveStep={removeStep} onStepDelay={stepDelay}
              onSave={() => saveMutation.mutate(draft)}
            />
            {saveMutation.isError && <p className="px-6 pb-3 text-xs text-destructive">{(saveMutation.error as Error).message}</p>}
          </div>

          <div className="flex h-[45vh] w-full shrink-0 flex-col border-t border-border xl:h-auto xl:w-[44%] xl:border-t-0">
            {/* right-pane tabs */}
            <div className="flex items-center gap-1 border-b border-border px-4 py-2">
              <RightTab active={rightTab === "preview"} onClick={() => setRightTab("preview")} icon={Eye} label="Preview" />
              {isReminder && <RightTab active={rightTab === "activity"} onClick={() => setRightTab("activity")} icon={BarChart2} label="Activity" />}
            </div>
            <div className="min-h-0 flex-1">
              {rightTab === "preview" ? (
                <PreviewPane subject={preview.subject} html={preview.html} loading={previewLoading}
                  scenarios={data?.scenarios ?? []} scenarioId={scenarioId} onScenario={setScenarioId}
                  onSendTest={() => draft && testMutation.mutate()} testState={testState} />
              ) : (
                <ActivityPanel templateKey={draft.key} schedule={draft.schedule} />
              )}
            </div>
          </div>
        </div>
      ) : (!isLoading && !isError && <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Select an email to edit.</div>)}
    </div>
  );
}

function RightTab({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: React.ElementType; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={cn("inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/60")}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

function RailSkeleton() {
  return <div className="space-y-2 p-1">{[0, 1, 2, 3].map((i) => <div key={i} className="h-9 animate-pulse rounded-[8px] bg-muted/50" />)}</div>;
}
