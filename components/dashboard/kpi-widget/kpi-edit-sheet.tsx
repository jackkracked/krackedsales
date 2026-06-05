"use client";

import { useState } from "react";
import { X, Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { KpiDef } from "@/lib/dashboard-kpis";

interface KpiEditSheetProps {
  pool: KpiDef[];
  selected: string[];
  onSave: (keys: string[]) => void;
  onClose: () => void;
  isSaving: boolean;
}

export function KpiEditSheet({ pool, selected, onSave, onClose, isSaving }: KpiEditSheetProps) {
  const [draft, setDraft] = useState<string[]>(selected);

  function toggle(key: string) {
    if (draft.includes(key)) {
      // Don't allow deselecting if only 1 remains
      if (draft.length <= 1) return;
      setDraft(draft.filter((k) => k !== key));
    } else {
      setDraft([...draft, key]);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        className={cn(
          "fixed right-0 top-0 bottom-0 z-50 w-[360px] bg-card border-l border-border",
          "flex flex-col shadow-xl animate-slide-in-right"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h3
              className="text-[14px] font-semibold text-foreground"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Customise KPIs
            </h3>
            <p className="text-[11.5px] text-muted-foreground mt-0.5">
              Select metrics to pin to your dashboard
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-muted/60 transition-colors"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>

        {/* Metric list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {pool.map((metric) => {
            const isSelected = draft.includes(metric.key);
            return (
              <button
                key={metric.key}
                onClick={() => toggle(metric.key)}
                className={cn(
                  "w-full text-left px-4 py-3 rounded-[10px] border transition-all duration-150",
                  "flex items-start justify-between gap-3",
                  isSelected
                    ? "border-primary/30 bg-primary/[0.04]"
                    : "border-border bg-background hover:bg-muted/30"
                )}
              >
                <div className="min-w-0">
                  <p
                    className={cn(
                      "text-[13px] font-medium leading-snug",
                      isSelected ? "text-foreground" : "text-foreground/80"
                    )}
                  >
                    {metric.label}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                    {metric.description}
                  </p>
                </div>
                <div
                  className={cn(
                    "mt-0.5 shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
                    isSelected
                      ? "bg-primary border-primary"
                      : "border-border"
                  )}
                >
                  {isSelected && (
                    <Check className="w-3 h-3 text-primary-foreground" />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border">
          <button
            onClick={() => onSave(draft)}
            disabled={draft.length < 1 || isSaving}
            className={cn(
              "w-full py-2.5 rounded-[8px] text-[13px] font-semibold transition-all",
              draft.length >= 1 && !isSaving
                ? "bg-primary text-primary-foreground hover:opacity-90"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            {isSaving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
    </>
  );
}
