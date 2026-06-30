"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, PhoneCall, Check, Plus, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils/cn";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DialerContactInput {
  contactId: string;
  contactName?: string | null;
  phone?: string | null;
}

interface DialerCampaignRow {
  id: string;
  name: string;
  maxAttempts: number;
  reps: { userId: string; name: string }[];
  counts: { queued: number; total: number; completed: number; exhausted: number; inProgress: number; suppressed: number };
}

const INPUT =
  "w-full rounded-[8px] border border-border bg-input px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-ring/60 focus:outline-none focus:ring-2 focus:ring-ring/20";

const NEW_ROW = "__new__";

// ─── Public component ───────────────────────────────────────────────────────

/**
 * Reusable "Add to Power Dialer" trigger. Wrap any clickable node — the wrapper
 * opens a fixed overlay modal (never an absolute dropdown, which would clip in
 * the bulk-action bars). Pick or create a campaign, then queue the contacts.
 */
export function AddToDialer({
  contacts,
  trigger,
  onDone,
}: {
  contacts: DialerContactInput[];
  trigger: React.ReactNode;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <span onClick={() => setOpen(true)} className="contents">
        {trigger}
      </span>
      {open && (
        <AddToDialerModal
          contacts={contacts}
          onClose={() => setOpen(false)}
          onDone={onDone}
        />
      )}
    </>
  );
}

// ─── Modal ──────────────────────────────────────────────────────────────────

function AddToDialerModal({
  contacts,
  onClose,
  onDone,
}: {
  contacts: DialerContactInput[];
  onClose: () => void;
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newMaxAttempts, setNewMaxAttempts] = useState<3 | 5 | 7>(3);
  const [result, setResult] = useState<{ added: number; submitted: number } | null>(null);

  // Only contacts WITH a phone number can be dialed. Filter them out (and tell the
  // user how many were skipped) instead of silently queueing un-dialable rows.
  const dialable = contacts.filter((c) => typeof c.phone === "string" && c.phone.trim() !== "");
  const skipped = contacts.length - dialable.length;
  const count = dialable.length;

  const { data, isLoading } = useQuery<{ campaigns: DialerCampaignRow[] }>({
    queryKey: ["dialer-campaigns"],
    queryFn: () => fetch("/api/dialer/campaigns").then((r) => r.json()),
    staleTime: 30_000,
  });
  const campaigns = data?.campaigns ?? [];

  const isNew = selectedId === NEW_ROW;
  const canCreate = newName.trim().length > 0;

  // Create a campaign, then select it so "Add to campaign" targets it next.
  const createMutation = useMutation<{ campaign: { id: string; name: string } }, Error>({
    mutationFn: () =>
      fetch("/api/dialer/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), maxAttempts: newMaxAttempts, repUserIds: [] }),
      }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed to create campaign");
        return r.json();
      }),
    onSuccess: ({ campaign }) => {
      queryClient.invalidateQueries({ queryKey: ["dialer-campaigns"] });
      setSelectedId(campaign.id);
      setNewName("");
    },
  });

  // Queue the contacts onto the chosen campaign.
  const addMutation = useMutation<{ added: number; submitted: number }, Error, string>({
    mutationFn: (campaignId) =>
      fetch(`/api/dialer/campaigns/${campaignId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacts: dialable }),
      }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed to add contacts");
        return r.json();
      }),
    onSuccess: (res) => {
      setResult(res);
      queryClient.invalidateQueries({ queryKey: ["dialer-campaigns"] });
      onDone?.();
      setTimeout(onClose, 1400);
    },
  });

  function handlePrimary() {
    if (isNew) {
      if (!canCreate || createMutation.isPending) return;
      createMutation.mutate();
      return;
    }
    if (selectedId) addMutation.mutate(selectedId);
  }

  // After a campaign is created, the chosen target is a real id (not NEW_ROW),
  // so the primary becomes "Add to campaign".
  const primaryLabel = isNew ? "Create campaign" : "Add to campaign";
  const primaryDisabled = isNew ? !canCreate : (!selectedId || dialable.length === 0);
  const primaryBusy = createMutation.isPending || addMutation.isPending;
  const errorMsg = createMutation.error?.message ?? addMutation.error?.message ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "var(--overlay)" }}>
      <div
        data-r10n-card
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-[16px] border border-border bg-card shadow-[0_24px_60px_-20px_rgba(28,35,51,0.4)] motion-safe:animate-[dialerFade_180ms_ease-out]"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-info/10 text-info">
              <PhoneCall className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-[15px] font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                Add {count} {count === 1 ? "contact" : "contacts"} to Power Dialer
              </h2>
              <p className="text-[11.5px] text-muted-foreground">Pick a campaign or start a new one</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-5 py-4">
          {result ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                <Check className="h-5 w-5" />
              </span>
              <p className="text-[14px] font-semibold text-foreground">
                Added {result.added} of {result.submitted}
              </p>
              {result.added < result.submitted && (
                <p className="text-[12px] text-muted-foreground">The rest were already queued in this campaign.</p>
              )}
            </div>
          ) : (
            <>
              {skipped > 0 && (
                <div className="mb-2 rounded-[9px] border border-warning/30 bg-warning-subtle px-3 py-2 text-[11.5px] font-medium leading-snug text-warning">
                  {skipped} of {contacts.length} selected {skipped === 1 ? "contact has" : "contacts have"} no phone number
                  {dialable.length === 0 ? " — there's nothing to add." : " and won't be added."}
                </div>
              )}
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-[52px] animate-pulse rounded-[10px] bg-muted/50" />
                ))
              ) : (
                campaigns.map((c) => {
                  const on = selectedId === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-[10px] border px-3.5 py-2.5 text-left transition-all",
                        on ? "border-info/40 bg-info/10" : "border-border bg-card hover:border-border/80 hover:bg-muted/30",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold text-foreground">{c.name}</p>
                        <p className="text-[11.5px] tabular-nums text-muted-foreground">{c.counts.queued} queued</p>
                      </div>
                      {on && (
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-info text-info-foreground">
                          <Check className="h-3 w-3" />
                        </span>
                      )}
                    </button>
                  );
                })
              )}

              {/* New-campaign row */}
              {isNew ? (
                <div className="space-y-3 rounded-[10px] border border-info/40 bg-info/[0.06] p-3.5">
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Campaign name</label>
                    <input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && canCreate) handlePrimary(); }}
                      placeholder="e.g. Q3 Cold Outbound"
                      className={INPUT}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Max attempts per contact</label>
                    <div className="inline-flex rounded-[9px] border border-border bg-muted/40 p-0.5">
                      {([3, 5, 7] as const).map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setNewMaxAttempts(n)}
                          className={cn(
                            "rounded-[7px] px-4 py-1.5 text-[13px] font-semibold tabular-nums transition-all",
                            newMaxAttempts === n ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setSelectedId(null); setNewName(""); }}
                    className="text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Cancel new campaign
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setSelectedId(NEW_ROW)}
                  className="flex w-full items-center gap-2 rounded-[10px] border border-dashed border-border px-3.5 py-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:border-info/40 hover:text-info"
                >
                  <Plus className="h-3.5 w-3.5" /> New campaign
                </button>
              )}

              {errorMsg && <p className="pt-1 text-[12px] font-medium text-rose-500">{errorMsg}</p>}
            </>
          )}
        </div>

        {/* Footer */}
        {!result && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">
            <button onClick={onClose} className="rounded-[10px] px-4 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground">
              Cancel
            </button>
            <button
              disabled={primaryDisabled || primaryBusy}
              onClick={handlePrimary}
              className="flex items-center gap-1.5 rounded-[10px] bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-35"
            >
              {primaryBusy && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
              {primaryLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
