"use client";

import { useState } from "react";
import { Globe, Mail, Phone, Check, Loader2, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { relativeTime } from "@/lib/utils/date";
import { MessageBody } from "@/components/shared/message-body";
import {
  extractContactData,
  scanThread,
  filterAlreadyOnFile,
  type ExistingContactData,
} from "@/lib/utils/extract-contact-data";

// ── Attach target + save ────────────────────────────────────────────────────────
// Where a detected field gets saved. GHL-backed convos PATCH the GHL contact; Meta convos
// POST /api/comment-leads/attach (writes the social_leads row, never promoting to GHL).
export type AttachTarget =
  | { kind: "ghl"; contactId: string }
  | {
      kind: "social";
      commentLeadId?: string;
      platform?: string;
      participantId?: string;
      name?: string;
    };

async function attachField(
  target: AttachTarget,
  field: "email" | "phone" | "website",
  value: string
): Promise<void> {
  const res =
    target.kind === "ghl"
      ? await fetch(`/api/ghl/contacts/${target.contactId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: value }),
        })
      : await fetch(`/api/comment-leads/attach`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            field,
            value,
            commentLeadId: target.commentLeadId,
            platform: target.platform,
            participantId: target.participantId,
            name: target.name,
          }),
        });
  if (!res.ok) throw new Error("Failed");
}

/** Back-compat: resolve a bare contactId prop into a GHL target. */
function resolveTarget(target?: AttachTarget, contactId?: string): AttachTarget | null {
  if (target) return target;
  if (contactId) return { kind: "ghl", contactId };
  return null;
}

// ── Enrichment chip ───────────────────────────────────────────────────────────

type ChipState = "idle" | "loading" | "done" | "error";

interface EnrichChipProps {
  type: "url" | "email" | "phone";
  value: string;
  target: AttachTarget;
  onSaved?: (field: string, value: string) => void;
}

export function EnrichChip({ type, value, target, onSaved }: EnrichChipProps) {
  const [state, setState] = useState<ChipState>("idle");

  const fieldKey: "website" | "email" | "phone" = type === "url" ? "website" : type;
  const Icon = type === "url" ? Globe : type === "email" ? Mail : Phone;

  async function save() {
    if (state !== "idle") return;
    setState("loading");
    try {
      await attachField(target, fieldKey, value);
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
      data-r10n-enrichchip
      data-state={state}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold",
        "transition-all duration-200 border max-w-full select-none",
        state === "done"
          ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-600 cursor-default"
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
        <Icon data-r10n-enrichchip-icon className="w-3 h-3 shrink-0" />
      )}
      <span className="truncate max-w-[180px]">
        {state === "done" ? "Saved" : state === "error" ? "Failed — retry" : value}
      </span>
      {state === "idle" && (
        <span data-r10n-enrichchip-plus className="shrink-0 flex items-center gap-0.5 text-blue-400 opacity-70">
          <Plus className="w-2.5 h-2.5" />
        </span>
      )}
    </button>
  );
}

// ── Smart banner ──────────────────────────────────────────────────────────────

interface SmartBannerProps {
  messages: Array<{ body?: string | null; direction?: string }>;
  /** Where to save. Provide this OR contactId (back-compat → GHL contact). */
  target?: AttachTarget;
  contactId?: string;
  /** Values already on file — detected items matching these are hidden (only show new data). */
  existing?: ExistingContactData | null;
  onFieldSaved?: (field: string, value: string) => void;
  /** Fields already saved externally (e.g. via enrichment chips on bubbles) */
  externalSavedKeys?: Set<string>;
}

export function SmartBanner({
  messages,
  target,
  contactId,
  existing,
  onFieldSaved,
  externalSavedKeys,
}: SmartBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [addingAll, setAddingAll] = useState(false);
  const [allDone, setAllDone] = useState(false);
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());

  const resolved = resolveTarget(target, contactId);

  // Merge local saves with external saves (from EnrichChips on bubbles)
  const allSavedKeys = new Set([...savedKeys, ...(externalSavedKeys ?? [])]);

  // Only surface data we don't already have on file (D3).
  const found = filterAlreadyOnFile(scanThread(messages), existing);
  const allItems: Array<[string, string]> = [
    ...found.urls.map((v) => ["website", v] as [string, string]),
    ...found.emails.map((v) => ["email", v] as [string, string]),
    ...found.phones.map((v) => ["phone", v] as [string, string]),
  ];
  const totalFound = allItems.length;
  const unsavedItems = allItems.filter(([key, val]) => !allSavedKeys.has(`${key}:${val}`));

  if (!resolved || totalFound === 0 || dismissed) return null;
  // Auto-dismiss when all items have been saved individually
  if (!allDone && unsavedItems.length === 0 && allSavedKeys.size > 0) return null;

  async function addAll() {
    if (addingAll || allDone || !resolved) return;
    setAddingAll(true);
    await Promise.allSettled(
      unsavedItems.map(([key, value]) =>
        attachField(resolved, key as "email" | "phone" | "website", value)
          .then(() => {
            setSavedKeys((prev) => new Set([...prev, `${key}:${value}`]));
            onFieldSaved?.(key, value);
          })
          .catch(() => {})
      )
    );
    setAddingAll(false);
    setAllDone(true);
    setTimeout(() => setDismissed(true), 2500);
  }

  return (
    <div
      data-r10n-smartbanner
      data-done={allDone}
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
            data-r10n-smartbanner-label
            data-done={allDone}
            className={cn(
              "text-[10.5px] font-bold uppercase tracking-widest",
              unsavedItems.length > 0 ? "mb-2" : "",
              allDone
                ? "text-emerald-600"
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
                    data-r10n-smartbanner-item
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
              data-r10n-smartbanner-addall
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
            data-r10n-smartbanner-dismiss
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
  /** Save target for enrichment chips. Provide this OR contactId (back-compat → GHL). */
  target?: AttachTarget;
  /** GHL contact ID — back-compat; if provided, enrichment chips appear on inbound messages */
  contactId?: string;
  /** Values already on file — detected items matching these are hidden. */
  existing?: ExistingContactData | null;
  /** Called when a field is successfully saved to the contact */
  onFieldSaved?: (field: string, value: string) => void;
}

export function ChatBubble({
  body,
  direction,
  dateAdded,
  isGroupedWithPrev = false,
  isGroupedWithNext = false,
  target,
  contactId,
  existing,
  onFieldSaved,
}: ChatBubbleProps) {
  const isOut = direction === "outbound";

  // Only show timestamp on the last bubble in a consecutive group
  const showTimestamp = !isGroupedWithNext;

  // Speech-tail corner: flat on the side the bubble faces, only on last in group
  const showTail = !isGroupedWithNext;

  const resolved = resolveTarget(target, contactId);

  // Inbound messages only: detect enrichable data we don't already have on file
  const detected =
    !isOut && resolved ? filterAlreadyOnFile(extractContactData(body), existing) : null;
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
            : "bg-white border border-border/70 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-foreground",
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
            <EnrichChip key={v} type="url" value={v} target={resolved!} onSaved={onFieldSaved} />
          ))}
          {detected!.emails.map((v) => (
            <EnrichChip key={v} type="email" value={v} target={resolved!} onSaved={onFieldSaved} />
          ))}
          {detected!.phones.map((v) => (
            <EnrichChip key={v} type="phone" value={v} target={resolved!} onSaved={onFieldSaved} />
          ))}
        </div>
      )}
    </div>
  );
}
