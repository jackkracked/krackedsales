"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, Save, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { VariableNode, tokensToPillHtml, pillHtmlToTokens } from "@/components/reminders/variable-extension";
import { ScheduleEditor } from "@/components/reminders/schedule-editor";
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

const GROUP_ORDER: VarDef["group"][] = ["Client", "Proposal", "Invoice", "Rep"];

export function EmailEditor({
  draft,
  variables,
  dirty,
  saving,
  onPatch,
  onSave,
}: {
  draft: DraftTemplate;
  variables: VarDef[];
  dirty: boolean;
  saving: boolean;
  onPatch: (patch: Partial<DraftTemplate>) => void;
  onSave: () => void;
}) {
  const subjectRef = useRef<HTMLInputElement>(null);
  const [focusTarget, setFocusTarget] = useState<"subject" | "body">("body");
  const isReminder = draft.kind === "reminder";
  const anchor: "sent" | "due" = draft.key === "invoice_reminder" ? "due" : "sent";

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, blockquote: false, codeBlock: false, horizontalRule: false }),
      VariableNode,
    ],
    content: tokensToPillHtml(draft.bodyTemplate),
    immediatelyRender: false,
    editorProps: { attributes: { class: "rmd-body-editor" } },
    onUpdate: ({ editor }) => onPatch({ bodyTemplate: pillHtmlToTokens(editor.getHTML()) }),
    onFocus: () => setFocusTarget("body"),
  }, [draft.key]);

  // Rehydrate the body when the SELECTED template changes (not on every keystroke).
  const loadedKey = useRef(draft.key);
  useEffect(() => {
    if (editor && loadedKey.current !== draft.key) {
      loadedKey.current = draft.key;
      editor.commands.setContent(tokensToPillHtml(draft.bodyTemplate));
    }
  }, [draft.key, draft.bodyTemplate, editor]);

  function insertVariable(token: string) {
    if (focusTarget === "subject" && subjectRef.current) {
      const el = subjectRef.current;
      const start = el.selectionStart ?? draft.subject.length;
      const end = el.selectionEnd ?? start;
      const next = `${draft.subject.slice(0, start)}{{${token}}}${draft.subject.slice(end)}`;
      onPatch({ subject: next });
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + token.length + 4;
        el.setSelectionRange(pos, pos);
      });
    } else if (editor) {
      editor.chain().focus().insertContent({ type: "variable", attrs: { token } }).run();
    }
  }

  const grouped = GROUP_ORDER.map((g) => ({ group: g, items: variables.filter((v) => v.group === g) })).filter((x) => x.items.length);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header: name + enable + save */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
            {draft.name}
          </h1>
          <p className="text-xs text-muted-foreground">
            {isReminder ? "Automated reminder email" : "Sent automatically when it happens"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {isReminder && (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <span className={cn("font-medium", draft.enabled ? "text-emerald-600" : "text-muted-foreground")}>
                {draft.enabled ? "On" : "Paused"}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={draft.enabled}
                onClick={() => onPatch({ enabled: !draft.enabled })}
                className={cn(
                  "relative h-5 w-9 rounded-full transition-colors",
                  draft.enabled ? "bg-emerald-500" : "bg-muted-foreground/30",
                )}
              >
                <span className={cn(
                  "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all",
                  draft.enabled ? "left-[18px]" : "left-0.5",
                )} />
              </button>
            </label>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || saving}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[8px] px-4 py-2 text-sm font-semibold transition-colors",
              dirty && !saving
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground",
            )}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : dirty ? <Save className="h-4 w-4" /> : <Check className="h-4 w-4" />}
            {saving ? "Saving" : dirty ? "Save" : "Saved"}
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-6 px-6 py-5">
        {/* Enabling-invoice warning */}
        {draft.key === "invoice_reminder" && draft.enabled && (
          <div className="rounded-[8px] border border-amber-300/50 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
            Stripe may still be sending its own invoice reminders. Turn those off in Stripe first, or clients could get two.
          </div>
        )}

        {/* Subject */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subject</label>
          <input
            ref={subjectRef}
            value={draft.subject}
            onChange={(e) => onPatch({ subject: e.target.value })}
            onFocus={() => setFocusTarget("subject")}
            className="w-full rounded-[8px] border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
            placeholder="Subject line"
          />
        </div>

        {/* Variable palette */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Insert a variable
          </label>
          <div className="flex flex-wrap gap-3">
            {grouped.map(({ group, items }) => (
              <div key={group} className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-medium text-muted-foreground/60">{group}</span>
                {items.map((v) => (
                  <button
                    key={v.token}
                    type="button"
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", `{{${v.token}}}`)}
                    onClick={() => insertVariable(v.token)}
                    className="rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                  >
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
              <button type="button" onClick={() => editor?.chain().focus().toggleBold().run()}
                aria-label="Bold"
                className={cn("rounded p-1 text-muted-foreground hover:bg-muted", editor?.isActive("bold") && "bg-muted text-foreground")}>
                <Bold className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => editor?.chain().focus().toggleItalic().run()}
                aria-label="Italic"
                className={cn("rounded p-1 text-muted-foreground hover:bg-muted", editor?.isActive("italic") && "bg-muted text-foreground")}>
                <Italic className="h-3.5 w-3.5" />
              </button>
            </div>
            <EditorContent editor={editor} className="rmd-editor-wrap px-3 py-3 text-sm" />
          </div>
        </div>

        {/* CTA label */}
        {draft.kind === "transactional" && draft.key === "payment_receipt" ? null : (
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Button label
            </label>
            <input
              value={draft.ctaLabel}
              onChange={(e) => onPatch({ ctaLabel: e.target.value })}
              className="w-full max-w-xs rounded-[8px] border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
              placeholder={draft.key === "invoice_reminder" ? "Pay invoice" : "Review & sign"}
            />
            <p className="mt-1 text-xs text-muted-foreground/70">
              The link is added automatically, so the button always works. Leave empty for no button.
            </p>
          </div>
        )}

        {/* Schedule (reminders only) */}
        {isReminder && (
          <div className="space-y-4 rounded-[10px] border border-border bg-muted/20 p-4">
            <ScheduleEditor schedule={draft.schedule} anchor={anchor} onChange={(schedule) => onPatch({ schedule })} />
            <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={draft.notifyRep}
                onChange={(e) => onPatch({ notifyRep: e.target.checked })}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
              />
              When they still don&apos;t respond, nudge the rep in Slack (@Gage)
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
