"use client";

import { useState } from "react";
import { X, Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { DialerCampaign } from "./mock-data";

// Preview rep roster (real team list comes from /api/settings/team in the build).
const TEAM = [
  { name: "Gage Flasher", initials: "GF" },
  { name: "Alice Monroe", initials: "AM" },
];

const INPUT =
  "w-full rounded-[8px] border border-border bg-input px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-ring/60 focus:outline-none focus:ring-2 focus:ring-ring/20";

/** New-campaign builder. Admins assign any reps; a rep's campaign is locked to
 *  themselves (the assignee field is disabled and defaulted to them). Preview
 *  creates a real local campaign (empty queue — add contacts from Contacts/Pipeline). */
export function CampaignBuilder({
  isAdmin,
  currentUser,
  onClose,
  onCreate,
}: {
  isAdmin: boolean;
  currentUser: { name: string; initials: string };
  onClose: () => void;
  onCreate: (c: DialerCampaign) => void;
}) {
  const [name, setName] = useState("");
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [reps, setReps] = useState<string[]>(isAdmin ? [] : [currentUser.initials]);
  const canSave = name.trim().length > 0 && (isAdmin ? reps.length > 0 : true);

  function toggleRep(initials: string) {
    if (!isAdmin) return;
    setReps((r) => (r.includes(initials) ? r.filter((x) => x !== initials) : [...r, initials]));
  }

  function create() {
    const assigned = isAdmin ? TEAM.filter((t) => reps.includes(t.initials)) : [currentUser];
    onCreate({
      id: `camp_new_${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 24)}_${name.length}`,
      name: name.trim(),
      reps: assigned.length ? assigned : [currentUser],
      maxAttempts,
      reached: 0,
      exhausted: 0,
      contacts: [],
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "var(--overlay)" }}>
      <div
        data-r10n-card
        className="w-full max-w-md overflow-hidden rounded-[16px] border border-border bg-card shadow-[0_24px_60px_-20px_rgba(28,35,51,0.4)] motion-safe:animate-[dialerFade_180ms_ease-out]"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-[15px] font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>New Power Dialer campaign</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Campaign name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q3 Cold Outbound" className={INPUT} autoFocus />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Max attempts per contact</label>
            <div className="inline-flex rounded-[9px] border border-border bg-muted/40 p-0.5">
              {[3, 5, 7].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMaxAttempts(n)}
                  className={cn(
                    "rounded-[7px] px-4 py-1.5 text-[13px] font-semibold tabular-nums transition-all",
                    maxAttempts === n ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Assigned reps {!isAdmin && <span className="ml-1 font-normal normal-case text-muted-foreground/70">— locked to you</span>}
            </label>
            <div className="flex flex-wrap gap-2">
              {(isAdmin ? TEAM : [currentUser]).map((t) => {
                const on = reps.includes(t.initials);
                return (
                  <button
                    key={t.initials}
                    type="button"
                    disabled={!isAdmin}
                    onClick={() => toggleRep(t.initials)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-all",
                      on ? "border-info/40 bg-info/10 text-info" : "border-border bg-card text-muted-foreground hover:border-border/80",
                      !isAdmin && "cursor-default opacity-90",
                    )}
                  >
                    <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-foreground/10 text-[8px] font-bold">{t.initials}</span>
                    {t.name}
                    {on && <Check className="h-3.5 w-3.5" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">
          <button onClick={onClose} className="rounded-[10px] px-4 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground">Cancel</button>
          <button
            disabled={!canSave}
            onClick={create}
            className="rounded-[10px] bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-35"
          >
            Create campaign
          </button>
        </div>
      </div>
    </div>
  );
}
