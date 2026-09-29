"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  Archive, ArchiveRestore, BadgeCheck, Download, Loader2, Trash2, UserCheck, UserPlus, UserX, X, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Avatar } from "@/components/ui/avatar";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils/cn";
import type { ProposalCredit, TeamMember } from "@/components/proposals/credit-chip";

/**
 * The multi-select bar, the pipeline's pattern (Jack, 2026-09-29): pinned bottom-centre, the count,
 * then plain actions with icons between thin dividers, then Clear.
 *
 * NOTHING HERE FAILS QUIETLY. Every action reports what happened to every proposal: "12 archived,
 * 2 skipped: signed". Bulk never touches money; anything with money attached is skipped by name
 * (lib/proposals/bulk.ts), because that needs one deal at a time.
 */

export interface BulkProposal {
  id: string;
  contactName: string;
  title: string;
  status: string;
  totalAmount: number;
  currency: string;
  sentAt: string | null;
  signedAt: string | null;
  paidAt: string | null;
  credit: ProposalCredit | null;
}

const CLOSER_ROLES = ["closer", "admin", "rep"];
const SETTER_ROLES = ["setter"];

/** A cell a spreadsheet will never execute. */
const csvCell = (v: unknown) => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function summarise(verb: string, results: Array<{ ok: boolean; reason?: string; name?: string }>) {
  const ok = results.filter((r) => r.ok).length;
  const skipped = results.filter((r) => !r.ok);
  if (skipped.length === 0) { toast.success(`${ok} ${verb}`); return; }
  const reasons = [...new Set(skipped.map((r) => r.reason ?? "not saved"))];
  const names = skipped.slice(0, 3).map((r) => r.name).filter(Boolean).join(", ");
  toast(`${ok} ${verb}, ${skipped.length} skipped`, {
    description: `${reasons.join("; ")}${names ? `. ${names}${skipped.length > 3 ? ` and ${skipped.length - 3} more` : ""}` : ""}`,
    duration: 9000,
  });
}

export function ProposalBulkBar({
  selected, team, onClear,
}: {
  selected: BulkProposal[];
  team: TeamMember[];
  onClear: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [lostOpen, setLostOpen] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["proposals"] }),
    qc.invalidateQueries({ queryKey: ["tracker"] }),
  ]);
  const nameOf = (id: string) => team.find((t) => t.id === id)?.name ?? "Someone";
  const byId = new Map(selected.map((p) => [p.id, p]));

  async function credit(field: "closer" | "setter", change: Record<string, unknown>, label: string) {
    const eligible = selected.filter((p) => p.credit);
    if (eligible.length === 0) { toast.error("Credit could not be loaded for these proposals"); return; }
    setBusy(label);
    try {
      const items = eligible.map((p) => field === "closer"
        ? { proposalId: p.id, expectedCloser: p.credit!.closer.userId }
        : { proposalId: p.id, expectedSetter: { mode: p.credit!.setter.mode, userIds: p.credit!.setter.userIds } });
      const res = await fetch("/api/proposals/credit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, change: { field, ...change } }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not save");
      summarise(label, (json.results ?? []).map((r: { proposalId: string; ok: boolean; reason?: string }) => ({ ...r, name: byId.get(r.proposalId)?.contactName })));
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(null);
    }
  }

  async function confirmAll() {
    const needCloser = selected.filter((p) => p.credit?.closer.suggested);
    const needSetter = selected.filter((p) => p.credit?.setter.mode === "suggested");
    if (needCloser.length === 0 && needSetter.length === 0) { toast("Everything selected is already confirmed"); return; }
    setBusy("confirm");
    try {
      const results: Array<{ ok: boolean; reason?: string; name?: string }> = [];
      for (const [field, list] of [["closer", needCloser], ["setter", needSetter]] as const) {
        if (!list.length) continue;
        const items = list.map((p) => field === "closer"
          ? { proposalId: p.id, expectedCloser: p.credit!.closer.userId }
          : { proposalId: p.id, expectedSetter: { mode: p.credit!.setter.mode, userIds: p.credit!.setter.userIds } });
        const res = await fetch("/api/proposals/credit", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items, change: { field, action: "confirm" } }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "Could not save");
        for (const r of json.results ?? []) results.push({ ...r, name: byId.get(r.proposalId)?.contactName });
      }
      summarise("confirmed", results);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(null);
    }
  }

  async function bulk(action: "archive" | "unarchive" | "lost" | "delete", verb: string, reason?: string) {
    setBusy(action);
    try {
      const res = await fetch("/api/proposals/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: selected.map((p) => p.id), reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not complete that");
      summarise(verb, json.results ?? []);
      await refresh();
      if ((json.results ?? []).every((r: { ok: boolean }) => r.ok)) onClear();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not complete that");
    } finally {
      setBusy(null);
    }
  }

  function exportCsv() {
    const header = ["Client", "Title", "Status", "Amount", "Currency", "Sent", "Signed", "Paid", "Closer", "Closer confirmed", "Setter", "Setter confirmed"];
    const day = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");
    const lines = selected.map((p) => {
      const c = p.credit;
      const setter = !c ? "" : c.setter.mode === "none" ? "None" : c.setter.userIds.map(nameOf).join(" / ");
      return [
        p.contactName, p.title, p.status, p.totalAmount, p.currency.toUpperCase(), day(p.sentAt), day(p.signedAt), day(p.paidAt),
        c?.closer.userId ? nameOf(c.closer.userId) : "", c ? (c.closer.suggested ? "suggested" : "yes") : "",
        setter, c ? (c.setter.mode === "suggested" ? "suggested" : "yes") : "",
      ].map(csvCell).join(",");
    });
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `proposals-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success(`${selected.length} exported`);
  }

  const anyArchived = selected.some((p) => p.status === "void");
  const action = "flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-foreground transition-colors hover:text-primary disabled:opacity-50 disabled:hover:text-foreground";
  const divider = <div className="h-4 w-px shrink-0 bg-border" aria-hidden />;
  const spin = (key: string, icon: React.ReactNode) => (busy === key ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : icon);

  const personMenu = (field: "closer" | "setter", icon: React.ReactNode, label: string) => {
    const roles = field === "closer" ? CLOSER_ROLES : SETTER_ROLES;
    const people = team.filter((t) => t.isActive && roles.includes(t.role)).sort((a, b) => a.name.localeCompare(b.name));
    return (
      <Popover.Root>
        <Popover.Trigger asChild>
          <button type="button" className={action} disabled={!!busy}>{spin(`set-${field}`, icon)} {label}</button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content side="top" align="center" sideOffset={14} collisionPadding={12}
            className="z-[60] w-[240px] overflow-hidden rounded-[10px] border border-border bg-card p-1.5 shadow-[0_12px_32px_-12px_rgba(28,35,51,0.35)] animate-scale-in">
            <p className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {field === "closer" ? "Closer" : "Setter"} for {selected.length} {selected.length === 1 ? "proposal" : "proposals"}
            </p>
            {people.map((p) => (
              <Popover.Close asChild key={p.id}>
                <button type="button" onClick={() => credit(field, { action: "assign", userId: p.id }, `set to ${p.name.split(" ")[0]}`)}
                  className="flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted">
                  <Avatar name={p.name} size={20} variant="rep" />
                  <span className="truncate">{p.name}</span>
                </button>
              </Popover.Close>
            ))}
            {field === "setter" && (
              <Popover.Close asChild>
                <button type="button" onClick={() => credit("setter", { action: "none" }, "set to no setter")}
                  className="mt-1 flex w-full items-center gap-2 rounded-[7px] border-t border-border px-2 py-1.5 pt-2 text-left text-xs text-foreground hover:bg-muted">
                  <span className="flex size-5 items-center justify-center rounded-full bg-muted text-muted-foreground"><UserX className="size-3" aria-hidden /></span>
                  No setter <span className="text-muted-foreground">(inbound)</span>
                </button>
              </Popover.Close>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  };

  return (
    <>
      {/* Centred like the pipeline's bar: a full-width strip that centres its child. Enters with a
          plain fade: the shared `animate-slide-up-fade` bakes translate(-50%) into its keyframes
          (for bars that centre themselves), which shoved this one left over the sidebar. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <div
        data-r10n-selectionbar
        role="toolbar"
        aria-label={`${selected.length} proposals selected`}
        className="pointer-events-auto flex max-w-full items-center gap-3 overflow-x-auto rounded-[10px] border border-border bg-card px-4 py-2.5 shadow-lg animate-fade-in"
      >
        <span data-r10n-selectionbar-count className="whitespace-nowrap text-sm font-medium tabular-nums text-foreground">{selected.length} selected</span>
        {divider}
        {personMenu("closer", <UserCheck className="size-3.5" aria-hidden />, "Set closer")}
        {personMenu("setter", <UserPlus className="size-3.5" aria-hidden />, "Set setter")}
        <button type="button" className={action} disabled={!!busy} onClick={confirmAll}>{spin("confirm", <BadgeCheck className="size-3.5" aria-hidden />)} Confirm credit</button>
        {divider}
        <button type="button" className={action} disabled={!!busy} onClick={() => { setLostReason(""); setLostOpen(true); }}>{spin("lost", <XCircle className="size-3.5" aria-hidden />)} Mark lost</button>
        {anyArchived
          ? <button type="button" className={action} disabled={!!busy} onClick={() => bulk("unarchive", "restored")}>{spin("unarchive", <ArchiveRestore className="size-3.5" aria-hidden />)} Unarchive</button>
          : <button type="button" className={action} disabled={!!busy} onClick={() => bulk("archive", "archived")}>{spin("archive", <Archive className="size-3.5" aria-hidden />)} Archive</button>}
        <button type="button" className={action} disabled={!!busy} onClick={exportCsv}><Download className="size-3.5" aria-hidden /> Export CSV</button>
        <button type="button" className={cn(action, "text-destructive hover:text-destructive/80")} disabled={!!busy} onClick={() => setDeleteOpen(true)}>{spin("delete", <Trash2 className="size-3.5" aria-hidden />)} Delete</button>
        {divider}
        <button type="button" onClick={onClear} aria-label="Clear selection" className="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground transition-colors hover:text-foreground">
          <X className="size-3.5" aria-hidden /> Clear
        </button>
      </div>
      </div>

      <Modal open={lostOpen} onOpenChange={setLostOpen} label="Mark proposals lost" size="max-w-md">
        <form className="flex flex-col gap-3 p-5" onSubmit={(e) => { e.preventDefault(); if (lostReason.trim()) { setLostOpen(false); void bulk("lost", "marked lost", lostReason.trim()); } }}>
          <h2 className="text-[15px] font-semibold text-foreground">Mark {selected.length} {selected.length === 1 ? "proposal" : "proposals"} lost?</h2>
          <p className="text-[13px] text-muted-foreground">
            One reason for all of them. Anything signed, paid or with a Stripe invoice is skipped: those need marking lost one at a time, where their billing is handled.
          </p>
          <textarea autoFocus value={lostReason} onChange={(e) => setLostReason(e.target.value)} maxLength={500} rows={3}
            placeholder="Why were they lost?" aria-label="Reason lost"
            className="w-full resize-none rounded-[8px] border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-ring/30" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setLostOpen(false)} className="h-8 rounded-[7px] px-3 text-[13px] font-medium text-foreground hover:bg-muted">Cancel</button>
            <button type="submit" disabled={!lostReason.trim()} className="h-8 rounded-[7px] bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">Mark lost</button>
          </div>
        </form>
      </Modal>

      <Modal open={deleteOpen} onOpenChange={setDeleteOpen} label="Delete proposals" size="max-w-md">
        <div className="flex flex-col gap-3 p-5">
          <h2 className="text-[15px] font-semibold text-foreground">Delete {selected.length} {selected.length === 1 ? "proposal" : "proposals"}?</h2>
          <p className="text-[13px] text-muted-foreground">
            This cannot be undone. Only drafts, lost and archived proposals with no signature and no money are deleted; anything else is skipped and listed.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDeleteOpen(false)} className="h-8 rounded-[7px] px-3 text-[13px] font-medium text-foreground hover:bg-muted">Cancel</button>
            <button type="button" onClick={() => { setDeleteOpen(false); void bulk("delete", "deleted"); }}
              className="h-8 rounded-[7px] bg-destructive px-3 text-[13px] font-medium text-destructive-foreground hover:bg-destructive/90">Delete</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
