"use client";

import { useState } from "react";
import { X, Plus, Trash2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FilterField =
  | "source" | "pipelineId" | "stageId" | "brandCategory"
  | "hasDemo" | "daysSinceLastTouch" | "name" | "email";

export type FilterOperator =
  | "is_any_of" | "is_none_of"
  | "contains" | "not_contains"
  | "gt" | "lt" | "is";

export interface FilterRule {
  id: string;
  field: FilterField;
  operator: FilterOperator;
  values: string[];
  connector?: "and" | "or";
}

// ─── Field definitions ────────────────────────────────────────────────────────

interface FieldDef {
  label: string;
  type: "text" | "select" | "boolean" | "number" | "pipeline" | "stage";
  operators: { value: FilterOperator; label: string }[];
  options?: { value: string; label: string }[];
}

const FIELD_DEFS: Record<FilterField, FieldDef> = {
  name: {
    label: "Name",
    type: "text",
    operators: [
      { value: "contains",     label: "contains" },
      { value: "not_contains", label: "does not contain" },
      { value: "is",           label: "is exactly" },
    ],
  },
  email: {
    label: "Email",
    type: "text",
    operators: [
      { value: "contains",     label: "contains" },
      { value: "not_contains", label: "does not contain" },
    ],
  },
  source: {
    label: "Source",
    type: "select",
    operators: [
      { value: "is_any_of",  label: "is any of" },
      { value: "is_none_of", label: "is none of" },
    ],
    options: [
      { value: "ghl",          label: "GHL (Meta)" },
      { value: "comment_lead", label: "Comment Lead" },
    ],
  },
  pipelineId: {
    label: "Pipeline",
    type: "pipeline",
    operators: [
      { value: "is_any_of",  label: "is any of" },
      { value: "is_none_of", label: "is none of" },
    ],
  },
  stageId: {
    label: "Stage",
    type: "stage",
    operators: [
      { value: "is_any_of",  label: "is any of" },
      { value: "is_none_of", label: "is none of" },
    ],
  },
  brandCategory: {
    label: "Category",
    type: "select",
    operators: [
      { value: "is_any_of",  label: "is any of" },
      { value: "is_none_of", label: "is none of" },
    ],
    options: [
      { value: "ecommerce", label: "DTC / eCommerce" },
      { value: "service",   label: "Service" },
      { value: "local",     label: "Local" },
      { value: "b2b",       label: "B2B" },
      { value: "other",     label: "Other" },
    ],
  },
  hasDemo: {
    label: "Has Demo",
    type: "boolean",
    operators: [
      { value: "is_any_of", label: "is" },
    ],
    options: [
      { value: "true",  label: "Yes" },
      { value: "false", label: "No" },
    ],
  },
  daysSinceLastTouch: {
    label: "Days Since Touch",
    type: "number",
    operators: [
      { value: "gt", label: "greater than" },
      { value: "lt", label: "less than" },
      { value: "is", label: "equal to" },
    ],
  },
};

const FIELD_GROUPS = [
  { label: "Contact",  fields: ["name", "email", "source", "brandCategory", "hasDemo"] as FilterField[] },
  { label: "Pipeline", fields: ["pipelineId", "stageId"] as FilterField[] },
  { label: "Activity", fields: ["daysSinceLastTouch"] as FilterField[] },
];

// ─── Multi-value chip input ───────────────────────────────────────────────────

function MultiValueInput({ values, onChange, options, placeholder = "Select…" }: {
  values: string[];
  onChange: (v: string[]) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  const remaining = options.filter((o) => !values.includes(o.value));
  return (
    <div className="flex flex-wrap gap-1.5 items-center min-h-[28px]">
      {values.map((v) => {
        const label = options.find((o) => o.value === v)?.label ?? v;
        return (
          <span
            key={v}
            className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 bg-primary/10 text-primary text-xs rounded-[5px] font-medium shrink-0 whitespace-nowrap"
          >
            {label}
            <button
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="hover:text-rose-500 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        );
      })}
      {remaining.length > 0 && (
        <select
          value=""
          onChange={(e) => { if (e.target.value) onChange([...values, e.target.value]); }}
          className="text-sm text-muted-foreground bg-transparent focus:outline-none cursor-pointer py-0.5"
        >
          <option value="">{values.length === 0 ? placeholder : "Add…"}</option>
          {remaining.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}

// ─── Single filter card (2-row layout) ───────────────────────────────────────

function FilterRow({
  rule,
  onChange,
  onRemove,
  pipelines,
  selectedPipelineIds,
}: {
  rule: FilterRule;
  onChange: (r: FilterRule) => void;
  onRemove: () => void;
  pipelines: Array<{ id: string; name: string; stages: Array<{ id: string; name: string }> }>;
  selectedPipelineIds: string[];
}) {
  const def = FIELD_DEFS[rule.field];

  function setField(f: FilterField) {
    const newDef = FIELD_DEFS[f];
    onChange({ ...rule, field: f, operator: newDef.operators[0].value, values: [] });
  }

  function renderValue() {
    if (def.type === "text") {
      return (
        <input
          type="text"
          value={rule.values[0] ?? ""}
          onChange={(e) => onChange({ ...rule, values: e.target.value ? [e.target.value] : [] })}
          placeholder="Type a value…"
          className="w-full text-sm text-foreground bg-transparent focus:outline-none placeholder:text-muted-foreground/50"
        />
      );
    }

    if (def.type === "number") {
      return (
        <input
          type="number"
          value={rule.values[0] ?? ""}
          onChange={(e) => onChange({ ...rule, values: e.target.value ? [e.target.value] : [] })}
          placeholder="Enter a number…"
          className="w-full text-sm text-foreground bg-transparent focus:outline-none placeholder:text-muted-foreground/50"
        />
      );
    }

    if (def.type === "select" || def.type === "boolean") {
      return (
        <MultiValueInput
          values={rule.values}
          onChange={(v) => onChange({ ...rule, values: v })}
          options={def.options ?? []}
        />
      );
    }

    if (def.type === "pipeline") {
      const options = pipelines.map((p) => ({ value: p.id, label: p.name }));
      return (
        <MultiValueInput
          values={rule.values}
          onChange={(v) => onChange({ ...rule, values: v })}
          options={options}
          placeholder="Select pipeline…"
        />
      );
    }

    if (def.type === "stage") {
      const scopedPipelines = selectedPipelineIds.length > 0
        ? pipelines.filter((p) => selectedPipelineIds.includes(p.id))
        : pipelines;
      const showPipelineName = scopedPipelines.length > 1;
      const seen = new Set<string>();
      const options: { value: string; label: string }[] = [];
      for (const p of scopedPipelines) {
        for (const s of p.stages) {
          if (!seen.has(s.id)) {
            seen.add(s.id);
            options.push({
              value: s.id,
              label: showPipelineName ? `${s.name} (${p.name})` : s.name,
            });
          }
        }
      }
      return (
        <MultiValueInput
          values={rule.values}
          onChange={(v) => onChange({ ...rule, values: v })}
          options={options}
          placeholder="Select stage…"
        />
      );
    }

    return null;
  }

  return (
    <div className="border border-border rounded-[10px] bg-card overflow-visible">
      {/* Row 1: Field selector | Operator selector */}
      <div className="flex items-stretch border-b border-border">
        {/* Field */}
        <div className="relative flex-1 min-w-0">
          <select
            value={rule.field}
            onChange={(e) => setField(e.target.value as FilterField)}
            className="w-full px-3 py-2.5 pr-8 text-sm font-medium text-foreground bg-transparent appearance-none focus:outline-none cursor-pointer"
          >
            {FIELD_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.fields.map((f) => (
                  <option key={f} value={f}>{FIELD_DEFS[f].label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        </div>

        <div className="w-px bg-border shrink-0" />

        {/* Operator */}
        <div className="relative flex-1 min-w-0">
          <select
            value={rule.operator}
            onChange={(e) => onChange({ ...rule, operator: e.target.value as FilterOperator })}
            className="w-full px-3 py-2.5 pr-8 text-sm text-foreground bg-transparent appearance-none focus:outline-none cursor-pointer"
          >
            {def.operators.map((op) => (
              <option key={op.value} value={op.value}>{op.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        </div>
      </div>

      {/* Row 2: Value | Delete */}
      <div className="flex items-stretch min-h-[42px]">
        <div className="flex-1 min-w-0 px-3 py-2.5 flex items-center">
          {renderValue()}
        </div>
        <div className="flex items-center border-l border-border px-2.5 shrink-0">
          <button
            onClick={onRemove}
            className="p-1.5 text-muted-foreground hover:text-rose-500 hover:bg-rose-50 rounded-[6px] transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

interface AdvancedFiltersPanelProps {
  rules: FilterRule[];
  onApply: (rules: FilterRule[]) => void;
  onClose: () => void;
  pipelines: Array<{ id: string; name: string; stages: Array<{ id: string; name: string }> }>;
}

function makeRule(): FilterRule {
  return { id: crypto.randomUUID(), field: "source", operator: "is_any_of", values: [], connector: "and" };
}

export function AdvancedFiltersPanel({ rules: initialRules, onApply, onClose, pipelines }: AdvancedFiltersPanelProps) {
  const [rules, setRules] = useState<FilterRule[]>(
    initialRules.length ? initialRules : [makeRule()]
  );

  const selectedPipelineIds = rules
    .filter((r) => r.field === "pipelineId")
    .flatMap((r) => r.values);

  function updateRule(id: string, updated: FilterRule) {
    setRules((r) => r.map((x) => (x.id === id ? updated : x)));
  }

  function removeRule(id: string) {
    const next = rules.filter((x) => x.id !== id);
    setRules(next.length ? next : [makeRule()]);
  }

  function addRule() {
    setRules((r) => [...r, makeRule()]);
  }

  function toggleConnector(id: string) {
    setRules((r) =>
      r.map((x) => x.id === id ? { ...x, connector: x.connector === "or" ? "and" : "or" } : x)
    );
  }

  function handleApply() {
    const valid = rules.filter((r) => {
      const def = FIELD_DEFS[r.field];
      if (def.type === "text" || def.type === "number") return (r.values[0] ?? "") !== "";
      return r.values.length > 0;
    });
    onApply(valid);
  }

  function handleClear() {
    setRules([makeRule()]);
    onApply([]);
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-[480px] z-50 bg-card border-l border-border shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
            Advanced Filters
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-[7px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Rules */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-3">
          {rules.map((rule, i) => (
            <div key={rule.id}>
              {/* AND / OR connector pill between rules */}
              {i > 0 && (
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1 h-px bg-border/50" />
                  <button
                    onClick={() => toggleConnector(rule.id)}
                    className={cn(
                      "px-3 py-0.5 text-[11px] font-bold uppercase tracking-widest rounded-full border transition-colors select-none",
                      rule.connector === "or"
                        ? "border-amber-300/70 bg-amber-50 text-amber-600 hover:bg-amber-100"
                        : "border-border bg-muted text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {rule.connector === "or" ? "OR" : "AND"}
                  </button>
                  <div className="flex-1 h-px bg-border/50" />
                </div>
              )}

              <FilterRow
                rule={rule}
                onChange={(updated) => updateRule(rule.id, updated)}
                onRemove={() => removeRule(rule.id)}
                pipelines={pipelines}
                selectedPipelineIds={selectedPipelineIds}
              />
            </div>
          ))}

          <button
            onClick={addRule}
            className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 font-medium transition-colors pt-1"
          >
            <Plus className="w-3.5 h-3.5" />
            Add filter
          </button>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border shrink-0 flex items-center justify-between">
          <button
            onClick={handleClear}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear all
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-2 text-sm border border-border rounded-[8px] text-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              className="px-3.5 py-2 text-sm bg-primary text-primary-foreground rounded-[8px] font-medium hover:bg-primary/90 transition-colors"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
