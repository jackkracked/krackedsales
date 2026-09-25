"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, RefreshCw, Plus, Users } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface Salary {
  id: string;
  role: string;
  monthlyAmount: number;
  active: boolean;
  createdAt: string;
}

const api = "/api/settings/team-salaries";
async function fetchItems(): Promise<Salary[]> {
  const res = await fetch(api);
  if (!res.ok) throw new Error("Failed to load team salaries");
  return (await res.json()).items;
}
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// ─── One person's editable salary row ────────────────────────────────────────
function MemberRow({ item, index, showOrdinal, onSave, onDelete, saving, deleting }: {
  item: Salary; index: number; showOrdinal: boolean;
  onSave: (monthlyAmount: number) => void;
  onDelete: () => void; saving: boolean; deleting: boolean;
}) {
  const [amount, setAmount] = useState(String(item.monthlyAmount));

  return (
    <div className="group flex items-center gap-3 py-2 pl-3.5 pr-3">
      <span className="w-5 shrink-0 text-center text-[11px] tabular-nums text-muted-foreground/60">
        {showOrdinal ? index + 1 : "•"}
      </span>
      <div className="relative w-[130px] shrink-0">
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
        <input
          type="number" min="0" step="1" inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onBlur={() => { const v = parseFloat(amount); if (!isNaN(v) && v >= 0 && v !== item.monthlyAmount) onSave(v); else setAmount(String(item.monthlyAmount)); }}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setAmount(String(item.monthlyAmount)); e.currentTarget.blur(); } }}
          className="w-full rounded-[6px] border border-transparent bg-transparent py-1.5 pl-5 pr-2 text-right text-sm font-medium tabular-nums text-foreground hover:border-border focus:border-primary/40 focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 transition-colors"
          style={{ fontFamily: "var(--font-heading)" }}
        />
      </div>
      <span className="text-[11px] text-muted-foreground">/mo</span>
      <span className="ml-auto flex items-center gap-2">
        {saving && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
        <button onClick={onDelete} disabled={deleting} aria-label="Remove person"
          className="text-muted-foreground/40 transition-colors hover:text-destructive group-hover:text-muted-foreground">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </span>
    </div>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────
export function TeamSalaries() {
  const queryClient = useQueryClient();
  const [newRole, setNewRole] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const { data: items = [], isLoading } = useQuery<Salary[]>({ queryKey: ["team-salaries"], queryFn: fetchItems });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["team-salaries"] });

  const addMutation = useMutation({
    mutationFn: async (payload: { role: string; monthlyAmount: number }) => {
      const res = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to add");
      return res.json();
    },
    onSuccess: invalidate,
  });
  const updateMutation = useMutation({
    mutationFn: async ({ id, monthlyAmount }: { id: string; monthlyAmount: number }) => {
      setSavingId(id);
      const res = await fetch(`${api}/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ monthlyAmount }) });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSettled: () => { setSavingId(null); invalidate(); },
  });
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await fetch(`${api}/${id}`, { method: "DELETE" }); },
    onSuccess: invalidate,
  });

  function handleAddRole(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseFloat(newAmount);
    if (!newRole.trim() || isNaN(parsed) || parsed < 0) return;
    addMutation.mutate({ role: newRole.trim(), monthlyAmount: parsed }, { onSuccess: () => { invalidate(); setNewRole(""); setNewAmount(""); } });
  }

  // Group people by role, preserving first-seen order. The first person in a role
  // sets the "going rate" a new hire of that role starts on.
  const active = items.filter((i) => i.active);
  const groups: { role: string; members: Salary[] }[] = [];
  for (const it of active) {
    let g = groups.find((x) => x.role === it.role);
    if (!g) { g = { role: it.role, members: [] }; groups.push(g); }
    g.members.push(it);
  }
  const total = active.reduce((s, i) => s + i.monthlyAmount, 0);
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const soFar = total * (now.getDate() / daysInMonth);
  const canAdd = newRole.trim() && newAmount.trim() && !isNaN(parseFloat(newAmount));

  return (
    <div className="flex flex-col rounded-[10px] border border-border bg-card p-5" data-r10n-settings-card>
      <div className="mb-1 flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" data-r10n-settings-cardicon />
        <h2 className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-heading)" }} data-r10n-settings-cardtitle>
          Team Salaries
        </h2>
      </div>
      <p className="mb-5 text-xs text-muted-foreground">
        One row per person. Add as many of each role as you have, each on their own salary. The total flows into <span className="font-medium text-foreground">Total Expenses</span>, pro-rated by how much of the month has elapsed.
      </p>

      <div className="flex-1">
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><RefreshCw className="h-3 w-3 animate-spin" /> Loading…</div>
        ) : groups.length === 0 ? (
          <p className="text-xs text-muted-foreground">No roles yet. Add your first below.</p>
        ) : (
          <div className="space-y-2.5">
            {groups.map((g) => {
              const subtotal = g.members.reduce((s, m) => s + m.monthlyAmount, 0);
              const goingRate = g.members[0].monthlyAmount; // base rate for a new hire
              return (
                <div key={g.role} className="overflow-hidden rounded-[8px] border border-border">
                  <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3.5 py-2">
                    <span className="text-sm font-medium text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{g.role}</span>
                    <span className="rounded-full bg-border/60 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                      {g.members.length}
                    </span>
                    <span className="ml-auto text-xs font-medium tabular-nums text-muted-foreground">{money(subtotal)}/mo</span>
                    <button
                      onClick={() => addMutation.mutate({ role: g.role, monthlyAmount: goingRate })}
                      disabled={addMutation.isPending}
                      className="flex items-center gap-1 rounded-[6px] border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-50"
                    >
                      <Plus className="h-3 w-3" /> Add another
                    </button>
                  </div>
                  <div className="divide-y divide-border">
                    {g.members.map((m, i) => (
                      <MemberRow
                        key={m.id} item={m} index={i} showOrdinal={g.members.length > 1}
                        saving={savingId === m.id} deleting={deleteMutation.isPending}
                        onSave={(amt) => updateMutation.mutate({ id: m.id, monthlyAmount: amt })}
                        onDelete={() => deleteMutation.mutate(m.id)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            <div className="flex items-center justify-between rounded-[8px] border border-border bg-muted/40 px-3.5 py-2.5">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total / month</span>
              <div className="text-right">
                <span className="text-sm font-semibold tabular-nums text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{money(total)}</span>
                <p className="text-[10px] text-muted-foreground">{money(soFar)} so far this month</p>
              </div>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleAddRole} className="mt-4 border-t border-border pt-4 space-y-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-foreground"><Plus className="h-3.5 w-3.5" /> Add a new role</p>
        <div className="grid grid-cols-[1fr_130px] gap-2">
          <input value={newRole} onChange={(e) => setNewRole(e.target.value)} placeholder="e.g. Strategist"
            className="w-full rounded-[6px] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30" />
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <input type="number" min="0" step="1" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} placeholder="0"
              className="w-full rounded-[6px] border border-border bg-background py-2 pl-6 pr-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={!canAdd || addMutation.isPending}
            className="flex items-center gap-1.5 rounded-[6px] bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">
            {addMutation.isPending && <RefreshCw className="h-3.5 w-3.5 animate-spin" />} Add role
          </button>
          {addMutation.isError && <span className="text-xs text-destructive">{(addMutation.error as Error).message}</span>}
        </div>
      </form>
    </div>
  );
}
