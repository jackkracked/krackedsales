"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BellRing, Mail, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { EmailEditor, type DraftTemplate } from "@/components/reminders/email-editor";
import { PreviewPane } from "@/components/reminders/preview-pane";
import type { VarDef, PreviewScenario } from "@/lib/reminders/variables";
import type { ScheduleStep } from "@/lib/reminders/defaults";

interface TemplateRow extends DraftTemplate {
  activeFrom: string | null;
  updatedAt: string;
}
interface ApiData {
  templates: TemplateRow[];
  variables: VarDef[];
  scenarios: PreviewScenario[];
}

const CORE = (t: DraftTemplate) =>
  JSON.stringify({ subject: t.subject, bodyTemplate: t.bodyTemplate, ctaLabel: t.ctaLabel, schedule: t.schedule, notifyRep: t.notifyRep, enabled: t.enabled });

function toDraft(t: TemplateRow): DraftTemplate {
  return {
    key: t.key, name: t.name, kind: t.kind, subject: t.subject, bodyTemplate: t.bodyTemplate,
    ctaLabel: t.ctaLabel, schedule: (t.schedule as ScheduleStep[]) ?? [], notifyRep: t.notifyRep, enabled: t.enabled,
  };
}

export function RemindersClient() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery<ApiData>({
    queryKey: ["reminder-templates"],
    queryFn: async () => {
      const res = await fetch("/api/reminders/templates");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftTemplate | null>(null);
  const [scenarioId, setScenarioId] = useState("retainer");
  const [preview, setPreview] = useState<{ subject: string; html: string }>({ subject: "", html: "" });
  const [previewLoading, setPreviewLoading] = useState(false);
  const [testState, setTestState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const templates = data?.templates ?? [];
  const server = templates.find((t) => t.key === selectedKey) ?? null;
  const dirty = !!(draft && server && CORE(draft) !== CORE(toDraft(server)));

  // Initialise selection + draft once loaded.
  useEffect(() => {
    if (!selectedKey && templates.length) {
      setSelectedKey(templates[0].key);
      setDraft(toDraft(templates[0]));
    }
  }, [templates, selectedKey]);

  const selectTemplate = useCallback((key: string) => {
    if (dirty && !window.confirm("Discard your unsaved changes?")) return;
    const t = templates.find((x) => x.key === key);
    if (t) { setSelectedKey(key); setDraft(toDraft(t)); setTestState("idle"); }
  }, [dirty, templates]);

  // Warn on tab close with unsaved edits.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // Debounced live preview.
  useEffect(() => {
    if (!draft) return;
    setPreviewLoading(true);
    const id = setTimeout(async () => {
      try {
        const res = await fetch("/api/reminders/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: draft.key, subject: draft.subject, bodyTemplate: draft.bodyTemplate, ctaLabel: draft.ctaLabel, scenarioId }),
        });
        if (res.ok) setPreview(await res.json());
      } finally {
        setPreviewLoading(false);
      }
    }, 250);
    return () => clearTimeout(id);
  }, [draft, scenarioId]);

  const saveMutation = useMutation({
    mutationFn: async (d: DraftTemplate) => {
      const res = await fetch("/api/reminders/templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(d),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Save failed");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reminder-templates"] }),
  });

  const testMutation = useMutation({
    mutationFn: async (d: DraftTemplate) => {
      const res = await fetch("/api/reminders/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: d.key, scenarioId }),
      });
      if (!res.ok) throw new Error("Test failed");
      return res.json();
    },
    onMutate: () => setTestState("sending"),
    onSuccess: () => { setTestState("sent"); setTimeout(() => setTestState("idle"), 3000); },
    onError: () => setTestState("error"), // stays visible until the next attempt
  });

  const patch = useCallback((p: Partial<DraftTemplate>) => setDraft((d) => (d ? { ...d, ...p } : d)), []);

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
                <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {kind === "reminder" ? "Reminders" : "Emails"}
                </p>
                <ul className="space-y-0.5">
                  {items.map((t) => {
                    const Icon = kind === "reminder" ? BellRing : Mail;
                    const active = t.key === selectedKey;
                    return (
                      <li key={t.key}>
                        <button
                          type="button"
                          onClick={() => selectTemplate(t.key)}
                          title={t.name}
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                            active ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted/60",
                          )}
                        >
                          <Icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                          <span className="flex-1 truncate text-sm font-medium">{t.name}</span>
                          {kind === "reminder" && (
                            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", t.enabled ? "bg-success" : "bg-muted-foreground/30")} />
                          )}
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

      {/* Editor + preview */}
      {draft ? (
        <div className="flex min-w-0 flex-1 flex-col xl:flex-row">
          <div className="min-w-0 flex-1 xl:border-r xl:border-border">
            <EmailEditor
              draft={draft}
              variables={data?.variables ?? []}
              dirty={dirty}
              saving={saveMutation.isPending}
              onPatch={patch}
              onSave={() => saveMutation.mutate(draft)}
            />
            {saveMutation.isError && (
              <p className="px-6 pb-3 text-xs text-destructive">{(saveMutation.error as Error).message}</p>
            )}
          </div>
          <div className="h-[45vh] w-full shrink-0 border-t border-border xl:h-auto xl:w-[44%] xl:border-t-0">
            <PreviewPane
              subject={preview.subject}
              html={preview.html}
              loading={previewLoading}
              scenarios={data?.scenarios ?? []}
              scenarioId={scenarioId}
              onScenario={setScenarioId}
              onSendTest={() => draft && testMutation.mutate(draft)}
              testState={testState}
            />
          </div>
        </div>
      ) : (
        !isLoading && !isError && <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Select an email to edit.</div>
      )}
    </div>
  );
}

function RailSkeleton() {
  return (
    <div className="space-y-2 p-1">
      {[0, 1, 2, 3].map((i) => <div key={i} className="h-9 animate-pulse rounded-[8px] bg-muted/50" />)}
    </div>
  );
}
