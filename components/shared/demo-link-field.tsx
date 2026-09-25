"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, ExternalLink, Plus, Loader2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { relativeTime } from "@/lib/utils/date";
import type { DemoLink } from "@/app/api/contacts/[id]/demo-link/route";

/**
 * The Demo Link on a contact: GHL's "Insert Miro Link" custom field.
 *
 * Saving writes straight to GoHighLevel, which fires a GHL workflow. Two consequences shape
 * this component:
 *   1. A failed write must revert and say so. Showing a link GHL never received would mean a
 *      workflow that silently never ran, which nobody would notice.
 *   2. Replacing an existing link re-fires that workflow, so it asks first. A first-time save
 *      has nothing to re-trigger and goes straight through.
 *
 * Deliberately separate from `DemoLinksRow`, which shows the ClickUp-sourced board read-only.
 * A contact can legitimately show both.
 */

/** Strips the scheme and any trailing slash so the pill reads as a board, not a URL dump. */
function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

function isValidUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function DemoLinkField({
  contactId,
  className = "",
}: {
  contactId?: string | null;
  className?: string;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, isError } = useQuery<DemoLink>({
    queryKey: ["demo-link", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/${contactId}/demo-link`);
      // Without this, an error body ({ error: "Unauthorized" }) becomes a truthy `data` whose
      // .url is undefined, and the field renders "no demo link" as fact. Failing loudly keeps
      // the query in an error state instead of asserting something we never read.
      if (!res.ok) throw new Error("Could not read the demo link from GoHighLevel");
      return res.json();
    },
    enabled: !!contactId,
    staleTime: 60_000,
    // The provider sets `keepPreviousData` globally. Here that means switching to another
    // contact keeps showing the PREVIOUS contact's board until the new read lands, and editing
    // in that window seeds the wrong client's URL into the input. Identity is never carried
    // over between contacts.
    placeholderData: undefined,
  });

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const save = useMutation({
    mutationFn: async (next: string) => {
      const res = await fetch(`/api/ghl/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ demoLink: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Could not save to GoHighLevel");
      }
      return next;
    },
    onSuccess: () => {
      setEditing(false);
      setError(null);
      qc.invalidateQueries({ queryKey: ["demo-link", contactId] });
    },
    // No optimistic write: the field stays as it was until GHL confirms, so what is on screen
    // is always what GHL actually holds.
    onError: (e: Error) => setError(e.message),
  });

  if (!contactId) return null;

  const current = data?.url ?? null;
  const busy = save.isPending;

  const attemptSave = (next: string) => {
    setError(null);
    if (next && !isValidUrl(next)) {
      setError("Enter a full link starting with http:// or https://");
      return;
    }
    // If the READ failed we do not know whether a link already exists, so `current` is null for
    // the wrong reason. Saving here would skip the confirmation below and overwrite a link we
    // never saw, re-firing the GHL workflow that messages the client. Refuse instead of guess.
    if (isError) {
      setError("Can't read the current demo link, so this won't save. Refresh and try again.");
      return;
    }
    // Replacing or clearing an existing link re-fires the GHL workflow next time round.
    if (current && next !== current) {
      setPendingConfirm(next);
      return;
    }
    save.mutate(next);
  };

  const startEditing = () => {
    setValue(current ?? "");
    setError(null);
    setEditing(true);
  };

  return (
    <div className={className}>
      <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        Demo Link
      </div>

      {editing ? (
        <div className="mt-1.5">
          <div className="flex items-center gap-1.5">
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") attemptSave(value.trim());
                if (e.key === "Escape") { setEditing(false); setError(null); }
              }}
              placeholder="https://miro.com/app/board/…"
              disabled={busy}
              aria-label="Demo link URL"
              aria-invalid={!!error}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => attemptSave(value.trim())}
              disabled={busy}
              className="shrink-0 rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
            </button>
            <button
              type="button"
              onClick={() => { setEditing(false); setError(null); }}
              disabled={busy}
              className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
          {error ? (
            <p role="alert" className="mt-1 text-[11px] text-destructive">{error}</p>
          ) : current ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Clear the field to remove the link from GoHighLevel.
            </p>
          ) : null}
        </div>
      ) : current ? (
        <div className="mt-1.5">
          <a
            href={current}
            target="_blank"
            rel="noopener noreferrer"
            title={current}
            className="group inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted px-2 py-1 text-[11px] font-medium text-foreground/80 transition-colors hover:bg-border/60"
          >
            <Link2 className="h-3 w-3 shrink-0" />
            <span className="truncate">{displayUrl(current)}</span>
            <ExternalLink className="h-3 w-3 shrink-0 opacity-50 transition-opacity group-hover:opacity-100" />
          </a>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="truncate">
              {data?.setByName
                ? `Set by ${data.setByName}${data.setAt ? ` · ${relativeTime(data.setAt)}` : ""}`
                : "Set in GoHighLevel"}
            </span>
            <button
              type="button"
              onClick={startEditing}
              className="shrink-0 text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
            >
              Edit
            </button>
          </div>
        </div>
      ) : isError ? (
        // Not "Add link". We did not read GoHighLevel, so we do not know there is nothing there,
        // and offering to add one invites overwriting a link that may already exist.
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Couldn&apos;t read the demo link from GoHighLevel.
        </p>
      ) : (
        <button
          type="button"
          onClick={startEditing}
          className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
          Add link
        </button>
      )}

      <ConfirmDialog
        open={pendingConfirm !== null}
        onOpenChange={(o) => { if (!o) setPendingConfirm(null); }}
        title={pendingConfirm === "" ? "Remove this demo link?" : "Replace this demo link?"}
        description={
          pendingConfirm === ""
            ? "This clears the field in GoHighLevel too, so the two stay identical."
            : "Saving writes to GoHighLevel, which will re-trigger its workflow for this contact."
        }
        confirmLabel={pendingConfirm === "" ? "Remove" : "Replace"}
        onConfirm={() => {
          const next = pendingConfirm ?? "";
          setPendingConfirm(null);
          save.mutate(next);
        }}
      />
    </div>
  );
}
