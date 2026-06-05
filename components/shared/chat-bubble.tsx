"use client";

import { useState } from "react";
import { Globe, Mail, Phone, Check, Loader2, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { relativeTime } from "@/lib/utils/date";
import { MessageBody } from "@/components/shared/message-body";
import { extractContactData, scanThread } from "@/lib/utils/extract-contact-data";

// ── Enrichment chip ───────────────────────────────────────────────────────────

type ChipState = "idle" | "loading" | "done" | "error";

interface EnrichChipProps {
  type: "url" | "email" | "phone";
  value: string;
  contactId: string;
  onSaved?: (field: string, value: string) => void;
}

function EnrichChip({ type, value, contactId, onSaved }: EnrichChipProps) {
  const [state, setState] = useState<ChipState>("idle");

  const fieldKey = type === "url" ? "website" : type;
  const Icon = type === "url" ? Globe : type === "email" ? Mail : Phone;

  async function save() {
    if (state !== "idle") return;
    setState("loading");
    try {
      const res = await fetch(`/api/ghl/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [fieldKey]: value }),
      });
      if (!res.ok) throw new Error("Failed");
      setState("done");
      onSaved?.(fieldKey, value);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2000);
    }
  }

  return (
    <button
      onClick={save}
      disabled={state !== "idle"}
      title={state === "idle" ? `Save ${fieldKey} to contact` : undefined}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold",
        "transition-all duration-200 border max-w-full select-none",
        state === "done"
          ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 cursor-default"
          : state === "loading"
          ? "bg-primary/10 border-primary/20 text-primary/60 cursor-wait"
          : state === "error"
          ? "bg-destructive/10 border-destructive/30 text-destructive"
          : "bg-primary/10 border-primary/25 text-primary hover:bg-primary/15 cursor-pointer"
      )}
    >
      {state === "loading" ? (
        <Loader2 className="w-3 h-3 animate-spin shrink-0" />
      ) : state === "done" ? (
        <Check className="w-3 h-3 shrink-0" />
      ) : (
        <Icon className="w-3 h-3 shrink-0" />
      )}
      <span className="truncate max-w-[180px]">
        {state === "done" ? "Saved" : state === "error" ? "Failed — retry" : value}
      </span>
      {state === "idle" && (
        <span className="shrink-0 flex items-center gap-0.5 text-blue-400 dark:text-blue-500 opacity-70">
          <Plus className="w-2.5 h-2.5" />
        </span>
      )}
    </button>
  );
}

// ── Smart banner ──────────────────────────────────────────────────────────────

interface SmartBannerProps {
  messages: Array<{ body?: string | null; direction?: string }>;
  contactId: string;
  onFieldSaved?: (field: string, value: string) => void;
  /** Fields already saved externally (e.g. via enrichment chips on bubbles) */
  externalSavedKeys?: Set<string>;
}

export function SmartBanner({ messages, contactId, onFieldSaved, externalSavedKeys }: SmartBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [addingAll, setAddingAll] = useState(false);
  const [allDone, setAllDone] = useState(false);
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());

  // Merge local saves with external saves (from EnrichChips on bubbles)
  const allSavedKeys = new Set([...savedKeys, ...(externalSavedKeys ?? [])]);

  const found = scanThread(messages);
  const allItems: Array<[string, string]> = [
    ...found.urls.map((v) => ["website", v] as [string, string]),
    ...found.emails.map((v) => ["email", v] as [string, string]),
    ...found.phones.map((v) => ["phone", v] as [string, string]),
  ];
  const totalFound = allItems.length;
  const unsavedItems = allItems.filter(([key, val]) => !allSavedKeys.has(`${key}:${val}`));

  if (totalFound === 0 || dismissed) return null;
  // Auto-dismiss when all items have been saved individually
  if (!allDone && unsavedItems.length === 0 && allSavedKeys.size > 0) return null;

  function handleChipSaved(field: string, value: string) {
    setSavedKeys((prev) => new Set([...prev, `${field}:${value}`]));
    onFieldSaved?.(field, value);
  }

  async function addAll() {
    if (addingAll || allDone) return;
    setAddingAll(true);
    await Promise.allSettled(
      unsavedItems.map(([key, value]) =>
        fetch(`/api/ghl/contacts/${contactId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [key]: value }),
        }).then((r) => {
          if (r.ok) {
            setSavedKeys((prev) => new Set([...prev, `${key}:${value}`]));
            onFieldSaved?.(key, value);
          }
        })
      )
    );
    setAddingAll(false);
    setAllDone(true);
    setTimeout(() => setDismissed(true), 2500);
  }

  return (
    <div
      className={cn(
        "mx-0 mb-3 rounded-[12px] border px-4 py-3 shrink-0",
        allDone
          ? "bg-emerald-500/10 border-emerald-500/25"
          : "bg-primary/8 border-primary/20"
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              "text-[10.5px] font-bold uppercase tracking-widest",
              unsavedItems.length > 0 ? "mb-2" : "",
              allDone
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-primary"
            )}
          >
            {allDone
              ? "✓ Contact data saved"
              : `Contact data detected (${unsavedItems.length})`}
          </p>
          {!allDone && unsavedItems.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {unsavedItems.map(([key, v]) => {
                const Icon = key === "website" ? Globe : key === "email" ? Mail : Phone;
                return (
                  <span
                    key={`${key}:${v}`}
                    className="flex items-center gap-1 text-[11px] text-primary truncate max-w-[200px]"
                  >
                    <Icon className="w-3 h-3 shrink-0" />
                    {v}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        <div className="shrink-0 flex items-center gap-2">
          {!allDone && unsavedItems.length > 0 && (
            <button
              onClick={addAll}
              disabled={addingAll}
              className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              {addingAll ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Plus className="w-3 h-3" />
              )}
              Add all
            </button>
          )}
          <button
            onClick={() => setDismissed(true)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Message grouping ──────────────────────────────────────────────────────────

export interface GroupedMessage<T> {
  msg: T;
  /** Same sender as previous message AND within 3 minutes */
  isGroupedWithPrev: boolean;
  /** Same sender as next message AND within 3 minutes */
  isGroupedWithNext: boolean;
}

export function groupMessages<T extends { direction?: string; dateAdded?: string }>(
  messages: T[]
): GroupedMessage<T>[] {
  const WINDOW_MS = 3 * 60 * 1000;

  return messages.map((msg, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const t = new Date(msg.dateAdded ?? 0).getTime();

    const isGroupedWithPrev =
      !!prev &&
      prev.direction === msg.direction &&
      t - new Date(prev.dateAdded ?? 0).getTime() < WINDOW_MS;

    const isGroupedWithNext =
      !!next &&
      next.direction === msg.direction &&
      new Date(next.dateAdded ?? 0).getTime() - t < WINDOW_MS;

    return { msg, isGroupedWithPrev, isGroupedWithNext };
  });
}

// ── ChatBubble ────────────────────────────────────────────────────────────────

interface ChatBubbleProps {
  body: string;
  direction: "inbound" | "outbound";
  dateAdded?: string;
  /** Has the same sender immediately before it (within 3min) */
  isGroupedWithPrev?: boolean;
  /** Has the same sender immediately after it (within 3min) */
  isGroupedWithNext?: boolean;
  /** GHL contact ID — if provided, enrichment chips appear on inbound messages */
  contactId?: string;
  /** Called when a field is successfully saved to the contact */
  onFieldSaved?: (field: string, value: string) => void;
}

export function ChatBubble({
  body,
  direction,
  dateAdded,
  isGroupedWithPrev = false,
  isGroupedWithNext = false,
  contactId,
  onFieldSaved,
}: ChatBubbleProps) {
  const isOut = direction === "outbound";

  // Only show timestamp on the last bubble in a consecutive group
  const showTimestamp = !isGroupedWithNext;

  // Speech-tail corner: flat on the side the bubble faces, only on last in group
  const showTail = !isGroupedWithNext;

  // Inbound messages only: detect enrichable data
  const detected = !isOut && contactId ? extractContactData(body) : null;
  const hasChips =
    detected &&
    detected.urls.length + detected.emails.length + detected.phones.length > 0;

  return (
    <div
      className={cn(
        "flex flex-col",
        isOut ? "items-end" : "items-start",
        isGroupedWithPrev ? "mt-0.5" : "mt-2"
      )}
    >
      {/* Bubble */}
      <div
        className={cn(
          "max-w-[78%] px-3 py-2 text-sm leading-relaxed",
          isOut
            ? "bg-primary text-primary-foreground"
            : "bg-white dark:bg-card border border-border/70 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-foreground",
          // Directional speech-tail via border-radius
          isOut
            ? showTail
              ? "rounded-[12px] rounded-tr-[3px]"
              : "rounded-[12px]"
            : showTail
            ? "rounded-[12px] rounded-tl-[3px]"
            : "rounded-[12px]"
        )}
      >
        <MessageBody
          body={body}
          linkClassName={
            isOut ? "text-primary-foreground/80 underline" : "text-primary"
          }
        />
        {showTimestamp && dateAdded && (
          <p
            className={cn(
              "text-[10px] mt-1",
              isOut
                ? "text-primary-foreground/50 text-right"
                : "text-muted-foreground/60"
            )}
          >
            {relativeTime(dateAdded)}
          </p>
        )}
      </div>

      {/* Enrichment chips — inbound only, when data detected */}
      {hasChips && (
        <div className="flex flex-wrap gap-1.5 mt-1.5 max-w-[78%]">
          {detected!.urls.map((v) => (
            <EnrichChip key={v} type="url" value={v} contactId={contactId!} onSaved={onFieldSaved} />
          ))}
          {detected!.emails.map((v) => (
            <EnrichChip key={v} type="email" value={v} contactId={contactId!} onSaved={onFieldSaved} />
          ))}
          {detected!.phones.map((v) => (
            <EnrichChip key={v} type="phone" value={v} contactId={contactId!} onSaved={onFieldSaved} />
          ))}
        </div>
      )}
    </div>
  );
}
