"use client";

import { X, Plus } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  type TemplateCondition,
  type ConditionField,
  type ConditionOperator,
  CONDITION_FIELDS,
  OPERATOR_LABELS,
} from "@/lib/templates/types";

interface ConditionsBuilderProps {
  conditions: TemplateCondition[];
  onChange: (conditions: TemplateCondition[]) => void;
}

const FIELD_OPTIONS: { value: ConditionField; label: string }[] = Object.entries(
  CONDITION_FIELDS
).map(([k, v]) => ({ value: k as ConditionField, label: v.label }));

export function ConditionsBuilder({ conditions, onChange }: ConditionsBuilderProps) {
  function addCondition() {
    onChange([
      ...conditions,
      { field: "brand_category", operator: "equals", value: "ecommerce" },
    ]);
  }

  function removeCondition(i: number) {
    onChange(conditions.filter((_, idx) => idx !== i));
  }

  function updateCondition(i: number, patch: Partial<TemplateCondition>) {
    const updated = conditions.map((c, idx) => {
      if (idx !== i) return c;
      const merged = { ...c, ...patch };
      // Reset operator + value when field changes
      if (patch.field && patch.field !== c.field) {
        const fieldMeta = CONDITION_FIELDS[patch.field];
        merged.operator = fieldMeta.operators[0];
        merged.value = fieldMeta.options?.[0] ?? "";
      }
      return merged;
    });
    onChange(updated);
  }

  if (conditions.length === 0) {
    return (
      <div className="space-y-2" data-r10n-tmpl-cb>
        <p className="text-xs text-muted-foreground" data-r10n-tmpl-cb-empty>
          No conditions — this template matches all leads.
        </p>
        <button
          type="button"
          onClick={addCondition}
          className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          data-r10n-tmpl-cb-add
        >
          <Plus className="w-3.5 h-3.5" />
          Add condition
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-r10n-tmpl-cb>
      {conditions.map((cond, i) => {
        const fieldMeta = CONDITION_FIELDS[cond.field];
        return (
          <div key={i} className="flex items-center gap-2 flex-wrap" data-r10n-tmpl-cb-row>
            {/* AND label */}
            {i > 0 && (
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest w-6 text-right shrink-0" data-r10n-tmpl-cb-and>
                and
              </span>
            )}
            {i === 0 && <span className="w-6 shrink-0" />}

            {/* Field */}
            <select
              value={cond.field}
              onChange={(e) => updateCondition(i, { field: e.target.value as ConditionField })}
              className="text-xs px-2.5 py-1.5 border border-border rounded-[7px] bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              data-r10n-tmpl-cb-select
            >
              {FIELD_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>

            {/* Operator */}
            <select
              value={cond.operator}
              onChange={(e) => updateCondition(i, { operator: e.target.value as ConditionOperator })}
              className="text-xs px-2.5 py-1.5 border border-border rounded-[7px] bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              data-r10n-tmpl-cb-select
            >
              {fieldMeta.operators.map((op) => (
                <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>
              ))}
            </select>

            {/* Value */}
            {fieldMeta.valueType === "select" ? (
              <select
                value={cond.value}
                onChange={(e) => updateCondition(i, { value: e.target.value })}
                className="text-xs px-2.5 py-1.5 border border-border rounded-[7px] bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                data-r10n-tmpl-cb-select
              >
                {fieldMeta.options!.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                value={cond.value}
                onChange={(e) => updateCondition(i, { value: e.target.value })}
                className="text-xs w-16 px-2.5 py-1.5 border border-border rounded-[7px] bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                data-r10n-tmpl-cb-input
              />
            )}

            {/* Remove */}
            <button
              type="button"
              onClick={() => removeCondition(i)}
              className="p-1 text-muted-foreground hover:text-destructive transition-colors"
              data-r10n-tmpl-cb-remove
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={addCondition}
        className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors mt-1"
        data-r10n-tmpl-cb-add
      >
        <Plus className="w-3.5 h-3.5" />
        Add condition
      </button>
    </div>
  );
}
