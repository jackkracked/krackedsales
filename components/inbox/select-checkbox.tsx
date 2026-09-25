"use client";

import { cn } from "@/lib/utils/cn";
import { Check, Minus } from "lucide-react";

interface SelectCheckboxProps {
  checked: boolean;
  /** Master checkbox partial state (some but not all selected). */
  indeterminate?: boolean;
  onChange: (next: boolean, e: React.MouseEvent) => void;
  size?: number;
  className?: string;
  "aria-label"?: string;
}

/**
 * A small, tactile selection checkbox. Brand-blue when active, soft border when idle, with a
 * spring-free scale/opacity pop on the tick (fast, ease-out) so multi-select feels instant.
 */
export function SelectCheckbox({
  checked,
  indeterminate = false,
  onChange,
  size = 20,
  className,
  "aria-label": ariaLabel,
}: SelectCheckboxProps) {
  const on = checked || indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      data-r10n-checkbox
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked, e);
      }}
      style={{ width: size, height: size }}
      className={cn(
        "relative flex items-center justify-center rounded-[6px] border transition-all duration-150 ease-out outline-none active:scale-90",
        on
          ? "bg-primary border-primary text-primary-foreground shadow-sm"
          : "border-foreground/25 bg-background hover:border-primary/60 hover:bg-primary/[0.04]",
        "focus-visible:ring-2 focus-visible:ring-primary/30",
        className,
      )}
    >
      <span
        className={cn(
          "transition-all duration-150 ease-out",
          on ? "opacity-100 scale-100" : "opacity-0 scale-50",
        )}
      >
        {indeterminate ? (
          <Minus className="w-3 h-3" strokeWidth={3.5} />
        ) : (
          <Check className="w-3 h-3" strokeWidth={3.5} />
        )}
      </span>
    </button>
  );
}
