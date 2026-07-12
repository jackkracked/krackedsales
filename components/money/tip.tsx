"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Plain-English metric tooltip. Radix portals the content out of the page's scroll container,
 * so it never clips. Dark bubble (bg-foreground) for guaranteed contrast on the light UI.
 * Use for the "what does this number mean?" affordance next to any metric a non-finance
 * reader might not know (CAC, LTV:CAC, contribution margin, payback, ...).
 */
export function Tip({ children, className, label = "What this means" }: { children: React.ReactNode; className?: string; label?: string }) {
  return (
    <TooltipPrimitive.Provider delayDuration={120} skipDelayDuration={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label={label}
            className={cn("inline-flex shrink-0 items-center justify-center align-middle text-muted-foreground/50 transition-colors hover:text-foreground focus:text-foreground focus:outline-none", className)}
          >
            <Info className="h-3 w-3" />
          </button>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            sideOffset={6}
            collisionPadding={12}
            className="z-[60] max-w-[280px] rounded-[8px] bg-foreground px-3 py-2 text-[12px] font-medium leading-relaxed text-background shadow-xl data-[state=delayed-open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95"
          >
            {children}
            <TooltipPrimitive.Arrow className="fill-foreground" width={11} height={5} />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
