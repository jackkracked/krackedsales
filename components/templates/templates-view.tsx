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
      <div className="px-6 pt-5 pb-0 shrink-0 border-b border-border">
        <div className="flex items-end justify-between mb-0">
          <h1
            className="text-xl font-bold text-foreground pb-4"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Templates
          </h1>

          {/* Edge legend — only shown on flow tab */}
          {tab === "flow" && (
            <div className="hidden sm:flex items-center gap-5 pb-4">
              {[
                { color: "#16a34a", label: "Yes / Positive", dashed: false },
                { color: "#dc2626", label: "No / Exit",      dashed: false },
                { color: "#d97706", label: "Follow-up",      dashed: true  },
                { color: "#7c3aed", label: "Immediate",      dashed: false },
              ].map(({ color, label, dashed }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <svg width="20" height="10" viewBox="0 0 20 10">
                    {dashed
                      ? <line x1="0" y1="5" x2="20" y2="5" stroke={color} strokeWidth="2" strokeDasharray="4 3" />
                      : <line x1="0" y1="5" x2="20" y2="5" stroke={color} strokeWidth="2" />
                    }
                  </svg>
                  <span className="text-[11px] text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
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
