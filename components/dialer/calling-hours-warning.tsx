"use client";

import { useEffect, useRef } from "react";
import { Clock, MapPin } from "lucide-react";
import { Button } from "@/components/untitled/base/buttons/button";
import type { CallingWindow } from "@/lib/dialer/calling-hours";

/**
 * "It is 4:12am for this person. Still want to call?"
 *
 * Jack, 2026-09-25, on a prospect dialled at 4am their time: "our system would recognise that,
 * warn her, and then she can continue to the dial if she chooses to bypass that."
 *
 * SO THIS NEVER BLOCKS. Call anyway is always there and always works. The job is to make the
 * one fact she cannot see, their local time, impossible to miss for the half second it takes
 * to change her mind.
 *
 * Cancel is the default and the focused control, because the safe outcome should be the one
 * that happens if she hits Enter without reading. Escape and a click outside both cancel.
 */
export function CallingHoursWarning({
  contactName,
  window: w,
  onCancel,
  onCallAnyway,
}: {
  contactName: string;
  window: CallingWindow;
  onCancel: () => void;
  onCallAnyway: () => void;
}) {
  // Untitled's Button does not forward a ref, so focus is taken through the footer element.
  const footerRef = useRef<HTMLDivElement>(null);

  // Focus ONCE. This effect used to depend on `onCancel`, whose identity changed on every
  // parent render, and the dialer re-renders whenever a background query settles. The result
  // was focus being yanked back to "Don't call" while the rep was reaching for "Call anyway".
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    footerRef.current?.querySelector("button")?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); return; }
      // Keep Tab inside the dialog: the page behind is only visually covered.
      if (e.key !== "Tab") return;
      const focusables = footerRef.current?.parentElement?.querySelectorAll<HTMLElement>("button");
      if (!focusables?.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // An approximate placing must say so. False precision is how a warning loses its authority.
  const approximate = w.confidence === "approximate";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "var(--overlay)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="calling-hours-title"
        aria-describedby="calling-hours-detail"
        className="w-full max-w-[420px] overflow-hidden rounded-[16px] border border-border bg-card shadow-[0_24px_60px_-20px_rgba(28,35,51,0.4)]"
      >
        <div className="px-5 pb-4 pt-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <Clock className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              {/* THE TIME IS THE HEADLINE. It is the only fact that changes the decision. */}
              <h2
                id="calling-hours-title"
                className="text-[17px] font-semibold leading-tight text-foreground"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                It&rsquo;s {approximate ? "around " : ""}{w.localTime} for {contactName}
              </h2>
              <p id="calling-hours-detail" className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                {w.place && (
                  <span className="inline-flex items-center gap-1 font-medium text-foreground/80">
                    <MapPin className="h-3.5 w-3.5" />
                    {w.place}
                  </span>
                )}
                {w.place && " · "}
                {w.rule}
              </p>
              {approximate && (
                <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                  Their exact location isn&rsquo;t known from this number, so the time is our best
                  estimate. It&rsquo;s outside calling hours wherever they are in the country.
                </p>
              )}
            </div>
          </div>
        </div>

        <div ref={footerRef} className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-5 py-3">
          <Button size="sm" color="secondary" onClick={onCancel}>
            Don&rsquo;t call
          </Button>
          <Button size="sm" color="primary" onClick={onCallAnyway}>
            Call anyway
          </Button>
        </div>
      </div>
    </div>
  );
}
