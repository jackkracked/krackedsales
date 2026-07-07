"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, Save, Loader2, Check, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { VariableNode, tokensToPillHtml, pillHtmlToTokens } from "@/components/reminders/variable-extension";
import type { VarDef } from "@/lib/reminders/variables";
import type { ScheduleStep } from "@/lib/reminders/defaults";

export interface DraftTemplate {
  key: string;
  name: string;
  kind: "reminder" | "transactional";
  subject: string;
  bodyTemplate: string;
  ctaLabel: string;
  schedule: ScheduleStep[];
  notifyRep: boolean;
  enabled: boolean;
}

export interface ActiveMsg {
  subject: string;
  bodyTemplate: string;
  ctaLabel: string;
}

const GROUP_ORDER: VarDef["group"][] = ["Client", "Proposal", "Invoice", "Rep"];
const ORD = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th", "11th", "12th"];

export function EmailEditor({
  draft, activeMsg, selectedStep, variables, dirty, saving,
  onPatchMsg, onPatchDraft, onSelectStep, onAddStep, onRemoveStep, onStepDelay, onSave,
}: {
  draft: DraftTemplate;
  activeMsg: ActiveMsg;
  selectedStep: number; // -1 for transactional
  variables: VarDef[];
  dirty: boolean;
  saving: boolean;
  onPatchMsg: (p: Partial<ActiveMsg>) => void;
  onPatchDraft: (p: Partial<DraftTemplate>) => void;
  onSelectStep: (i: number) => void;
  onAddStep: () => void;
  onRemoveStep: (i: number) => void;
  onStepDelay: (i: number, days: number) => void;
  onSave: () => void;
}) {
  const subjectRef = useRef<HTMLInputElement>(null);
  const [focusTarget, setFocusTarget] = useState<"subject" | "body">("body");
  const isReminder = draft.kind === "reminder";
  const anchor: "sent" | "due" = draft.key === "invoice_reminder" ? "due" : "sent";
  const anchorPhrase = anchor === "due" ? "after it's due" : "after it's sent";
  const showCta = !(draft.kind === "transactional" && draft.key === "payment_receipt");

  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: false, blockquote: false, codeBlock: false, horizontalRule: false }), VariableNode],
    content: tokensToPillHtml(activeMsg.bodyTemplate),
    immediatelyRender: false,
    editorProps: { attributes: { class: "rmd-body-editor" } },
    onUpdate: ({ editor }) => onPatchMsg({ bodyTemplate: pillHtmlToTokens(editor.getHTML()) }),
    onFocus: () => setFocusTarget("body"),
  }, [draft.key, selectedStep]);

  // Rehydrate the body when the selected email OR step changes (not on every keystroke).
  const loadedRef = useRef(`${draft.key}:${selectedStep}`);
  useEffect(() => {
    const id = `${draft.key}:${selectedStep}`;
    if (editor && loadedRef.current !== id) {
      loadedRef.current = id;
      editor.commands.setContent(tokensToPillHtml(activeMsg.bodyTemplate));
    }
  }, [draft.key, selectedStep, activeMsg.bodyTemplate, editor]);

  function insertVariable(token: string) {
    if (focusTarget === "subject" && subjectRef.current) {
      const el = subjectRef.current;
      const start = el.selectionStart ?? activeMsg.subject.length;
      const end = el.selectionEnd ?? start;
      onPatchMsg({ subject: `${activeMsg.subject.slice(0, start)}{{${token}}}${activeMsg.subject.slice(end)}` });
      requestAnimationFrame(() => { el.focus(); const p = start + token.length + 4; el.setSelectionRange(p, p); });
    } else if (editor) {
      editor.chain().focus().insertContent({ type: "variable", attrs: { token } }).run();
    }
  }

  const grouped = GROUP_ORDER.map((g) => ({ group: g, items: variables.filter((v) => v.group === g) })).filter((x) => x.items.length);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{draft.name}</h1>
          <p className="text-xs text-muted-foreground">{isReminder ? "Automated reminder sequence" : "Sent automatically when it happens"}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {isReminder && (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <span className={cn("font-medium", draft.enabled ? "text-success" : "text-muted-foreground")}>{draft.enabled ? "On" : "Paused"}</span>
              <button type="button" role="switch" aria-checked={draft.enabled}
                aria-label={draft.enabled ? "Turn reminder off" : "Turn reminder on"}
                onClick={() => onPatchDraft({ enabled: !draft.enabled })}
                className={cn("relative h-5 w-9 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1", draft.enabled ? "bg-success" : "bg-muted-foreground/30")}>
                <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", draft.enabled ? "left-[18px]" : "left-0.5")} />
              </button>
            </label>
          )}
          {dirty || saving ? (
            <button type="button" onClick={onSave} disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-[8px] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-70">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? "Saving" : "Save"}
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2 py-2 text-sm font-medium text-success"><Check className="h-4 w-4" /> Saved</span>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-6 px-6 py-5">
        {draft.key === "invoice_reminder" && draft.enabled && (
          <div className="rounded-[8px] border border-warning/30 bg-warning-subtle px-3.5 py-2.5 text-xs text-warning">
            Stripe may still be sending its own invoice reminders. Turn those off in Stripe first, or clients could get two.
          </div>
        )}

        {/* Step tabs (reminders): each step is its own email in the sequence */}
        {isReminder && (
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sequence</label>
            <div className="flex flex-wrap items-center gap-1.5">
              {draft.schedule.map((step, i) => (
                <button key={i} type="button" onClick={() => onSelectStep(i)}
                  className={cn(
                    "group flex items-center gap-1.5 rounded-[8px] border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                    i === selectedStep ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/60",
                  )}>
                  <span>{ORD[i] ?? `#${i + 1}`}</span>
                  <span className="opacity-60">· day {step.delayDays}</span>
                  {draft.schedule.length > 1 && (
                    <span role="button" tabIndex={-1} aria-label={`Remove ${ORD[i] ?? `step ${i + 1}`}`}
                      onClick={(e) => { e.stopPropagation(); onRemoveStep(i); }}
                      className="ml-0.5 rounded p-0.5 text-current/50 hover:bg-destructive/10 hover:text-destructive">
                      <X className="h-3 w-3" />
                    </span>
                  )}
                </button>
              ))}
              <button type="button" onClick={onAddStep} disabled={draft.schedule.length >= 12}
                className="inline-flex items-center gap-1 rounded-[8px] border border-dashed border-border px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-40">
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>
            {/* Selected step's delay */}
            {selectedStep >= 0 && draft.schedule[selectedStep] && (
              <div className="mt-2.5 flex items-center gap-2 text-sm text-muted-foreground">
                <span>Send this email</span>
                <input type="number" min={0} max={365} value={draft.schedule[selectedStep].delayDays}
                  onChange={(e) => onStepDelay(selectedStep, parseInt(e.target.value, 10) || 0)}
                  aria-label="Days delay for this step"
                  className="w-14 rounded-[6px] border border-border bg-background px-2 py-1 text-center text-sm font-semibold tabular-nums text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                <span>{draft.schedule[selectedStep].delayDays === 1 ? "day" : "days"} {anchorPhrase}</span>
              </div>
            )}
          </div>
        )}

        {/* Subject */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subject</label>
          <input ref={subjectRef} value={activeMsg.subject} onChange={(e) => onPatchMsg({ subject: e.target.value })}
            onFocus={() => setFocusTarget("subject")}
            className="w-full rounded-[8px] border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
            placeholder="Subject line" />
        </div>

        {/* Variable palette */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Insert a variable</label>
          <div className="flex flex-wrap gap-3">
            {grouped.map(({ group, items }) => (
              <div key={group} className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</span>
                {items.map((v) => (
                  <button key={v.token} type="button" onClick={() => insertVariable(v.token)}
                    className="cursor-pointer rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                    {v.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Message</label>
          <div className="rounded-[8px] border border-border bg-background focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/30">
            <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
              <button type="button" onClick={() => editor?.chain().focus().toggleBold().run()} aria-label="Bold" aria-pressed={editor?.isActive("bold")}
                className={cn("rounded p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40", editor?.isActive("bold") && "bg-muted text-foreground")}>
                <Bold className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => editor?.chain().focus().toggleItalic().run()} aria-label="Italic" aria-pressed={editor?.isActive("italic")}
                className={cn("rounded p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40", editor?.isActive("italic") && "bg-muted text-foreground")}>
                <Italic className="h-3.5 w-3.5" />
              </button>
            </div>
            <EditorContent editor={editor} className="rmd-editor-wrap px-3 py-3 text-sm" />
          </div>
        </div>

        {/* CTA label */}
        {showCta && (
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Button label</label>
            <input value={activeMsg.ctaLabel} onChange={(e) => onPatchMsg({ ctaLabel: e.target.value })}
              className="w-full max-w-xs rounded-[8px] border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
              placeholder={draft.key === "invoice_reminder" ? "Pay invoice" : "Review & sign"} />
            <p className="mt-1 text-xs text-muted-foreground">The link is added automatically, so the button always works. Leave empty for no button.</p>
          </div>
        )}

        {/* Rep nudge (reminders) */}
        {isReminder && (
          <label className="flex cursor-pointer items-center gap-2 rounded-[10px] border border-border bg-muted/20 px-4 py-3 text-sm text-foreground">
            <input type="checkbox" checked={draft.notifyRep} onChange={(e) => onPatchDraft({ notifyRep: e.target.checked })}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30" />
            When they still don&apos;t respond after the last email, nudge the rep in Slack (@Gage)
          </label>
        )}
      </div>
    </div>
  );
}
