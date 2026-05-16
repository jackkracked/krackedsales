"use client";

import { useState, useEffect, useRef } from "react";
import { X, ListTodo, CheckCircle2, Search, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface ContactResult {
  id: string;
  name: string;
  email: string | null;
}

interface OppResult {
  id: string;
  name: string;
  contactId: string | null;
  contactName: string | null;
}

interface CreateTaskModalProps {
  contactId?: string;
  contactName?: string;
  opportunityId?: string;
  opportunityName?: string;
  onClose: () => void;
}

const PRIORITIES = [
  { value: "high", label: "High", className: "text-destructive border-destructive/30 bg-destructive/5" },
  { value: "medium", label: "Medium", className: "text-amber-600 border-amber-400/40 bg-amber-50/50" },
  { value: "low", label: "Low", className: "text-muted-foreground border-border bg-muted/40" },
] as const;

export function CreateTaskModal({
  contactId: initialContactId,
  contactName: initialContactName,
  opportunityId: initialOpportunityId,
  opportunityName: initialOpportunityName,
  onClose,
}: CreateTaskModalProps) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(false);

  // Opportunity linking (only shown when no pre-supplied opportunityId)
  const [oppQuery, setOppQuery] = useState("");
  const [contactResults, setContactResults] = useState<ContactResult[]>([]);
  const [oppLoading, setOppLoading] = useState(false);
  const [linkedOpp, setLinkedOpp] = useState<OppResult | null>(
    initialOpportunityId
      ? {
          id: initialOpportunityId,
          name: initialOpportunityName ?? initialContactName ?? "Linked opportunity",
          contactId: initialContactId ?? null,
          contactName: initialContactName ?? null,
        }
      : null
  );
  const oppRef = useRef<HTMLDivElement>(null);

  // Debounced contact search (same endpoint as proposals)
  useEffect(() => {
    if (initialOpportunityId) return; // pre-linked, skip search
    if (oppQuery.length < 2) { setContactResults([]); return; }
    const timer = setTimeout(async () => {
      setOppLoading(true);
      try {
        const res = await fetch(`/api/ghl/contacts/search?q=${encodeURIComponent(oppQuery)}`);
        const data = await res.json();
        setContactResults(data.contacts ?? []);
      } finally {
        setOppLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [oppQuery, initialOpportunityId]);

  // When a contact is selected, resolve their opportunity in background
  async function handleContactSelect(contact: ContactResult) {
    setOppQuery("");
    setContactResults([]);
    // Optimistically link the contact while we fetch their opportunity
    setLinkedOpp({
      id: contact.id, // fallback to contactId if no opportunity found
      name: contact.name,
      contactId: contact.id,
      contactName: contact.name,
    });
    try {
      const res = await fetch(`/api/ghl/contacts/${contact.id}/opportunity?name=${encodeURIComponent(contact.name)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.opportunity) {
          setLinkedOpp({
            id: data.opportunity.id,
            name: data.opportunity.name ?? contact.name,
            contactId: contact.id,
            contactName: contact.name,
          });
        }
      }
    } catch {
      // Keep the contact-only link if opportunity fetch fails
    }
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (oppRef.current && !oppRef.current.contains(e.target as Node)) {
        setContactResults([]);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError("Title is required"); return; }

    setSaving(true);
    try {
      const body = {
        title: title.trim(),
        notes: notes.trim() || undefined,
        dueDate: dueDate || undefined,
        priority,
        contactId: linkedOpp?.contactId ?? initialContactId ?? undefined,
        contactName: linkedOpp?.contactName ?? initialContactName ?? undefined,
        opportunityId: linkedOpp?.id ?? undefined,
        opportunityName: linkedOpp?.name ?? undefined,
      };

      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error("Failed to create task");

      setCreated(true);
      setTimeout(onClose, 1000);
    } catch {
      setError("Could not create task. Please try again.");
      setSaving(false);
    }
  }

  const preLinked = !!initialOpportunityId;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-card border border-border rounded-[12px] w-full max-w-md shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <ListTodo className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Create Task</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-[6px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Pre-linked contact/opportunity indicator */}
          {preLinked && initialContactName && (
            <div className="text-xs text-muted-foreground bg-muted/40 border border-border/60 rounded-[7px] px-3 py-2">
              Linked to{" "}
              <span className="font-medium text-foreground">{initialContactName}</span>
            </div>
          )}

          {/* Title */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Task Title <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => { setTitle(e.target.value); setError(""); }}
              placeholder="e.g. Follow up on proposal"
              autoFocus
              className="w-full text-sm px-3 py-2.5 border border-border rounded-[7px] bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-colors"
            />
          </div>

          {/* Due Date */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Due Date
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full text-sm px-3 py-2.5 border border-border rounded-[7px] bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-colors"
            />
          </div>

          {/* Priority */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Priority
            </label>
            <div className="flex gap-2">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPriority(p.value)}
                  className={cn(
                    "flex-1 py-2 text-xs font-medium rounded-[7px] border transition-all",
                    priority === p.value
                      ? p.className
                      : "text-muted-foreground border-border hover:bg-muted/50"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Opportunity search (only when not pre-linked) */}
          {!preLinked && (
            <div className="space-y-1.5" ref={oppRef}>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Link Opportunity
              </label>
              {linkedOpp ? (
                <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border border-border/60 rounded-[7px]">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{linkedOpp.name}</p>
                    {linkedOpp.contactName && (
                      <p className="text-xs text-muted-foreground truncate">{linkedOpp.contactName}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setLinkedOpp(null)}
                    className="ml-2 text-xs text-muted-foreground hover:text-destructive transition-colors shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    value={oppQuery}
                    onChange={(e) => setOppQuery(e.target.value)}
                    placeholder="Search by contact name…"
                    className="w-full text-sm pl-9 pr-3 py-2.5 border border-border rounded-[7px] bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-colors"
                  />
                  {oppLoading && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground animate-spin" />
                  )}
                  {contactResults.length > 0 && (
                    <div className="absolute z-10 top-full mt-1 w-full bg-card border border-border rounded-[8px] shadow-lg overflow-hidden">
                      {contactResults.map((contact) => (
                        <button
                          key={contact.id}
                          type="button"
                          onClick={() => handleContactSelect(contact)}
                          className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors border-b border-border/40 last:border-0"
                        >
                          <p className="text-sm font-medium text-foreground truncate">{contact.name}</p>
                          {contact.email && (
                            <p className="text-xs text-muted-foreground truncate">{contact.email}</p>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional details…"
              rows={3}
              className="w-full text-sm px-3 py-2.5 border border-border rounded-[7px] bg-background text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-colors"
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving || created}
              className="flex-1 py-2.5 text-sm font-medium text-foreground border border-border rounded-[7px] hover:bg-muted transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || created}
              className={cn(
                "flex-1 py-2.5 text-sm font-semibold rounded-[7px] transition-all duration-300 flex items-center justify-center gap-2",
                created
                  ? "bg-emerald-600 text-white"
                  : "bg-primary text-primary-foreground hover:bg-primary/90",
                (saving || created) && "opacity-80 cursor-not-allowed"
              )}
            >
              {created ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Task Created
                </>
              ) : saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Create Task"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
