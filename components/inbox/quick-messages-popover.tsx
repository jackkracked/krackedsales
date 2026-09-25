"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { Zap, Plus, Loader2, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useQuickMessages, useCreateQuickMessage, topQuickMessages } from "@/lib/hooks/use-quick-messages";

const EASE = [0.23, 1, 0.32, 1] as const;

/** Composer button → popover of the top active quick messages. Click one to insert it into the
 *  draft; "New quick message" opens a tiny inline composer to add one on the spot. */
export function QuickMessagesPopover({ onInsert }: { onInsert: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data, isLoading } = useQuickMessages();
  const items = topQuickMessages(data?.quickMessages);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setAdding(false);
  }

  function pick(text: string) {
    onInsert(text);
    close();
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        data-r10n-composer-tool
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Quick messages"
        className={cn(
          "flex items-center justify-center h-8 w-8 rounded-[9px] border border-border text-muted-foreground transition-all active:scale-95",
          "hover:border-primary/40 hover:text-primary hover:bg-primary/[0.04]",
          open && "border-primary/50 text-primary bg-primary/[0.05]",
        )}
      >
        <Zap className="w-4 h-4" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            initial={{ opacity: 0, scale: 0.96, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 6 }}
            transition={{ duration: 0.15, ease: EASE }}
            style={{ transformOrigin: "bottom left" }}
            className="absolute bottom-[calc(100%+8px)] left-0 z-50 w-[300px] rounded-[14px] border border-border bg-card p-1.5 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.3)]"
          >
            {!adding ? (
              <>
                <div className="flex items-center justify-between px-2 py-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Quick messages</span>
                  <Link
                    href="/settings?tab=quick-messages"
                    onClick={close}
                    title="Manage quick messages"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                  </Link>
                </div>

                <div className="max-h-[280px] overflow-y-auto">
                  {isLoading ? (
                    <div className="flex items-center justify-center py-6 text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                    </div>
                  ) : items.length === 0 ? (
                    <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                      No quick messages yet. Add your first one.
                    </p>
                  ) : (
                    items.map((q) => (
                      <button
                        key={q.id}
                        onClick={() => pick(q.body)}
                        className="flex w-full flex-col items-start gap-0.5 rounded-[9px] px-2.5 py-2 text-left hover:bg-muted transition-colors"
                      >
                        {q.title && <span className="text-sm font-medium text-foreground leading-tight">{q.title}</span>}
                        <span className={cn("text-xs text-muted-foreground leading-snug line-clamp-2", !q.title && "text-foreground")}>
                          {q.body}
                        </span>
                      </button>
                    ))
                  )}
                </div>

                <div className="mt-1 border-t border-border pt-1">
                  <button
                    onClick={() => setAdding(true)}
                    data-r10n-quickmsg-add
                    className="flex w-full items-center gap-2 rounded-[9px] px-2.5 py-2 text-sm font-medium text-primary hover:bg-primary/[0.06] transition-colors"
                  >
                    <Plus className="w-4 h-4" /> New quick message
                  </button>
                </div>
              </>
            ) : (
              <AddQuickMessageInline onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AddQuickMessageInline({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const create = useCreateQuickMessage();
  const canSave = body.trim().length > 0 && !create.isPending;

  function save() {
    if (!canSave) return;
    create.mutate(
      { title: title.trim() || undefined, body: body.trim() },
      { onSuccess: onDone },
    );
  }

  return (
    <div className="p-1.5">
      <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">New quick message</p>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Label (optional)"
        data-r10n-composer-input
        className="mb-1.5 w-full rounded-[8px] border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15 transition-all"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
        }}
        autoFocus
        rows={3}
        placeholder="Type the message…"
        data-r10n-composer-input
        className="w-full resize-none rounded-[8px] border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15 transition-all leading-relaxed"
      />
      {create.isError && <p className="mt-1 text-xs text-destructive px-1">Couldn&apos;t save. Try again.</p>}
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={save}
          disabled={!canSave}
          data-r10n-quickmsg-save
          className="flex-1 flex items-center justify-center gap-1.5 rounded-[8px] bg-primary py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.97]"
        >
          {create.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save"}
        </button>
        <button
          onClick={onCancel}
          className="flex-1 rounded-[8px] border border-border py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors active:scale-[0.97]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
