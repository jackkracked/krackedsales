"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type ModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  /**
   * Accessible name for the dialog (required for screen readers).
   * Rendered visually-hidden — render your own visible heading inside `children`.
   */
  label: string;
  /** Extra classes on the panel (e.g. height, padding). */
  className?: string;
  /** max-width utility for the panel. Default `max-w-md`. */
  size?: string;
  /** Show a built-in top-right close button. */
  showClose?: boolean;
};

/**
 * Shared modal shell built on Radix Dialog. Provides focus trap, Escape-to-close,
 * scroll lock, focus restoration, `aria-modal`, and a portal — the accessibility
 * the hand-rolled overlays were missing — while keeping the app's visual style
 * (tokenized `bg-overlay` backdrop, `bg-card` panel, house animations).
 *
 * Consumers render their own header/body/footer inside `children`, exactly as the
 * previous bespoke modals did, so migration is a wrapper swap, not a rewrite.
 */
export function Modal({
  open,
  onOpenChange,
  children,
  label,
  className,
  size = "max-w-md",
  showClose = false,
}: ModalProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-overlay backdrop-blur-sm animate-fade-in" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed left-1/2 top-1/2 z-[100] -translate-x-1/2 -translate-y-1/2",
            "w-[calc(100%-2rem)] bg-card rounded-[12px] border border-border shadow-2xl outline-none animate-scale-in",
            size,
            className,
          )}
        >
          <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
          {showClose && (
            <DialogPrimitive.Close
              aria-label="Close"
              className="absolute right-4 top-4 z-10 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="w-4 h-4" />
            </DialogPrimitive.Close>
          )}
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
