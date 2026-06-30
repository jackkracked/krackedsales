"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import { FlowCanvas } from "@/components/flow/flow-canvas";
import { ABLeaderboard } from "@/components/templates/ab-leaderboard";

const TABS = [
  { id: "flow",   label: "Conversation Flow" },
  { id: "ab",     label: "A/B Tests" },
] as const;

type TabId = typeof TABS[number]["id"];

export function TemplatesView() {
  const [tab, setTab] = useState<TabId>("flow");

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-0 shrink-0 border-b border-border" data-r10n-tmpl-header>
        <div className="flex items-end justify-between mb-0">
          <h1
            className="text-xl font-bold text-foreground pb-4"
            style={{ fontFamily: "var(--font-heading)" }}
            data-r10n-tmpl-title
          >
            Templates
          </h1>

          {/* Edge legend — only shown on flow tab */}
          {tab === "flow" && (
            <div className="hidden sm:flex items-center gap-5 pb-4" data-r10n-tmpl-legend>
              {[
                { color: "#16a34a", varName: "--r10n-tmpl-edge-yes", label: "Yes / Positive", dashed: false },
                { color: "#dc2626", varName: "--r10n-tmpl-edge-no",  label: "No / Exit",      dashed: false },
                { color: "#d97706", varName: "--r10n-tmpl-edge-fu",  label: "Follow-up",      dashed: true  },
                { color: "#7c3aed", varName: "--r10n-tmpl-edge-now", label: "Immediate",      dashed: false },
              ].map(({ color, varName, label, dashed }) => {
                const stroke = `var(${varName}, ${color})`;
                return (
                  <div key={label} className="flex items-center gap-1.5" data-r10n-tmpl-legend-item>
                    <svg width="20" height="10" viewBox="0 0 20 10">
                      {dashed
                        ? <line x1="0" y1="5" x2="20" y2="5" stroke={stroke} strokeWidth="2" strokeDasharray="4 3" />
                        : <line x1="0" y1="5" x2="20" y2="5" stroke={stroke} strokeWidth="2" />
                      }
                    </svg>
                    <span className="text-[11px] text-muted-foreground" data-r10n-tmpl-legend-label>{label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex gap-1" data-r10n-tmpl-tabs>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              data-r10n-tmpl-tab
              data-active={tab === t.id}
              className={cn(
                "px-3 py-1.5 text-[13px] font-medium rounded-t-md border-b-2 transition-colors",
                tab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        {tab === "flow" ? (
          <FlowCanvas />
        ) : (
          <div className="h-full overflow-y-auto">
            <ABLeaderboard />
          </div>
        )}
      </div>
    </div>
  );
}
