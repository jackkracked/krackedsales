"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileText, RefreshCw, Layers, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { isQualificationNote, parseQualificationNote } from "@/lib/utils/url";
import { resolveCustomFields, type FieldDef, type QualItem } from "@/lib/ghl/qualification";

interface GHLNote { id: string; body: string }

/**
 * Single source of truth for a contact's lead-form qualification (Q&A).
 * Primary source: GHL contact custom fields (the lead form). Fallback: a
 * "Qualification Questions" note (older / Zapier leads). Returns a unified item
 * list so both the full tab and the sidebar preview render from one fetch.
 */
export function useQualification(contactId: string | null | undefined) {
  const enabled = !!contactId;

  const { data: contactData, isLoading: contactLoading } = useQuery<{
    contact: { customFields?: Array<{ id: string; field_value?: string; value?: string }>;
               customField?: Array<{ id: string; field_value?: string; value?: string }> } | null;
  }>({
    queryKey: ["ghl-contact", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/ghl/contacts/${contactId}`);
      if (!res.ok) return { contact: null };
      return res.json();
    },
    enabled,
    staleTime: 2 * 60 * 1000,
  });

  const { data: fieldDefsData, isLoading: defsLoading } = useQuery<{ fields: Record<string, FieldDef> }>({
    queryKey: ["ghl-custom-field-defs"],
    queryFn: async () => {
      const res = await fetch("/api/ghl/custom-fields");
      if (!res.ok) return { fields: {} };
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  const contact = contactData?.contact;
  const rawFields = contact?.customFields ?? contact?.customField ?? [];
  const fieldDefs = fieldDefsData?.fields ?? {};
  const fromFields = resolveCustomFields(rawFields, fieldDefs);
  const hasFormData = fromFields.length > 0;

  // Note fallback only when there are no form answers.
  const { data: notesData, isLoading: notesLoading } = useQuery<{ notes: GHLNote[] }>({
    queryKey: ["ghl-contact-notes-qual", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/ghl/contacts/${contactId}/notes`);
      if (!res.ok) return { notes: [] };
      return res.json();
    },
    enabled: enabled && !contactLoading && !defsLoading && !hasFormData,
    staleTime: 2 * 60 * 1000,
  });

  let items: QualItem[] = fromFields;
  let source: "fields" | "note" | "none" = hasFormData ? "fields" : "none";
  if (!hasFormData && notesData) {
    const qualNote = (notesData.notes ?? []).find((n) => isQualificationNote(n.body));
    const qa = qualNote ? parseQualificationNote(qualNote.body) : [];
    if (qa.length) {
      items = qa.map((p) => ({ label: p.question, value: p.answer, isUrl: p.isUrl, cleanedUrl: p.cleanedUrl }));
      source = "note";
    }
  }

  const isLoading = contactLoading || defsLoading || (!hasFormData && notesLoading);
  return { items, source, isLoading, hasAny: items.length > 0 };
}

/** A question→answer value: a clean external link for URLs, plain text otherwise. */
function Answer({ item, className }: { item: QualItem; className?: string }) {
  if (item.isUrl && item.cleanedUrl) {
    return (
      <a
        href={item.cleanedUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={cn("text-primary hover:underline inline-flex items-center gap-1 max-w-full", className)}
      >
        <ExternalLink className="w-3 h-3 shrink-0" />
        <span className="truncate">{item.cleanedUrl}</span>
      </a>
    );
  }
  return <span className={className}>{item.value}</span>;
}

/**
 * Full qualification view (used in the modal tabs). Groups by form folder, with
 * airy definition-list cards. One fetch shared with the sidebar preview.
 */
export function QualificationPanel({ contactId }: { contactId: string | null | undefined }) {
  const { items, source, isLoading } = useQualification(contactId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        <RefreshCw className="w-4 h-4 animate-spin mr-2" />
        Loading qualification data…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-14 gap-2 text-muted-foreground">
        <FileText className="w-8 h-8 opacity-30" />
        <p className="text-sm font-medium text-foreground/70">No qualification data yet</p>
        <p className="text-xs text-center max-w-52 leading-relaxed">
          The lead-form answers will appear here once the contact has submitted them.
        </p>
      </div>
    );
  }

  // Group by folder (note-sourced items share one "Lead Qualification" group).
  const grouped = new Map<string, QualItem[]>();
  for (const it of items) {
    const key = source === "note" ? "Lead Qualification" : it.folder ?? "General";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(it);
  }

  return (
    <div className="space-y-6">
      {Array.from(grouped.entries()).map(([folder, fields]) => (
        <section key={folder}>
          <div className="flex items-center gap-1.5 mb-3">
            <Layers className="w-3.5 h-3.5 text-primary/70" />
            <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.12em]">{folder}</h3>
            <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
          </div>
          <div className="grid gap-2.5">
            {fields.map((field, i) => (
              <div
                key={i}
                className="rounded-[12px] border border-border/60 bg-gradient-to-b from-muted/40 to-muted/15 px-4 py-3 transition-colors hover:border-border"
              >
                <p className="text-[10.5px] font-semibold text-muted-foreground/80 uppercase tracking-[0.08em] mb-1 leading-tight">
                  {field.label}
                </p>
                <Answer item={field} className="text-[13.5px] text-foreground leading-relaxed break-words" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * Compact sidebar preview — first `limit` answers in a tight stacked list, with a
 * "View all (N)" affordance that opens the full Qualification tab.
 */
export function QualificationPreview({
  contactId,
  limit = 4,
  onViewAll,
}: {
  contactId: string | null | undefined;
  limit?: number;
  onViewAll?: () => void;
}) {
  const { items, isLoading } = useQualification(contactId);

  if (isLoading) {
    return (
      <div className="space-y-2.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-1">
            <div className="h-2 w-20 rounded-full bg-muted animate-pulse" />
            <div className="h-2.5 w-32 rounded-full bg-muted/60 animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) return null;

  const shown = items.slice(0, limit);
  const more = items.length - shown.length;

  return (
    <section>
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-[0.1em]">Qualification</p>
        {(more > 0 || onViewAll) && onViewAll && (
          <button
            onClick={onViewAll}
            className="group inline-flex items-center gap-0.5 text-[10.5px] font-medium text-primary/80 hover:text-primary transition-colors"
          >
            View all{items.length > limit ? ` (${items.length})` : ""}
            <ArrowRight className="w-2.5 h-2.5 transition-transform group-hover:translate-x-0.5" />
          </button>
        )}
      </div>
      <div className="divide-y divide-border/40">
        {shown.map((item, i) => (
          <div key={i} className="py-2 first:pt-0 last:pb-0">
            <p className="text-[9.5px] font-semibold text-muted-foreground/55 uppercase tracking-[0.08em] mb-0.5 leading-tight">
              {item.label}
            </p>
            <Answer item={item} className="text-[12px] text-foreground/90 leading-snug line-clamp-2 break-words" />
          </div>
        ))}
      </div>
    </section>
  );
}
