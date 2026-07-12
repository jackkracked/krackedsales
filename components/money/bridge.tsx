"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { fmtMoneyK } from "./format";

export type StepKind = "anchor" | "in" | "out" | "checkpoint" | "result";
export interface BridgeStep {
  label: string;
  value: number; // magnitude for in/out; the total for anchor/checkpoint/result
  kind: StepKind;
  hint?: string;
  estimate?: boolean;
}

/**
 * A flat, semantic-coloured waterfall bridge. Bars step from a shared baseline:
 * anchors/checkpoints/results are totals; in/out are floating deltas. Four colours carry
 * meaning, nothing carries decoration (ink=anchor, green=in, clay=out, accent=checkpoint).
 */
export function Bridge({ steps, height = 200, className }: { steps: BridgeStep[]; height?: number; className?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Running totals → each bar's [bottom, top] in value-space.
  let running = 0;
  const bars = steps.map((s) => {
    let bottom = 0;
    let top = 0;
    if (s.kind === "anchor") { bottom = 0; top = s.value; running = s.value; }
    else if (s.kind === "out") { top = running; bottom = running - s.value; running = bottom; }
    else if (s.kind === "in") { bottom = running; top = running + s.value; running = top; }
    else { bottom = 0; top = running; } // checkpoint / result mark the running total
    return { ...s, bottom, top, total: running };
  });
  const max = Math.max(1, ...bars.map((b) => Math.max(b.top, b.bottom)));

  const barColor = (b: (typeof bars)[number]) => {
    if (b.kind === "anchor") return "bg-foreground/80";
    if (b.kind === "in") return "bg-success";
    if (b.kind === "out") return "bg-destructive/55";
    if (b.kind === "result") return b.total >= 0 ? "bg-success" : "bg-destructive";
    return "bg-muted-foreground/25"; // checkpoint (gets accent top-cap below)
  };

  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-end gap-2 sm:gap-3" style={{ height }}>
        {bars.map((b, i) => {
          const topPx = (b.top / max) * height;
          const bottomPx = (b.bottom / max) * height;
          const barH = Math.max(2, topPx - bottomPx);
          const isCheckpoint = b.kind === "checkpoint";
          return (
            <div key={i} className="group/bar relative flex min-w-0 flex-1 flex-col justify-end" style={{ height }} title={b.hint}>
              {/* value label, tracks the top of the bar */}
              <span
                className="absolute left-0 right-0 text-center text-[11px] font-bold tabular-nums leading-none text-foreground"
                style={{ bottom: mounted ? topPx + 6 : bottomPx + 6, transition: "bottom 500ms cubic-bezier(0.16,1,0.3,1)" }}
              >
                <span className={cn(b.estimate && "border-b border-dotted border-muted-foreground/50")}>{fmtMoneyK(b.value)}</span>
              </span>
              {/* the bar */}
              <div
                className={cn("relative w-full rounded-[2px] motion-reduce:transition-none", barColor(b))}
                style={{ height: mounted ? barH : 0, marginBottom: mounted ? bottomPx : 0, transition: "height 500ms cubic-bezier(0.16,1,0.3,1), margin-bottom 500ms cubic-bezier(0.16,1,0.3,1)", transitionDelay: `${i * 40}ms` }}
              >
                {isCheckpoint && <span className="absolute inset-x-0 -top-[2px] h-[2px] bg-primary" />}
              </div>
            </div>
          );
        })}
      </div>
      {/* baseline */}
      <div className="h-px w-full bg-border" />
      {/* labels */}
      <div className="flex items-start gap-2 pt-1.5 sm:gap-3">
        {bars.map((b, i) => (
          <div key={i} className="min-w-0 flex-1 text-center">
            <span className="block truncate text-[9.5px] font-medium uppercase tracking-wide text-muted-foreground">{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
