"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Loader2, AlertTriangle } from "lucide-react";
import { META_LEAD_STAGES, type MetaLeadStage } from "@/lib/db/schema";

/**
 * The stage control — the single most consequential widget in the app.
 *
 * Changing it is what tells Facebook a lead was worth having, on traffic costing $117-$337
 * per qualified lead. So it is optimistic (Gage triages fast and must not wait on a network
 * round-trip) but it ROLLS BACK visibly on failure. A control that silently keeps a stage
 * the server rejected would be the same class of bug as the billing failure: looks fine,
 * isn't.
 *
 * All eight interactive states are covered per the interaction-design reference: default,
 * hover, focus-visible, active, disabled, loading, error, success.
 */

export const STAGE_LABEL: Record<MetaLeadStage, string> = {
  intake: "Intake",
  need_more_info: "Need More Info",
  qualified: "Qualified",
  disqualified: "Disqualified",
  converted: "Converted",
  lost: "Lost",
  not_qualified: "Not Qualified",
};

/** Muted by default; only the two stages that carry real meaning get colour.
 *  PRODUCT.md: "Heavy colour on inactive states" is a listed ban. */
const STAGE_TONE: Record<MetaLeadStage, string> = {
  intake: "text-muted-foreground",
  need_more_info: "text-muted-foreground",
  qualified: "text-[var(--accent-green)] font-medium",
  converted: "text-[var(--accent-green)] font-medium",
  disqualified: "text-muted-foreground",
  lost: "text-muted-foreground",
  not_qualified: "text-muted-foreground",
};

interface Props {
  leadId: string;
  value: MetaLeadStage | null;
  /** Signal receipt from the last change, so a failed send is visible on the row. */
  capiStatus?: string | null;
  onChanged?: (stage: MetaLeadStage) => void;
  compact?: boolean;
}

export function StageSelect({ leadId, value, capiStatus, onChanged, compact }: Props) {
  const [stage, setStage] = useState<MetaLeadStage | null>(value);

  // Re-sync when the server value changes (another user, another instance of this control on
  // the same lead, or a background refetch). Without this the control silently diverges from
  // the database and shows a stage that was never saved.
  useEffect(() => { setStage(value); }, [value]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function change(next: MetaLeadStage) {
    const previous = stage;
    setStage(next); // optimistic
    setOpen(false);
    setError(null);

    startTransition(async () => {
      try {
        const res = await fetch(`/api/leads/${leadId}/stage`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage: next }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Failed (${res.status})`);
        }
        onChanged?.(next);
      } catch (err) {
        setStage(previous); // roll back — never leave a lie on screen
        setError(err instanceof Error ? err.message : "Could not save");
      }
    });
  }

  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  /**
   * The menu is PORTALLED to <body> rather than positioned inside this component.
   *
   * Both call sites live inside a scroll container — the leads table (`overflow-auto`) and
   * the detail drawer (`overflow-y-auto`). An absolutely-positioned menu is clipped by the
   * nearest scrolling ancestor, so on any row below the fold the options were cut off or
   * invisible entirely: Gage could not set a stage at all. z-index cannot fix clipping.
   *
   * Consequence of portalling: the menu no longer moves with the row, so we measure on open
   * and close on scroll. That is what a native <select> does, and a menu that silently
   * detaches from its trigger is worse than one that closes.
   */
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; drop: "down" | "up" } | null>(null);
  const MENU_MAX_H = 288; // 7 stages at 40px + padding

  const measure = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const drop: "down" | "up" = below < MENU_MAX_H && r.top > below ? "up" : "down";
    const width = 192; // min-w-[12rem]
    setCoords({
      top: drop === "down" ? r.bottom + 4 : r.top - 4,
      // Keep it on screen when the trigger sits near the right edge (drawer, narrow viewport).
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      drop,
    });
  }, []);

  // useEffect, not useLayoutEffect: this is SSR'd and useLayoutEffect warns on the server.
  // There is no flash of a mispositioned menu because it does not render until `coords` exist.
  useEffect(() => {
    if (!open) { setCoords(null); return; }
    measure();
    const close = () => setOpen(false);
    // Capture phase: catches scrolling in ANY ancestor, not just the window.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, measure]);

  // Move focus into the menu so keyboard users are not left on the trigger with an open list.
  // Land on the CURRENT stage, not the first one, so the list opens where the eye already is.
  useEffect(() => {
    if (!open || !coords) return;
    const menu = menuRef.current;
    if (!menu) return;
    const selected = menu.querySelector<HTMLButtonElement>('[role=option][aria-selected="true"]');
    (selected ?? menu.querySelector<HTMLButtonElement>("[role=option]"))?.focus();
  }, [open, coords]);

  const label = stage ? STAGE_LABEL[stage] : "Set stage";
  const signalFailed = capiStatus === "failed";

  return (
    <div className="relative inline-flex items-center gap-1.5">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Lead stage: ${label}`}
        className={[
          "inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-border",
          compact ? "px-2 py-1 text-xs" : "px-2.5 py-1.5 text-sm",
          "bg-background transition-colors duration-150",
          "hover:bg-muted",
          "focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-green)]",
          "active:bg-muted",
          "disabled:opacity-50 disabled:pointer-events-none",
          stage ? STAGE_TONE[stage] : "text-muted-foreground",
        ].join(" ")}
      >
        {pending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
        <span className="truncate max-w-[9rem]">{label}</span>
        <ChevronDown className="h-3 w-3 opacity-60 shrink-0" aria-hidden />
      </button>

      {/* The signal receipt. Silence here would repeat the billing mistake. */}
      {signalFailed && !error ? (
        <span title="Meta was not told about this stage change" className="text-amber-600">
          <AlertTriangle className="h-3.5 w-3.5" aria-label="Signal to Meta failed" />
        </span>
      ) : null}

      {error ? (
        <span role="alert" className="text-xs text-red-600 max-w-[12rem] truncate" title={error}>
          {error}
        </span>
      ) : null}

      {open && coords && typeof document !== "undefined" ? createPortal(
        <>
          {/* Click-away. Not a modal: PRODUCT.md bans modal-as-first-thought. */}
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} aria-hidden />
          <div
            ref={menuRef}
            role="listbox"
            style={{
              top: coords.top,
              left: coords.left,
              maxHeight: MENU_MAX_H,
              // Flipping up means anchoring the menu's BOTTOM to the trigger's top.
              transform: coords.drop === "up" ? "translateY(-100%)" : undefined,
            }}
            className="fixed z-[61] min-w-[12rem] overflow-y-auto rounded-[var(--radius)] border border-border bg-card shadow-lg py-1"
          >
            {META_LEAD_STAGES.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="option"
                  aria-selected={s === stage}
                  onClick={() => change(s)}
                  className={[
                    "w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-left",
                    "transition-colors duration-150 hover:bg-muted",
                    "focus:outline-none focus-visible:bg-muted",
                    s === stage ? "font-medium" : "",
                  ].join(" ")}
                >
                  <span>{STAGE_LABEL[s]}</span>
                  {s === stage ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
                </button>
            ))}
          </div>
        </>,
        document.body,
      ) : null}
    </div>
  );
}
