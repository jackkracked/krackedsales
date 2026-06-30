"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils/cn";

/** Phone-keypad letters under each digit — the premium recognition cue. */
const KEYS: { d: string; sub?: string }[] = [
  { d: "1" }, { d: "2", sub: "ABC" }, { d: "3", sub: "DEF" },
  { d: "4", sub: "GHI" }, { d: "5", sub: "JKL" }, { d: "6", sub: "MNO" },
  { d: "7", sub: "PQRS" }, { d: "8", sub: "TUV" }, { d: "9", sub: "WXYZ" },
  { d: "*" }, { d: "0", sub: "+" }, { d: "#" },
];

/**
 * The keypad instrument. Light, tactile keys with a soft top highlight, a real
 * drop shadow, and a satisfying press. Holding 0 inserts a "+" (international),
 * exactly like a phone. Purely presentational — the parent owns the number.
 */
export function Keypad({
  onPress,
  disabled,
}: {
  onPress: (key: string) => void;
  disabled?: boolean;
}) {
  // Long-press 0 → "+". Tracks the press so a hold inserts "+" and a tap inserts "0".
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);

  function startZero() {
    longFired.current = false;
    holdTimer.current = setTimeout(() => {
      longFired.current = true;
      onPress("+");
    }, 450);
  }
  function endZero() {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (!longFired.current) onPress("0");
  }

  return (
    <div className="grid grid-cols-3 gap-2.5" role="group" aria-label="Keypad">
      {KEYS.map(({ d, sub }) => {
        const isZero = d === "0";
        return (
          <button
            key={d}
            type="button"
            disabled={disabled}
            aria-label={d === "*" ? "star" : d === "#" ? "pound" : d}
            onClick={isZero ? undefined : () => onPress(d)}
            onPointerDown={isZero ? startZero : undefined}
            onPointerUp={isZero ? endZero : undefined}
            onPointerLeave={isZero ? () => holdTimer.current && clearTimeout(holdTimer.current) : undefined}
            className={cn(
              "group/key relative flex aspect-[5/4] flex-col items-center justify-center select-none",
              "rounded-[16px] border border-border/70 bg-gradient-to-b from-white to-[#FBFAF7]",
              "shadow-[0_1px_2px_rgba(28,35,51,0.05),0_6px_14px_-8px_rgba(28,35,51,0.18)]",
              "transition-all duration-150 ease-out",
              "motion-safe:hover:-translate-y-px hover:border-border hover:shadow-[0_2px_4px_rgba(28,35,51,0.06),0_10px_22px_-10px_rgba(28,35,51,0.22)]",
              "active:translate-y-0 active:scale-[0.97] active:shadow-[inset_0_1px_3px_rgba(28,35,51,0.10)] active:duration-75",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1",
              "disabled:opacity-40 disabled:pointer-events-none",
            )}
          >
            {/* faint top highlight for the instrument feel */}
            <span className="pointer-events-none absolute inset-x-2 top-px h-1/3 rounded-t-[15px] bg-gradient-to-b from-white/80 to-transparent" />
            <span
              className="text-[26px] leading-none font-medium text-foreground tabular-nums"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {d}
            </span>
            {sub && (
              <span className="mt-1 text-[8.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                {sub}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
