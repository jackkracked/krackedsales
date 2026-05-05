"use client";

import { useState, useEffect } from "react";
import { X, RefreshCw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { ConditionsBuilder } from "./conditions-builder";
import type { TemplateWithStats } from "@/lib/templates/types";
import type { TemplateCondition } from "@/lib/templates/types";

interface TemplateEditorProps {
  template: TemplateWithStats | null; // null = create new
  onClose: () => void;
  onSaved: () => void;
}

const SMS_LIMIT = 160;

export function TemplateEditor({ template, onClose, onSaved }: TemplateEditorProps) {
  const isNew = !template;

  const [name, setName] = useState(template?.name ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [conditions, setConditions] = useState<TemplateCondition[]>(
    (template?.conditions as TemplateCondition[]) ?? []
  );
  const [abGroup, setAbGroup] = useState(template?.abGroup ?? "");
  const [weight, setWeight] = useState(template?.weight ?? 100);
  const [priority, setPriority] = useState(template?.priority ?? 0);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const charCount = body.length;
  const smsSegments = Math.ceil(charCount / SMS_LIMIT) || 1;

  async function handleSave() {
    if (!name.trim() || !body.trim()) { setError("Name and body are required"); return; }
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: name.trim(),
        body: body.trim(),
        conditions,
        abGroup: abGroup.trim() || null,
        weight,
        priority,
      };
      const url = isNew ? "/api/templates" : `/api/templates/${template!.id}`;
      const method = isNew ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed");
      onSaved();
      onClose();
    } catch {
      setError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!template) return;
    if (!confirm("Delete this template? This cannot be undone.")) return;
    setDeleting(true);
    try {
      await fetch(`/api/templates/${template.id}`, { method: "DELETE" });
      onSaved();
      onClose();
    } catch {
      setError("Failed to delete.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Slide-over panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-xl z-50 flex flex-col bg-card border-l border-border shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
            {isNew ? "New Template" : "Edit Template"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-[7px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Template Name <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. No Website Response"
              className="w-full text-sm px-3 py-2.5 border border-border rounded-[8px] bg-background text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-colors"
            />
          </div>

          {/* Body */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Message Body <span className="text-destructive">*</span>
              </label>
              <span className={cn(
                "text-[10px] font-medium",
                charCount > SMS_LIMIT * 2 ? "text-destructive" : "text-muted-foreground"
              )}>
                {charCount} chars · {smsSegments} SMS segment{smsSegments !== 1 ? "s" : ""}
              </span>
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              placeholder="Type your message…"
              className="w-full text-sm px-3 py-2.5 border border-border rounded-[8px] bg-background text-foreground placeholder:text-muted-foreground/60 resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-colors leading-relaxed"
            />
          </div>

          {/* Conditions */}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Conditions
              </label>
              <p className="text-xs text-muted-foreground mt-0.5">All conditions must match for this template to be used.</p>
            </div>
            <ConditionsBuilder conditions={conditions} onChange={setConditions} />
          </div>

          {/* A/B Testing */}
          <div className="space-y-3 pt-2 border-t border-border">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                A/B Testing
              </label>
              <p className="text-xs text-muted-foreground mt-0.5">Give two templates the same group name to split-test them.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground font-medium">Group Name</label>
                <input
                  type="text"
                  value={abGroup}
                  onChange={(e) => setAbGroup(e.target.value)}
                  placeholder="e.g. no-website-test"
                  className="w-full text-sm px-3 py-2 border border-border rounded-[8px] bg-background text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground font-medium">Traffic Weight</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={weight}
                    onChange={(e) => setWeight(Number(e.target.value))}
                    min={1}
                    max={100}
                    className="w-20 text-sm px-3 py-2 border border-border rounded-[8px] bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
                  />
                  <span className="text-xs text-muted-foreground">/ 100</span>
                </div>
              </div>
            </div>
          </div>

          {/* Priority */}
          <div className="space-y-1.5 pb-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Priority
            </label>
            <p className="text-xs text-muted-foreground">Lower number = evaluated first. 0 is highest priority.</p>
            <input
              type="number"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              min={0}
              className="w-24 text-sm px-3 py-2 border border-border rounded-[8px] bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center gap-2 shrink-0">
          {!isNew && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-destructive border border-destructive/20 rounded-[8px] hover:bg-destructive/5 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          )}
          <button
            onClick={onClose}
            className="flex-none px-4 py-2 text-sm font-medium text-foreground border border-border rounded-[8px] hover:bg-muted transition-colors ml-auto"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-primary text-primary-foreground rounded-[8px] hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            {saving ? "Saving…" : isNew ? "Create Template" : "Save Changes"}
          </button>
        </div>
      </div>
    </>
  );
}
