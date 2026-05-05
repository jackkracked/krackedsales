"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils/cn";

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  segments: DonutSegment[];
  title?: string;
  className?: string;
}

const SIZE = 160;
const STROKE_WIDTH = 22;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const CENTER = SIZE / 2;

export function DonutChart({ segments, title, className }: DonutChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const total = segments.reduce((sum, s) => sum + s.value, 0);

  // Build arc offsets — each segment starts where the previous ended
  const arcs = segments.reduce<{ segment: DonutSegment; offset: number; dash: number }[]>(
    (acc, segment) => {
      const prevOffset = acc.length > 0 ? acc[acc.length - 1].offset + acc[acc.length - 1].dash : 0;
      const dash = total > 0 ? (segment.value / total) * CIRCUMFERENCE : 0;
      acc.push({ segment, offset: prevOffset, dash });
      return acc;
    },
    []
  );

  // Center display
  const hovered = hoveredIndex !== null ? segments[hoveredIndex] : null;
  const centerValue = hovered ? hovered.value : total;
  const centerLabel = hovered ? hovered.label : "Total";
  const centerPct = hovered && total > 0 ? Math.round((hovered.value / total) * 100) : null;

  return (
    <div className={cn("flex items-center gap-6", className)}>
      {/* SVG donut */}
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE}>
          <defs>
            {arcs.map((arc, i) => (
              <filter key={i} id={`glow-${i}`} x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            ))}
          </defs>

          {/* Track ring */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke="var(--muted)"
            strokeWidth={STROKE_WIDTH}
          />

          {/* Animated segments */}
          {arcs.map((arc, i) => {
            const isHovered = hoveredIndex === i;
            const gap = 2; // gap between segments in px
            const adjustedDash = Math.max(0, arc.dash - gap);
            const adjustedOffset = arc.offset + gap / 2;

            return (
              <motion.circle
                key={i}
                cx={CENTER}
                cy={CENTER}
                r={RADIUS}
                fill="none"
                stroke={arc.segment.color}
                strokeWidth={isHovered ? STROKE_WIDTH + 4 : STROKE_WIDTH}
                strokeLinecap="butt"
                strokeDasharray={`${adjustedDash} ${CIRCUMFERENCE - adjustedDash}`}
                strokeDashoffset={-(adjustedOffset - CIRCUMFERENCE / 4)}
                filter={isHovered ? `url(#glow-${i})` : undefined}
                initial={{ strokeDasharray: `0 ${CIRCUMFERENCE}` }}
                animate={{ strokeDasharray: `${adjustedDash} ${CIRCUMFERENCE - adjustedDash}` }}
                transition={{ duration: 0.8, delay: i * 0.1, ease: "easeOut" }}
                style={{ cursor: "pointer", transition: "stroke-width 0.15s ease, filter 0.15s ease" }}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
              />
            );
          })}
        </svg>

        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <motion.span
            key={centerValue}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
            className="text-2xl font-bold text-foreground leading-none"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {centerValue}
          </motion.span>
          {centerPct !== null && (
            <span className="text-xs text-muted-foreground mt-0.5">{centerPct}%</span>
          )}
          <span className="text-[10px] text-muted-foreground mt-0.5 text-center max-w-[80px] leading-tight">
            {centerLabel}
          </span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-col gap-2.5 min-w-0">
        {segments.map((seg, i) => {
          const pct = total > 0 ? Math.round((seg.value / total) * 100) : 0;
          const isHovered = hoveredIndex === i;

          return (
            <div
              key={i}
              className={cn(
                "flex items-center gap-2.5 cursor-pointer rounded-md px-1.5 py-1 -mx-1.5 transition-colors",
                isHovered ? "bg-muted" : "hover:bg-muted/60"
              )}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <span
                className="shrink-0 w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: seg.color }}
              />
              <span className="text-xs text-muted-foreground truncate flex-1">{seg.label}</span>
              <span className="text-xs font-semibold text-foreground tabular-nums">{seg.value}</span>
              <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
