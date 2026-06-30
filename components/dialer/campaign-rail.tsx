"use client";

import { Plus, Phone } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { DialerCampaign } from "./mock-data";

function total(c: DialerCampaign) {
  return c.reached + c.exhausted + c.contacts.length;
}

export function CampaignRail({
  campaigns,
  selectedId,
  onSelect,
  onNewCampaign,
  isAdmin,
}: {
  campaigns: DialerCampaign[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewCampaign: () => void;
  isAdmin: boolean;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70" style={{ fontFamily: "var(--font-heading)" }}>
          Campaigns
        </h2>
        <button
            type="button"
            title="New campaign"
            onClick={onNewCampaign}
            className="flex h-6 w-6 items-center justify-center rounded-[7px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
          </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 pb-3 space-y-1.5">
        {campaigns.map((c) => {
          const t = total(c);
          const pct = t > 0 ? Math.round((c.reached / t) * 100) : 0;
          const selected = c.id === selectedId;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(c.id)}
              className={cn(
                "group w-full rounded-[10px] border px-3 py-3 text-left transition-all duration-150",
                selected
                  ? "border-primary/30 bg-primary/[0.05] shadow-[0_1px_0_rgba(28,35,51,0.02)]"
                  : "border-transparent hover:border-border/70 hover:bg-muted/40",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <p className={cn("text-[13px] font-semibold leading-tight", selected ? "text-foreground" : "text-foreground/90")}>
                  {c.name}
                </p>
                <span className="shrink-0 mt-0.5 inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[9.5px] font-semibold text-muted-foreground tabular-nums">
                  <Phone className="h-2.5 w-2.5" />
                  {c.contacts.length}
                </span>
              </div>

              {/* progress */}
              <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-info transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-1.5 flex items-center justify-between">
                <span className="text-[10px] font-medium text-muted-foreground tabular-nums">
                  {c.reached} reached · {c.contacts.length} left
                </span>
                <div className="flex -space-x-1.5">
                  {c.reps.map((r) => (
                    <span
                      key={r.initials}
                      title={r.name}
                      className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-primary/10 text-[8px] font-bold text-primary ring-2 ring-background"
                    >
                      {r.initials}
                    </span>
                  ))}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
