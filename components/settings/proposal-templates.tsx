"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  FileText,
  Type,
  Tag,
  AlignLeft,
  ListChecks,
  Table2,
  ShieldCheck,
  Scale,
  PenLine,
  Plus,
  Trash2,
  RotateCcw,
  Save,
  Loader2,
  Check,
  Eye,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { RichTextEditor } from "@/components/proposals/rich-text-editor";
import {
  defaultContentFor,
  type ProposalContent,
  type AdditionalRate,
  type SignatureBlock,
} from "@/lib/proposals/content";

// ─── Types + data ──────────────────────────────────────────────────────────────

type TemplateType = "management" | "project";
type TemplatesResponse = Record<TemplateType, ProposalContent>;

const api = "/api/settings/proposal-templates";

async function fetchTemplates(): Promise<TemplatesResponse> {
  const res = await fetch(api);
  if (!res.ok) throw new Error("Failed to load proposal templates");
  return res.json();
}

// The markdown sections, in the order they appear in the finished document.
const MD_SECTIONS: {
  key: keyof ProposalContent;
  label: string;
  helper: string;
  icon: typeof AlignLeft;
}[] = [
  { key: "intro", label: "Introduction", helper: "The opening paragraph. Use {{client}} where the client's name should appear.", icon: AlignLeft },
  { key: "scopeIntro", label: "Scope heading & lead-in", helper: "The Project Scope heading and the line that introduces the deliverables.", icon: ListChecks },
  { key: "defaultScope", label: "Default scope bullets", helper: "The fallback deliverable list, shown only when a proposal has no structured deliverables of its own.", icon: ListChecks },
  { key: "additionalScopeIntro", label: "Additional scope lead-in", helper: "The paragraph above the additional-rates table.", icon: AlignLeft },
  { key: "acceptance", label: "Acceptance & authorization", helper: "The acceptance language the client agrees to before signing.", icon: ShieldCheck },
  { key: "terms", label: "Legal terms", helper: "The full terms of the agreement. Supports headings, lists and tables.", icon: Scale },
];

const money = (t: TemplateType) => (t === "management" ? "Management" : "Project");

// ─── Small primitives ───────────────────────────────────────────────────────────

function Card({
  title,
  helper,
  icon: Icon,
  children,
}: {
  title: string;
  helper: string;
  icon: typeof AlignLeft;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[10px] border border-border bg-card p-5" data-r10n-settings-card>
      <div className="mb-1 flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" data-r10n-settings-cardicon />
        <h3
          className="text-sm font-semibold text-foreground"
          style={{ fontFamily: "var(--font-heading)" }}
          data-r10n-settings-cardtitle
        >
          {title}
        </h3>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">{helper}</p>
      {children}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-[8px] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
    </label>
  );
}

// ─── Rates rows editor ──────────────────────────────────────────────────────────

function RatesEditor({
  rows,
  onChange,
}: {
  rows: AdditionalRate[];
  onChange: (rows: AdditionalRate[]) => void;
}) {
  const setRow = (i: number, patch: Partial<AdditionalRate>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const addRow = () => onChange([...rows, { item: "", cost: "" }]);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_180px_auto] items-center gap-2 px-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Service</span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Cost</span>
        <span className="w-7" />
      </div>

      {rows.length === 0 ? (
        <p className="rounded-[8px] border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          No additional rates yet. Add a row below.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_180px_auto] items-center gap-2">
              <input
                value={row.item}
                onChange={(e) => setRow(i, { item: e.target.value })}
                placeholder="e.g. Flow Emails"
                aria-label={`Rate ${i + 1} service`}
                className="w-full rounded-[8px] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <input
                value={row.cost}
                onChange={(e) => setRow(i, { cost: e.target.value })}
                placeholder="e.g. $200 per email"
                aria-label={`Rate ${i + 1} cost`}
                className="w-full rounded-[8px] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                aria-label={`Remove rate ${i + 1}`}
                className="flex h-9 w-7 items-center justify-center rounded-[6px] text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={addRow}
        className="inline-flex items-center gap-1.5 rounded-[8px] border border-dashed border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Plus className="h-3.5 w-3.5" /> Add row
      </button>
    </div>
  );
}

// ─── Signature editor ───────────────────────────────────────────────────────────

const SIG_FIELDS: { key: keyof SignatureBlock; label: string; placeholder: string }[] = [
  { key: "company", label: "Company", placeholder: "KRACKED RETENTION" },
  { key: "title", label: "Title", placeholder: "CEO" },
  { key: "name", label: "Name", placeholder: "GAGE FLESHER" },
  { key: "email", label: "Email", placeholder: "admin@krackedretention.com" },
];

function SignatureEditor({
  value,
  onChange,
}: {
  value: SignatureBlock;
  onChange: (v: SignatureBlock) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {SIG_FIELDS.map((f) => (
        <TextField
          key={f.key}
          label={f.label}
          value={value[f.key]}
          placeholder={f.placeholder}
          onChange={(v) => onChange({ ...value, [f.key]: v })}
        />
      ))}
    </div>
  );
}

// ─── Live preview ───────────────────────────────────────────────────────────────

const MD_COMPONENTS = {
  h1: (p: React.ComponentPropsWithoutRef<"h2">) => (
    <h4 className="mb-2 mt-4 text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-heading)" }} {...p} />
  ),
  h2: (p: React.ComponentPropsWithoutRef<"h2">) => (
    <h4 className="mb-2 mt-4 text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-heading)" }} {...p} />
  ),
  p: (p: React.ComponentPropsWithoutRef<"p">) => <p className="mb-2.5 leading-relaxed text-muted-foreground" {...p} />,
  ul: (p: React.ComponentPropsWithoutRef<"ul">) => <ul className="mb-2.5 ml-4 list-disc space-y-1 text-muted-foreground" {...p} />,
  ol: (p: React.ComponentPropsWithoutRef<"ol">) => <ol className="mb-2.5 ml-4 list-decimal space-y-1 text-muted-foreground" {...p} />,
  li: (p: React.ComponentPropsWithoutRef<"li">) => <li className="leading-relaxed" {...p} />,
  strong: (p: React.ComponentPropsWithoutRef<"strong">) => <strong className="font-semibold text-foreground" {...p} />,
  hr: () => <hr className="my-4 border-border" />,
  table: (p: React.ComponentPropsWithoutRef<"table">) => (
    <div className="mb-3 overflow-x-auto">
      <table className="w-full border-collapse text-xs" {...p} />
    </div>
  ),
  th: (p: React.ComponentPropsWithoutRef<"th">) => (
    <th className="border border-border bg-muted/40 px-2.5 py-1.5 text-left font-semibold text-foreground" {...p} />
  ),
  td: (p: React.ComponentPropsWithoutRef<"td">) => <td className="border border-border px-2.5 py-1.5 text-muted-foreground" {...p} />,
};

function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
      {children}
    </ReactMarkdown>
  );
}

function PreviewPanel({ content }: { content: ProposalContent }) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-border bg-card" data-r10n-settings-card>
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Eye className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
          Live preview
        </span>
        <span className="ml-auto text-xs text-muted-foreground">Updates as you type</span>
      </div>

      <div className="max-h-[calc(100vh-9rem)] overflow-y-auto p-4">
        <div className="rounded-[10px] border border-border bg-background p-6 text-sm">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{content.docTitle}</p>
          <p className="mb-5 text-lg font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
            {content.serviceLabel}
          </p>

          <Markdown>{content.intro}</Markdown>
          <Markdown>{content.scopeIntro}</Markdown>
          <Markdown>{content.defaultScope}</Markdown>
          <Markdown>{content.additionalScopeIntro}</Markdown>

          {content.additionalRates.length > 0 && (
            <div className="mb-4 overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="border border-border bg-muted/40 px-2.5 py-1.5 text-left font-semibold text-foreground">
                      Additional Scope
                    </th>
                    <th className="border border-border bg-muted/40 px-2.5 py-1.5 text-left font-semibold text-foreground">
                      Cost
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {content.additionalRates.map((r, i) => (
                    <tr key={i}>
                      <td className="border border-border px-2.5 py-1.5 text-muted-foreground">{r.item}</td>
                      <td className="border border-border px-2.5 py-1.5 text-muted-foreground">{r.cost}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Markdown>{content.acceptance}</Markdown>
          <Markdown>{content.terms}</Markdown>

          <div className="mt-6 border-t border-border pt-4">
            <p className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
              {content.signature.company}
            </p>
            <p className="text-xs text-muted-foreground">
              {content.signature.name} · {content.signature.title}
            </p>
            <p className="text-xs text-muted-foreground">{content.signature.email}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Per-type editor ────────────────────────────────────────────────────────────

function TypeEditor({
  type,
  server,
  onSaved,
}: {
  type: TemplateType;
  server: ProposalContent;
  onSaved: (type: TemplateType, sections: ProposalContent) => void;
}) {
  const [content, setContent] = useState<ProposalContent>(server);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = useMemo(() => JSON.stringify(content) !== JSON.stringify(server), [content, server]);

  const patch = (p: Partial<ProposalContent>) => setContent((c) => ({ ...c, ...p }));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(api, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, sections: content }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Failed to save");
      const data = (await res.json()) as { ok: boolean; sections: ProposalContent };
      setContent(data.sections);
      onSaved(type, data.sections);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function restoreDefaults() {
    setContent(defaultContentFor(type));
    setError(null);
  }

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
      {/* Editor column */}
      <div className="min-w-0 space-y-5">
      {/* Action bar */}
      <div className="sticky top-0 z-10 -mx-1 flex items-center gap-3 rounded-[10px] border border-border bg-card/95 px-4 py-3 backdrop-blur" data-r10n-settings-card>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
            {money(type)} proposal copy
          </p>
          <p className="text-xs text-muted-foreground">
            {dirty ? "You have unsaved changes." : "New proposals of this type snapshot this copy."}
          </p>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {error && (
            <span className="inline-flex items-center gap-1 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" /> {error}
            </span>
          )}
          <button
            type="button"
            onClick={restoreDefaults}
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Restore defaults
          </button>
          {dirty || saving ? (
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-[8px] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-70"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Saving" : "Save changes"}
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2 py-2 text-sm font-medium text-success">
              <Check className="h-4 w-4" /> Saved
            </span>
          )}
        </div>
      </div>

      {/* Plain-text fields */}
      <Card title="Document title" helper="The small line above the service label, e.g. Service Agreement and Statement of Work." icon={Type}>
        <TextField label="Title" value={content.docTitle} onChange={(v) => patch({ docTitle: v })} placeholder="Service Agreement and Statement of Work" />
      </Card>

      <Card title="Service label" helper="The service name shown on the pricing table." icon={Tag}>
        <TextField label="Label" value={content.serviceLabel} onChange={(v) => patch({ serviceLabel: v })} placeholder="Kracked Retention Email + SMS Marketing Management" />
      </Card>

      {/* Markdown sections */}
      {MD_SECTIONS.map((s) => (
        <Card key={s.key} title={s.label} helper={s.helper} icon={s.icon}>
          <RichTextEditor
            value={content[s.key] as string}
            onChange={(md) => patch({ [s.key]: md } as Partial<ProposalContent>)}
            ariaLabel={`${money(type)} ${s.label}`}
          />
        </Card>
      ))}

      {/* Additional rates */}
      <Card title="Additional rates" helper="The service and cost rows shown in the additional-scope pricing table." icon={Table2}>
        <RatesEditor rows={content.additionalRates} onChange={(rows) => patch({ additionalRates: rows })} />
      </Card>

      {/* Signature */}
      <Card title="Signature block" helper="The Kracked Retention signatory details shown at the foot of the document." icon={PenLine}>
        <SignatureEditor value={content.signature} onChange={(sig) => patch({ signature: sig })} />
      </Card>
      </div>

      {/* Live preview — sticky beside the editor on desktop, stacks below on narrow screens. */}
      <div className="lg:sticky lg:top-4">
        <PreviewPanel content={content} />
      </div>
    </div>
  );
}

// ─── Card wrapper ────────────────────────────────────────────────────────────────

export function ProposalTemplatesSettings() {
  const { data, isLoading, isError, error } = useQuery<TemplatesResponse>({
    queryKey: ["proposal-templates"],
    queryFn: fetchTemplates,
  });

  const [type, setType] = useState<TemplateType>("management");
  // Local cache of the last-saved server copy per type, so the segmented switch
  // never re-renders a stale editor and never jumps layout after a save.
  const [server, setServer] = useState<TemplatesResponse | null>(null);

  // Adopt the fetched copy once, then keep our own copy updated on save.
  const effective = server ?? data ?? null;
  if (data && !server) {
    // Seed on first successful load (render-phase seed is safe: same value each render).
    setServer(data);
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 rounded-[10px] border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between" data-r10n-settings-card>
        <div className="flex items-start gap-2">
          <FileText className="mt-0.5 h-4 w-4 text-muted-foreground" data-r10n-settings-cardicon />
          <div>
            <h2 className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-heading)" }} data-r10n-settings-cardtitle>
              Proposal Templates
            </h2>
            <p className="mt-0.5 max-w-md text-xs text-muted-foreground">
              Edit the reusable wording for Management and Project proposals. Each new proposal snapshots this copy, so
              changes here only affect proposals created afterward.
            </p>
          </div>
        </div>

        {/* Segmented switch */}
        <div
          className="inline-flex shrink-0 items-center gap-1 rounded-[8px] border border-border bg-muted/40 p-1"
          role="tablist"
          aria-label="Proposal type"
        >
          {(["management", "project"] as const).map((t) => {
            const isActive = t === type;
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setType(t)}
                className={cn(
                  "rounded-[6px] px-4 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {money(t)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="flex items-center gap-2 rounded-[10px] border border-border bg-card p-5 text-xs text-muted-foreground" data-r10n-settings-card>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading templates…
        </div>
      ) : isError || !effective ? (
        <div className="flex items-center gap-2 rounded-[10px] border border-destructive/30 bg-destructive/5 p-5 text-xs text-destructive" data-r10n-settings-card>
          <AlertTriangle className="h-3.5 w-3.5" />
          {error instanceof Error ? error.message : "Failed to load proposal templates."}
        </div>
      ) : (
        // Keyed remount per type so each editor owns fresh, isolated local state.
        <TypeEditor
          key={type}
          type={type}
          server={effective[type]}
          onSaved={(savedType, sections) =>
            setServer((prev) => ({ ...(prev ?? effective), [savedType]: sections }))
          }
        />
      )}
    </div>
  );
}
