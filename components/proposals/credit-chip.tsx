"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, Loader2, UserX } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils/cn";

/**
 * Who is credited on a deal, shown where the deal is and changed where it is shown.
 *
 * Jack, 2026-09-29: "we'd need to see it without clicking inside anything ... just being able to
 * change it. On the row or click inside it and change it straight away."
 *
 * A SUGGESTION LOOKS UNFINISHED ON PURPOSE: a dashed ring round the avatar. Nobody has to read a
 * label to know an admin has not signed it off; confirmed credit is a plain, solid chip.
 */

export interface TeamMember { id: string; name: string; role: string; isActive: boolean }

export interface ProposalCredit {
  closer: { userId: string | null; suggested: boolean; reason: string; confirmedBy: string | null; confirmedAt: string | null };
  setter: {
    mode: "assigned" | "none" | "suggested";
    userIds: string[];
    state: "credited" | "suggested" | "clash" | null;
    bookedAt: string | null;
    confirmedBy: string | null;
    confirmedAt: string | null;
  };
}

const CLOSER_ROLES = ["closer", "admin", "rep"];
const SETTER_ROLES = ["setter"];

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }) : "";
const first = (name: string) => name.split(" ")[0];

/** Plain-English "why this person", shown in the tooltip and at the top of the picker. */
function whyLine(field: "closer" | "setter", credit: ProposalCredit, nameOf: (id: string) => string): string {
  if (field === "closer") {
    const c = credit.closer;
    if (c.suggested) return "Suggested: created the proposal";
    return `Set by ${c.confirmedBy ? nameOf(c.confirmedBy) : "an admin"}${c.confirmedAt ? ` · ${shortDate(c.confirmedAt)}` : ""}`;
  }
  const s = credit.setter;
  if (s.mode === "none") return `No setter · set by ${s.confirmedBy ? nameOf(s.confirmedBy) : "an admin"}`;
  if (s.mode === "assigned") return `Set by ${s.confirmedBy ? nameOf(s.confirmedBy) : "an admin"}${s.confirmedAt ? ` · ${shortDate(s.confirmedAt)}` : ""}`;
  if (s.state === "clash") return `Two setters claim this booking: ${s.userIds.map(nameOf).join(" and ")}`;
  if (s.userIds.length === 0) return "Suggested: no booking found";
  const booked = s.bookedAt ? ` ${shortDate(s.bookedAt)}` : "";
  return s.state === "credited" ? `Suggested: booked the call${booked}` : `Suggested: their lead, booking not yet confirmed${booked}`;
}

export function isSuggested(field: "closer" | "setter", credit: ProposalCredit): boolean {
  return field === "closer" ? credit.closer.suggested : credit.setter.mode === "suggested";
}

export function CreditChip({
  proposalId, clientName, field, credit, team, isAdmin, paidAt, compact = false,
}: {
  proposalId: string;
  clientName: string;
  field: "closer" | "setter";
  credit: ProposalCredit | null;
  team: TeamMember[];
  isAdmin: boolean;
  /** When the deal was paid: changing credit on an older month shows as an adjustment. */
  paidAt: string | null;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const nameOf = (id: string) => team.find((t) => t.id === id)?.name ?? "Someone";

  if (!credit) return <span className="text-xs text-muted-foreground" title="Credit could not be worked out">—</span>;

  const suggested = isSuggested(field, credit);
  const ids = field === "closer" ? (credit.closer.userId ? [credit.closer.userId] : []) : credit.setter.userIds;
  const isNone = field === "setter" && (credit.setter.mode === "none" || (credit.setter.mode === "suggested" && ids.length === 0));
  const clash = field === "setter" && credit.setter.state === "clash";
  const why = whyLine(field, credit, nameOf);
  const allowed = field === "closer" ? CLOSER_ROLES : SETTER_ROLES;
  const people = team.filter((t) => t.isActive && allowed.includes(t.role)).sort((a, b) => a.name.localeCompare(b.name));
  const inactive = ids.some((id) => team.find((t) => t.id === id)?.isActive === false);

  const paidMonthOld = (() => {
    if (!paidAt) return null;
    const m = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit" }).format(d);
    const pm = m(new Date(paidAt));
    return pm < m(new Date()) ? new Date(paidAt).toLocaleDateString("en-US", { month: "long", timeZone: "America/New_York" }) : null;
  })();

  async function save(change: Record<string, unknown>, key: string) {
    setSaving(key);
    try {
      const item = field === "closer"
        ? { proposalId, expectedCloser: credit!.closer.userId }
        : { proposalId, expectedSetter: { mode: credit!.setter.mode, userIds: credit!.setter.userIds } };
      const res = await fetch("/api/proposals/credit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [item], change: { field, ...change } }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not save");
      const r = json.results?.[0];
      if (r && !r.ok) throw new Error(r.reason ?? "Not saved");
      setOpen(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["proposals"] }),
        qc.invalidateQueries({ queryKey: ["tracker"] }),
      ]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
      // Whatever changed underneath, show the truth again.
      qc.invalidateQueries({ queryKey: ["proposals"] });
    } finally {
      setSaving(null);
    }
  }

  const face = (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {isNone ? (
        <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground", compact ? "size-5" : "size-6")}>
          <UserX className="size-3" aria-hidden />
        </span>
      ) : clash ? (
        <span className="flex -space-x-1.5">
          {ids.slice(0, 2).map((id) => <Avatar key={id} name={nameOf(id)} size={compact ? 20 : 24} variant="rep" className="ring-2 ring-card" />)}
        </span>
      ) : (
        <span className={cn("shrink-0 rounded-full", suggested && "outline-dashed outline-1 outline-offset-[1.5px] outline-muted-foreground/60")}>
          <Avatar name={nameOf(ids[0])} size={compact ? 20 : 24} variant="rep" className={cn(inactive && "opacity-50")} />
        </span>
      )}
      <span className={cn("truncate text-xs", suggested ? "text-muted-foreground" : "font-medium text-foreground", inactive && "line-through")}>
        {isNone ? "None" : clash ? "Clash" : first(nameOf(ids[0]))}
      </span>
    </span>
  );

  const label = `${field === "closer" ? "Closer" : "Setter"} for ${clientName}: ${isNone ? "none" : clash ? "two setters" : nameOf(ids[0])}. ${why}`;

  if (!isAdmin) {
    return <span className="inline-flex max-w-[120px]" title={why} aria-label={label}>{face}</span>;
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Change ${label}`}
          title={why}
          className="-mx-1 inline-flex max-w-[128px] items-center rounded-[6px] px-1 py-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 data-[state=open]:bg-muted"
        >
          {face}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onClick={(e) => e.stopPropagation()}
          className="z-[60] w-[260px] overflow-hidden rounded-[10px] border border-border bg-card shadow-[0_12px_32px_-12px_rgba(28,35,51,0.35)] outline-none animate-scale-in"
        >
          <div className="border-b border-border px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{field === "closer" ? "Closer" : "Setter"}</p>
            <p className="mt-0.5 truncate text-xs font-medium text-foreground">{clientName}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{why}</p>
          </div>

          {suggested && !clash && (
            <div className="border-b border-border p-1.5">
              <button
                type="button"
                disabled={!!saving}
                onClick={() => save({ action: "confirm" }, "confirm")}
                className="flex w-full items-center justify-between gap-2 rounded-[7px] bg-primary px-2.5 py-2 text-left text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                <span className="truncate">Confirm {isNone ? "no setter" : first(nameOf(ids[0]))}</span>
                {saving === "confirm" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
              </button>
            </div>
          )}

          <ul className="max-h-[240px] overflow-y-auto p-1.5" role="listbox" aria-label={`Choose the ${field}`}>
            {people.map((p) => {
              const current = !suggested && ids.length === 1 && ids[0] === p.id;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={current}
                    disabled={!!saving || current}
                    onClick={() => save({ action: "assign", userId: p.id }, p.id)}
                    className="flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <Avatar name={p.name} size={20} variant="rep" />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {saving === p.id ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden /> : current ? <Check className="size-3.5 text-foreground" aria-hidden /> : null}
                  </button>
                </li>
              );
            })}
            {field === "setter" && (
              <li className="mt-1 border-t border-border pt-1">
                <button
                  type="button"
                  role="option"
                  aria-selected={credit.setter.mode === "none"}
                  disabled={!!saving || credit.setter.mode === "none"}
                  onClick={() => save({ action: "none" }, "none")}
                  className="flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <span className="flex size-5 items-center justify-center rounded-full bg-muted text-muted-foreground"><UserX className="size-3" aria-hidden /></span>
                  <span className="flex-1">No setter <span className="text-muted-foreground">(inbound)</span></span>
                  {saving === "none" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : credit.setter.mode === "none" ? <Check className="size-3.5" aria-hidden /> : null}
                </button>
              </li>
            )}
          </ul>

          {paidMonthOld && (
            <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
              Paid in {paidMonthOld}. If that month&apos;s pay is closed, this shows as an adjustment in the next open month.
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
