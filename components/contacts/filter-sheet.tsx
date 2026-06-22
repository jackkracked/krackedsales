"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { SlidersHorizontal, X, RotateCcw, Lock } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Avatar } from "@/components/ui/avatar";
import {
  type ContactFilters,
  type TriState,
  OPT_IN_OPTIONS,
  CHANNEL_OPTIONS,
  URGENCY_OPTIONS,
  AVAIL_OPTIONS,
  stageTint,
  countActive,
} from "@/lib/contacts/filters";

interface FilterSheetProps {
  open: boolean;
  filters: ContactFilters;
  onChange: (f: ContactFilters) => void;
  onClear: () => void;
  onClose: () => void;
  matchCount: number;
  baselineCount: number;
  loading: boolean;
  stages: { value: string; label: string }[];
  reps: { value: string; label: string }[];
}

// ─── Client-only flag (hydration-safe, no setState-in-effect) ────────────────

const emptySubscribe = () => () => {};
function useIsClient(): boolean {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

// ─── Count-up for the hero number (respects reduced motion) ──────────────────
// All state writes happen inside requestAnimationFrame, never synchronously in
// the effect body, so re-renders never cascade.

function useCountUp(target: number, duration = 360): number {
  const [val, setVal] = useState(target);
  const fromRef = useRef(target);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (reduce) {
      fromRef.current = target;
      const id = requestAnimationFrame(() => setVal(target));
      return () => cancelAnimationFrame(id);
    }

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return val;
}

// ─── Primitives ──────────────────────────────────────────────────────────────

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-xs font-medium ring-1 transition-all duration-150",
        active
          ? "bg-primary text-primary-foreground ring-primary shadow-[0_2px_8px_-2px_rgba(15,58,92,0.5)]"
          : "bg-card text-foreground/80 ring-border hover:ring-primary/40 hover:bg-primary/[0.03]"
      )}
    >
      {children}
    </button>
  );
}

function StagePill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-[9px] text-xs font-medium transition-all duration-150",
        active
          ? cn(stageTint(label), "ring-2")
          : "bg-card text-foreground/80 ring-1 ring-border hover:ring-primary/40 hover:bg-primary/[0.03]"
      )}
    >
      {label}
    </button>
  );
}

function Tri({ value, onChange, disabled }: { value: TriState; onChange: (v: TriState) => void; disabled?: boolean }) {
  return (
    <div className={cn("flex gap-1.5", disabled && "opacity-50")}>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={value === "yes"}
        onClick={() => onChange(value === "yes" ? null : "yes")}
        className={cn(
          "px-3.5 py-1.5 rounded-[9px] text-xs font-semibold ring-1 transition-all duration-150 disabled:cursor-not-allowed",
          value === "yes"
            ? "bg-accent-green text-white ring-accent-green shadow-[0_2px_8px_-2px_rgba(45,94,63,0.5)]"
            : "bg-card text-foreground/80 ring-border enabled:hover:ring-accent-green/40"
        )}
      >
        Yes
      </button>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={value === "no"}
        onClick={() => onChange(value === "no" ? null : "no")}
        className={cn(
          "px-3.5 py-1.5 rounded-[9px] text-xs font-semibold ring-1 transition-all duration-150 disabled:cursor-not-allowed",
          value === "no"
            ? "bg-foreground text-background ring-foreground"
            : "bg-card text-foreground/80 ring-border enabled:hover:ring-foreground/30"
        )}
      >
        No
      </button>
    </div>
  );
}

function Group({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-[14px] bg-[#FBFAF8] ring-1 ring-border/60 p-3.5", full && "sm:col-span-2")}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/80 mb-2.5">{label}</p>
      <div className="flex flex-wrap gap-1.5 items-center">{children}</div>
    </div>
  );
}

// ─── Sheet ───────────────────────────────────────────────────────────────────

export function FilterSheet({
  open,
  filters,
  onChange,
  onClear,
  onClose,
  matchCount,
  baselineCount,
  loading,
  stages,
  reps,
}: FilterSheetProps) {
  const displayCount = useCountUp(matchCount);
  const active = countActive(filters);

  // Portals must only render on the client, or SSR (null) and client (sheet) disagree
  const mounted = useIsClient();

  // Escape to close + body scroll lock while open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  // toggle a value in a string[] field
  const toggle = (key: "optIn" | "channel" | "stageId" | "rep" | "avail", v: string) => {
    const arr = filters[key];
    onChange({ ...filters, [key]: arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v] });
  };

  const setUrgencyPreset = (v: string) =>
    onChange({ ...filters, urgency: filters.urgency === v ? null : v });

  const setCustomUrgency = (raw: string) => {
    const n = raw.replace(/[^0-9]/g, "");
    onChange({ ...filters, urgency: n === "" ? null : n });
  };

  const setDaysInStage = (raw: string) => {
    const n = raw.replace(/[^0-9]/g, "");
    onChange({ ...filters, daysInStage: n === "" ? null : Number(n) });
  };

  const isCustomUrgency = filters.urgency != null && !URGENCY_OPTIONS.some((o) => o.value === filters.urgency);

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-overlay animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Filter contacts"
        className="fixed right-0 top-0 h-full w-full sm:w-[640px] z-50 bg-background border-l border-border shadow-2xl flex flex-col animate-slide-in-right"
      >
        {/* Hero header */}
        <div className="px-5 py-5 border-b border-border bg-primary/[0.04] shrink-0">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-[11px] bg-primary/10 flex items-center justify-center">
                <SlidersHorizontal className="w-4 h-4 text-primary" />
              </div>
              <h2 className="text-sm font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                Filters
              </h2>
              {active > 0 && (
                <span className="text-[11px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full tabular-nums">
                  {active} active
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close filters"
              className="p-1.5 rounded-[8px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span
              className={cn("text-[2.75rem] leading-none font-bold text-primary tabular-nums transition-opacity", loading && "opacity-40")}
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {displayCount.toLocaleString()}
            </span>
            <span className="text-sm text-muted-foreground">
              {baselineCount > 0 ? `of ${baselineCount.toLocaleString()} contacts match` : "contacts match"}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Group label="Opt-in source">
              {OPT_IN_OPTIONS.map((o) => (
                <Pill key={o.value} active={filters.optIn.includes(o.value)} onClick={() => toggle("optIn", o.value)}>
                  <span className={cn("w-1.5 h-1.5 rounded-full", filters.optIn.includes(o.value) ? "bg-current opacity-80" : o.dot)} />
                  {o.label}
                </Pill>
              ))}
            </Group>

            <Group label="Last contact channel">
              {CHANNEL_OPTIONS.map((o) => (
                <Pill key={o.value} active={filters.channel.includes(o.value)} onClick={() => toggle("channel", o.value)}>
                  {o.label}
                </Pill>
              ))}
            </Group>

            <Group label="Pipeline stage" full>
              {stages.length === 0 ? (
                <span className="text-xs text-muted-foreground/60">No stages available</span>
              ) : (
                stages.map((s) => (
                  <StagePill key={s.value} active={filters.stageId.includes(s.value)} label={s.label} onClick={() => toggle("stageId", s.value)} />
                ))
              )}
            </Group>

            <Group label="Assigned rep">
              {reps.length === 0 ? (
                <span className="text-xs text-muted-foreground/60">No reps available</span>
              ) : (
                reps.map((r) => {
                  const on = filters.rep.includes(r.value);
                  return (
                    <button
                      key={r.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle("rep", r.value)}
                      className={cn(
                        "inline-flex items-center gap-1.5 pl-1 pr-3 py-1 rounded-full text-xs font-medium ring-1 transition-all duration-150",
                        on
                          ? "bg-primary text-primary-foreground ring-primary shadow-[0_2px_8px_-2px_rgba(15,58,92,0.5)]"
                          : "bg-card text-foreground/80 ring-border hover:ring-primary/40"
                      )}
                    >
                      {r.label === "Unassigned" ? (
                        <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[9px] text-muted-foreground shrink-0">?</span>
                      ) : (
                        <Avatar name={r.label} size={20} variant="rep" />
                      )}
                      {r.label}
                    </button>
                  );
                })
              )}
            </Group>

            <Group label="Last contact urgency">
              {URGENCY_OPTIONS.map((o) => (
                <Pill key={o.value} active={filters.urgency === o.value} onClick={() => setUrgencyPreset(o.value)}>
                  {o.label}
                </Pill>
              ))}
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground ml-0.5">
                or
                <input
                  inputMode="numeric"
                  value={isCustomUrgency ? filters.urgency ?? "" : ""}
                  onChange={(e) => setCustomUrgency(e.target.value)}
                  placeholder="7"
                  aria-label="Custom days since last contact"
                  className="w-11 px-1.5 py-1 rounded-[7px] ring-1 ring-border bg-card text-center tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                d+
              </span>
            </Group>

            <Group label="Days in current stage">
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                more than
                <input
                  inputMode="numeric"
                  value={filters.daysInStage ?? ""}
                  onChange={(e) => setDaysInStage(e.target.value)}
                  placeholder="7"
                  aria-label="Days in current stage"
                  className="w-11 px-1.5 py-1 rounded-[7px] ring-1 ring-border bg-card text-center tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                days
              </span>
            </Group>

            <Group label="Demo sent">
              <Tri value={filters.demo} onChange={(v) => onChange({ ...filters, demo: v })} />
            </Group>

            <Group label="Audit delivered">
              <Tri value={null} onChange={() => {}} disabled />
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground/70 ml-1.5">
                <Lock className="w-2.5 h-2.5" />
                Coming soon
              </span>
            </Group>

            <Group label="Proposal sent">
              <Tri value={filters.proposal} onChange={(v) => onChange({ ...filters, proposal: v })} />
            </Group>

            <Group label="Available channels">
              {AVAIL_OPTIONS.map((o) => (
                <Pill key={o.value} active={filters.avail.includes(o.value)} onClick={() => toggle("avail", o.value)}>
                  {o.label}
                </Pill>
              ))}
            </Group>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-border bg-card shrink-0">
          <button
            type="button"
            onClick={onClear}
            disabled={active === 0}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Clear all
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-[10px] bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
