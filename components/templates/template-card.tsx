"use client";

import { cn } from "@/lib/utils/cn";
import { Trophy, ToggleLeft, ToggleRight, ChevronRight } from "lucide-react";
import type { TemplateWithStats, TemplateCondition } from "@/lib/templates/types";
import { CONDITION_FIELDS, OPERATOR_LABELS } from "@/lib/templates/types";

function StatPill({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className="flex flex-col items-center px-3 py-2 bg-muted/40 rounded-[8px] min-w-[64px]"
      data-r10n-tmpl-stat
      data-highlight={highlight ? "true" : "false"}
    >
      <span
        className={cn("text-base font-bold", highlight ? "text-primary" : "text-foreground")}
        data-r10n-tmpl-stat-value
      >
        {value}
      </span>
      <span className="text-[10px] text-muted-foreground font-medium mt-0.5" data-r10n-tmpl-stat-label>{label}</span>
    </div>
  );
}

function ConditionPill({ condition }: { condition: TemplateCondition }) {
  const fieldLabel = CONDITION_FIELDS[condition.field]?.label ?? condition.field;
  const opLabel = OPERATOR_LABELS[condition.operator];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 bg-muted text-muted-foreground text-[11px] rounded-full border border-border/60"
      data-r10n-tmpl-cond
    >
      <span className="font-medium text-foreground" data-r10n-tmpl-cond-key>{fieldLabel}</span>
      <span data-r10n-tmpl-cond-op>{opLabel}</span>
      <span className="font-medium text-foreground" data-r10n-tmpl-cond-val>{condition.value}</span>
    </span>
  );
}

interface TemplateCardProps {
  template: TemplateWithStats;
  onEdit: () => void;
  onToggleActive: () => void;
  onMarkWinner: () => void;
  isAbSibling?: boolean;
}

export function TemplateCard({
  template,
  onEdit,
  onToggleActive,
  onMarkWinner,
  isAbSibling,
}: TemplateCardProps) {
  const { stats } = template;
  const conditions = template.conditions as TemplateCondition[];

  const responseRatePct = Math.round(stats.responseRate * 100);
  const convRatePct = Math.round(stats.conversionRate * 100);

  return (
    <div
      className={cn(
        "bg-card border rounded-[12px] p-4 transition-all duration-150",
        template.active ? "border-border hover:border-primary/30 hover:shadow-sm" : "border-border/40 opacity-60",
        template.isWinner && "border-amber-200 bg-amber-50/30",
        isAbSibling && "ring-1 ring-inset ring-primary/30"
      )}
      data-r10n-tmpl-card
      data-active={template.active ? "true" : "false"}
      data-winner={template.isWinner ? "true" : "false"}
      data-absibling={isAbSibling ? "true" : "false"}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-foreground" data-r10n-tmpl-name>{template.name}</h3>
            {template.isWinner && (
              <span
                className="flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 text-[11px] font-semibold rounded-full"
                data-r10n-tmpl-badge
                data-kind="winner"
              >
                <Trophy className="w-3 h-3" />
                Winner
              </span>
            )}
            {template.abGroup && (
              <span
                className="px-2 py-0.5 bg-primary/10 text-primary text-[11px] font-medium rounded-full"
                data-r10n-tmpl-badge
                data-kind="ab"
              >
                A/B: {template.abGroup} ({template.weight}%)
              </span>
            )}
            {!template.active && (
              <span
                className="px-2 py-0.5 bg-muted text-muted-foreground text-[11px] rounded-full"
                data-r10n-tmpl-badge
                data-kind="inactive"
              >
                Inactive
              </span>
            )}
          </div>
          {/* Conditions */}
          {conditions.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {conditions.map((c, i) => (
                <ConditionPill key={i} condition={c} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mt-1" data-r10n-tmpl-matchall>Matches all leads</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onToggleActive}
            className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
            title={template.active ? "Deactivate" : "Activate"}
            data-r10n-tmpl-toggle
            data-on={template.active ? "true" : "false"}
          >
            {template.active
              ? <ToggleRight className="w-5 h-5 text-primary" />
              : <ToggleLeft className="w-5 h-5" />
            }
          </button>
          <button
            onClick={onEdit}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-[7px] transition-colors"
            data-r10n-tmpl-action
          >
            Edit
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Body preview */}
      <p
        className="text-xs text-muted-foreground leading-relaxed line-clamp-2 mb-3 bg-muted/30 rounded-[7px] px-3 py-2 border border-border/60"
        data-r10n-tmpl-preview
      >
        {template.body}
      </p>

      {/* Stats row */}
      <div className="flex items-center gap-2 flex-wrap">
        <StatPill label="Total Sends" value={String(stats.sends)} />
        <StatPill label="30d Sends" value={String(stats.sends30d)} />
        <StatPill
          label="Response Rate"
          value={stats.sends > 0 ? `${responseRatePct}%` : "—"}
          highlight={responseRatePct > 30}
        />
        <StatPill
          label="Conversion"
          value={stats.sends > 0 ? `${convRatePct}%` : "—"}
          highlight={convRatePct > 10}
        />

        {/* Mark winner button — only for A/B templates without a winner yet */}
        {template.abGroup && !template.isWinner && stats.sends >= 5 && (
          <button
            onClick={onMarkWinner}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-[7px] hover:bg-amber-100 transition-colors"
            data-r10n-tmpl-winbtn
          >
            <Trophy className="w-3.5 h-3.5" />
            Mark Winner
          </button>
        )}

        {template.abGroup && !template.isWinner && stats.sends < 5 && (
          <p className="ml-auto text-[11px] text-muted-foreground" data-r10n-tmpl-winhint>
            {5 - stats.sends} more send{5 - stats.sends !== 1 ? "s" : ""} to unlock winner selection
          </p>
        )}
      </div>
    </div>
  );
}
