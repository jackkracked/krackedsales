"use client";

import { useState } from "react";
import { Presentation, ListTodo, ClipboardCheck, X } from "lucide-react";

const META = {
  demo: { title: "Create demo", primary: "Create demo", icon: Presentation, toast: "Demo created" },
  task: { title: "Create task", primary: "Create task", icon: ListTodo, toast: "Task created" },
  audit: { title: "Create audit", primary: "Create audit", icon: ClipboardCheck, toast: "Audit created" },
} as const;

export type QuickActionKind = keyof typeof META;

const INPUT =
  "w-full rounded-[8px] border border-border bg-input px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-ring/60 focus:outline-none focus:ring-2 focus:ring-ring/20";

/** Compact create-modal for Demo / Task / Audit, reachable during a call from the
 *  cockpit. Preview-functional: validates + confirms (real GHL/ClickUp wiring lands
 *  in the build). */
export function QuickActionModal({
  kind,
  contactName,
  onClose,
  onCreated,
}: {
  kind: QuickActionKind;
  contactName: string;
  onClose: () => void;
  onCreated: (toast: string) => void;
}) {
  const m = META[kind];
  const Icon = m.icon;
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("today");
  const [notes, setNotes] = useState("");
  const canSave = kind === "task" ? title.trim().length > 0 : true;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "var(--overlay)" }}>
      <div
        data-r10n-card
        className="w-full max-w-md overflow-hidden rounded-[16px] border border-border bg-card shadow-[0_24px_60px_-20px_rgba(28,35,51,0.4)] motion-safe:animate-[dialerFade_180ms_ease-out]"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-info/10 text-info"><Icon className="h-4 w-4" /></span>
            <div>
              <h2 className="text-[15px] font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{m.title}</h2>
              <p className="text-[11.5px] text-muted-foreground">for {contactName}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          {kind === "task" && (
            <>
              <Field label="Task">
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Send the pricing one-pager" className={INPUT} autoFocus />
              </Field>
              <Field label="Due">
                <select value={due} onChange={(e) => setDue(e.target.value)} className={INPUT}>
                  <option value="today">Today</option>
                  <option value="tomorrow">Tomorrow</option>
                  <option value="week">This week</option>
                </select>
              </Field>
            </>
          )}
          <Field label={kind === "task" ? "Notes (optional)" : kind === "demo" ? "What to show in the demo" : "Audit notes"}>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder={kind === "demo" ? "Flows, segments, the angle to lead with…" : kind === "audit" ? "What you'll review and the wins to highlight…" : "Anything to remember…"}
              className={`${INPUT} resize-none`}
            />
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">
          <button onClick={onClose} className="rounded-[10px] px-4 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground">Cancel</button>
          <button
            disabled={!canSave}
            onClick={() => onCreated(`${m.toast} for ${contactName}`)}
            className="rounded-[10px] bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-35"
          >
            {m.primary}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
