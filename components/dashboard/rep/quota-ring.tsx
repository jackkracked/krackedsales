"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils/cn";

interface QuotaRingProps {
  current: number;
  target: number;
  label: string;
  sublabel?: string;
}

const SIZE = 140;
const STROKE = 10;
const R = (SIZE - STROKE) / 2;
// Arc spans 240 degrees — starts at 150deg (bottom-left), sweeps clockwise to 30deg (bottom-right)
const CIRCUMFERENCE = 2 * Math.PI * R;
const ARC_FRACTION = 240 / 360; // 240 degree arc
const ARC_LENGTH = CIRCUMFERENCE * ARC_FRACTION;

export function QuotaRing({ current, target, label, sublabel }: QuotaRingProps) {
  const progressRef = useRef<SVGCircleElement>(null);

  const pct = target > 0 ? Math.min(current / target, 1) : 0;
  const filledLength = pct * ARC_LENGTH;
  const gapLength = CIRCUMFERENCE - filledLength;

  // Rotation: the arc starts at 150deg from 12 o'clock = 150 - 90 = 60deg CSS rotation
  const startRotation = 150 - 90;

  useEffect(() => {
    const el = progressRef.current;
    if (!el) return;
    // Animate stroke-dashoffset from 0 fill to target fill
    el.style.transition = "none";
    el.style.strokeDashoffset = `${ARC_LENGTH}`;
    // Force reflow
    void el.getBoundingClientRect();
    el.style.transition = "stroke-dashoffset 1s cubic-bezier(0.16,1,0.3,1)";
    el.style.strokeDashoffset = `${ARC_LENGTH - filledLength}`;
  }, [filledLength]);

  const pctDisplay = Math.round(pct * 100);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          style={{ transform: `rotate(${startRotation}deg)` }}
        >
          {/* Track */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="var(--border)"
            strokeWidth={STROKE}
            strokeDasharray={`${ARC_LENGTH} ${CIRCUMFERENCE - ARC_LENGTH}`}
            strokeLinecap="round"
          />
          {/* Progress */}
          <circle
            ref={progressRef}
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={STROKE}
            strokeDasharray={`${ARC_LENGTH} ${CIRCUMFERENCE - ARC_LENGTH}`}
            strokeDashoffset={ARC_LENGTH - filledLength}
            strokeLinecap="round"
          />
        </svg>

        {/* Center text */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center"
          style={{ paddingTop: 8 }} // visual centering within the arc
        >
          <span
            className={cn(
              "text-2xl font-bold leading-none tabular-nums",
              pct >= 1 ? "text-emerald-500" : "text-foreground"
            )}
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {pctDisplay}%
          </span>
          <span className="text-[10px] text-muted-foreground mt-0.5">quota</span>
        </div>
      </div>

      <div className="text-center">
        <p className="text-sm font-semibold text-foreground tabular-nums">
          {current} / {target}
        </p>
        <p className="text-xs text-muted-foreground">{label}</p>
        {sublabel && (
          <p className="text-[11px] text-muted-foreground/70 mt-0.5">{sublabel}</p>
        )}
      </div>
    </div>
  );
}
