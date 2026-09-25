"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils/cn";
import { ChevronDown, Mail, MailOpen, Star, StarOff, Trash2 } from "lucide-react";
import type { BulkConversationAction } from "@/lib/hooks/use-conversations";

interface BulkActionsMenuProps {
  count: number;
  onAction: (action: BulkConversationAction) => void;
  disabled?: boolean;
}

const ITEMS: Array<{ action: BulkConversationAction; label: string; icon: React.ElementType }> = [
  { action: "read", label: "Mark as read", icon: MailOpen },
  { action: "unread", label: "Mark as unread", icon: Mail },
  { action: "star", label: "Add star", icon: Star },
  { action: "unstar", label: "Remove star", icon: StarOff },
];

/** GHL-style bulk "Actions ▾" menu. Origin-aware scale-in, click-outside / Escape to dismiss, and
 *  an inline confirm step for the destructive Delete so a batch can never be wiped by a mis-click. */
export function BulkActionsMenu({ count, onAction, disabled }: BulkActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setConfirmDelete(false);
  }

  function run(action: BulkConversationAction) {
    onAction(action);
    close();
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        data-r10n-bulk-btn
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-[8px] text-xs font-semibold transition-all active:scale-[0.97]",
          "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed",
        )}
      >
        Actions
        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-150", open && "rotate-180")} />
      </button>

      <AnimatePresence>
      {open && (
        <motion.div
          role="menu"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
          style={{ transformOrigin: "top right" }}
          className="absolute right-0 top-[calc(100%+6px)] z-50 w-56 rounded-[12px] border border-border bg-card p-1.5 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.25)]"
        >
          {!confirmDelete ? (
            <>
              {ITEMS.map(({ action, label, icon: Icon }) => (
                <button
                  key={action}
                  role="menuitem"
                  onClick={() => run(action)}
                  className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-sm text-foreground hover:bg-muted transition-colors text-left"
                >
                  <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                  {label}
                </button>
              ))}
              <div className="my-1 h-px bg-border" />
              <button
                role="menuitem"
                onClick={() => setConfirmDelete(true)}
                className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-sm text-destructive hover:bg-destructive/[0.08] transition-colors text-left"
              >
                <Trash2 className="w-4 h-4 shrink-0" />
                Delete conversation{count === 1 ? "" : "s"}
              </button>
            </>
          ) : (
            <div className="px-2 py-1.5">
              <p className="text-sm font-semibold text-foreground mb-0.5">Delete {count} conversation{count === 1 ? "" : "s"}?</p>
              <p className="text-xs text-muted-foreground mb-3 leading-snug">
                They&apos;ll be removed from your inbox. A conversation returns if the contact messages again.
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => run("delete")}
                  className="flex-1 py-1.5 rounded-[8px] bg-destructive text-white text-xs font-semibold hover:bg-destructive/90 transition-colors active:scale-[0.97]"
                >
                  Delete
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 py-1.5 rounded-[8px] border border-border text-foreground text-xs font-semibold hover:bg-muted transition-colors active:scale-[0.97]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}
