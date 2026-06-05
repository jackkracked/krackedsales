"use client";

import { Modal } from "./modal";
import { cn } from "@/lib/utils/cn";

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Visual tone of the confirm button. */
  tone?: "default" | "danger";
  onConfirm: () => void | Promise<void>;
  /** Disables both buttons and shows a working state on confirm. */
  loading?: boolean;
};

/**
 * Accessible confirmation dialog. Replaces native `window.confirm()` and the
 * various hand-rolled confirm modals with one consistent, focus-trapped primitive.
 *
 * NOTE: unlike `window.confirm` (synchronous/blocking), this is async — the
 * action to gate must live in `onConfirm`, not after the call site.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  onConfirm,
  loading = false,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} label={title} size="max-w-[380px]">
      <div className="p-6">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {description ? (
          <div className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{description}</div>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-foreground rounded-[8px] hover:bg-muted transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => onConfirm()}
            disabled={loading}
            className={cn(
              "px-4 py-2 text-sm font-medium rounded-[8px] transition-colors disabled:opacity-70",
              tone === "danger"
                ? "text-destructive-foreground bg-destructive hover:bg-destructive/90"
                : "text-primary-foreground bg-primary hover:bg-primary/90",
            )}
          >
            {loading ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
