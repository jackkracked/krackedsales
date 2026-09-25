"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { format } from "date-fns";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Search, Repeat, Receipt, X, ArrowDown, ArrowUp, CreditCard, ExternalLink,
  ArrowUpRight, Users2, FlaskConical, Check, Plus, ChevronDown, Landmark,
  Pencil, Trash2, RefreshCw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import type { UnifiedContact } from "@/lib/contacts/types";

// ─── Types (mirror the /api/customers payload) ───────────────────────────────
interface Customer {
  id: string;
  email: string | null;
  name: string;
  contactId: string | null;
  ltvNet: number; // cents
  grossPaid: number;
  refunded: number;
  paymentsCount: number;
  currency: string | null;
  firstPaidAt: string | null;
  lastPaidAt: string | null;
  status: "active" | "inactive";
  type: "subscription" | "one_off";
  source: string | null;
  currentMrr: number; // cents
  subscriptionStatus: string | null;
  subscriptionDetail: string | null;
  isTest: boolean;
}
interface PeriodSummary { customers: number; collected: number; payments: number; newCount: number }
interface CurrentSummary { total: number; active: number; mrr: number; ltv: number }
interface ListResponse { customers: Customer[]; hasRange: boolean; period: PeriodSummary; current: CurrentSummary; testCount: number }
const SOURCES = ["Facebook", "Instagram", "TikTok", "Other"] as const;
const SOURCE_STYLE: Record<string, string> = {
  Facebook: "bg-blue-500/12 text-blue-600",
  Instagram: "bg-pink-500/12 text-pink-600",
  TikTok: "bg-foreground/10 text-foreground",
  Other: "bg-muted text-muted-foreground",
};
interface Payment { id: string; at: string; amount: number; currency: string; source: string; manual: boolean; method: string | null; note: string | null; stripeUrl: string | null }

// Payment provenance → icon + human label for the timeline.
const PAYMENT_SOURCE_META: Record<string, { label: string; icon: LucideIcon }> = {
  invoice: { label: "Invoice", icon: Receipt },
  charge: { label: "Card", icon: CreditCard },
  manual: { label: "Manual", icon: Landmark },
};

type SortKey = "ltv" | "mrr" | "payments" | "last" | "first" | "name";
type Range = { start: string; end: string; preset?: string };

// ─── Formatting ──────────────────────────────────────────────────────────────
function money(cents: number, opts: { compact?: boolean } = {}): string {
  const v = (cents ?? 0) / 100;
  if (opts.compact && Math.abs(v) >= 1000) {
    return "$" + (v / 1000).toLocaleString("en-US", { maximumFractionDigits: v >= 100_000 ? 0 : 1 }) + "k";
  }
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function initials(name: string): string {
  const parts = name.replace(/\(.*?\)/g, "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? name[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return format(new Date(iso), "MMM ''yy");
}

// ─── Status + type (self-styled with theme-aware tokens; never r10n hooks) ─────
function StatusPill({ status }: { status: "active" | "inactive" }) {
  const active = status === "active";
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset",
      active ? "bg-success/10 text-success ring-success/25" : "bg-muted text-muted-foreground ring-border",
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-success" : "bg-muted-foreground/45")} />
      {active ? "Active" : "Inactive"}
    </span>
  );
}
function TypeChip({ type }: { type: "subscription" | "one_off" }) {
  const sub = type === "subscription";
  const Icon = sub ? Repeat : Receipt;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] text-muted-foreground">
      <Icon className="h-3.5 w-3.5 opacity-70" />
      {sub ? "Subscription" : "One-off"}
    </span>
  );
}
function Monogram({ name, size = "sm" }: { name: string; size?: "sm" | "lg" }) {
  return (
    <span className={cn(
      "flex shrink-0 items-center justify-center rounded-[10px] bg-primary/[0.07] font-semibold text-primary ring-1 ring-inset ring-primary/10",
      size === "lg" ? "h-11 w-11 text-sm" : "h-9 w-9 text-[11px]",
    )} style={{ fontFamily: "var(--font-heading)" }}>{initials(name)}</span>
  );
}

// ─── Sortable header ─────────────────────────────────────────────────────────
function SortHead({ label, k, sort, dir, onSort, align = "left" }: {
  label: string; k: SortKey; sort: SortKey; dir: "asc" | "desc"; onSort: (k: SortKey) => void; align?: "left" | "right";
}) {
  const active = sort === k;
  const Arrow = dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <button onClick={() => onSort(k)}
      className={cn("group inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors",
        align === "right" && "flex-row-reverse", active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
      <Arrow className={cn("h-3 w-3 transition-opacity", active ? "opacity-100" : "opacity-0 group-hover:opacity-40")} />
      {label}
    </button>
  );
}

// ─── Main view ───────────────────────────────────────────────────────────────
export function CustomersView({ onOpenContact }: { onOpenContact: (c: UnifiedContact) => void }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [type, setType] = useState<"all" | "subscription" | "one_off">("all");
  const [includeTest, setIncludeTest] = useState(false);
  const [sort, setSort] = useState<SortKey>("ltv");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [range, setRange] = useState<Range | null>(null);

  const params = new URLSearchParams({ status, type, sort, dir, ...(q ? { q } : {}), ...(includeTest ? { includeTest: "1" } : {}), ...(range ? { from: range.start, to: range.end } : {}) });
  const { data, isLoading, isError } = useQuery<ListResponse>({
    queryKey: ["customers", params.toString()],
    queryFn: async () => { const r = await fetch(`/api/customers?${params}`); if (!r.ok) throw new Error(String(r.status)); return r.json(); },
    staleTime: 60_000,
  });

  const queryClient = useQueryClient();
  const setSource = useMutation({
    mutationFn: async (v: { id: string; source: string | null }) => {
      const r = await fetch(`/api/customers/${v.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: v.source }) });
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    onMutate: async (v) => {
      const key = ["customers", params.toString()];
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<ListResponse>(key);
      queryClient.setQueryData<ListResponse>(key, (old) => old ? { ...old, customers: old.customers.map((c) => (c.id === v.id ? { ...c, source: v.source } : c)) } : old);
      return { key, prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) queryClient.setQueryData(ctx.key, ctx.prev); },
    onSettled: () => { queryClient.invalidateQueries({ queryKey: ["customers"] }); queryClient.invalidateQueries({ queryKey: ["customer-detail"] }); },
  });

  function toggleSort(k: SortKey) {
    if (sort === k) setDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSort(k); setDir(k === "name" ? "asc" : "desc"); }
  }

  const rows = data?.customers ?? [];
  const per = data?.period;
  const cur = data?.current;
  const ranged = !!range;
  const maxLtv = Math.max(1, ...rows.map((r) => r.ltvNet));

  return (
    <>
      {/* Stat ribbon — adapts to the selected period */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-[12px] border border-border bg-card px-4 py-2.5">
        {ranged ? (
          <>
            <Metric value={per ? per.customers.toLocaleString() : "—"} label="paid" icon={<Users2 className="h-4 w-4" />} />
            <Rule />
            <Metric value={per ? money(per.collected) : "—"} label="collected" tone="success" />
            <Rule />
            <Metric value={per ? per.newCount.toLocaleString() : "—"} label="new" />
            <Rule />
            <Metric value={per ? per.payments.toLocaleString() : "—"} label="payments" />
          </>
        ) : (
          <>
            <Metric value={cur ? cur.total.toLocaleString() : "—"} label="customers" icon={<Users2 className="h-4 w-4" />} />
            <Rule />
            <Metric value={cur ? cur.active.toLocaleString() : "—"} label="active" tone="success" />
            <Rule />
            <Metric value={cur ? money(cur.mrr) : "—"} label="MRR / mo" />
            <Rule />
            <Metric value={cur ? money(cur.ltv, { compact: true }) : "—"} label="lifetime value" />
          </>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers…"
            className="w-full rounded-[9px] border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground transition-shadow focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/15" />
        </div>
        <button onClick={() => setRange(null)}
          className={cn("rounded-[8px] border px-3 py-1.5 text-sm font-medium transition-colors",
            range === null ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground")}>
          All time
        </button>
        <DateRangePicker value={range} onChange={setRange} />
        <Segmented value={status} onChange={setStatus} options={[["all", "All"], ["active", "Active"], ["inactive", "Inactive"]]} />
        <Segmented value={type} onChange={setType} options={[["all", "Any type"], ["subscription", "Subscription"], ["one_off", "One-off"]]} />
        {(data?.testCount ?? 0) > 0 && (
          <button onClick={() => setIncludeTest((v) => !v)} title="Show / hide test payments"
            className={cn("inline-flex items-center gap-1.5 rounded-[9px] border px-2.5 py-2 text-xs font-medium transition-colors",
              includeTest ? "border-primary/40 bg-primary/[0.07] text-primary" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground")}>
            <FlaskConical className="h-3.5 w-3.5" /> {data?.testCount}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto rounded-[12px] border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-border bg-card/95 backdrop-blur">
              <th className="px-4 py-3 text-left font-normal"><SortHead label="Customer" k="name" sort={sort} dir={dir} onSort={toggleSort} /></th>
              <th className="w-[118px] px-3 py-3 text-left font-normal"><span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Status</span></th>
              <th className="w-[140px] px-3 py-3 text-left font-normal"><span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Type</span></th>
              <th className="w-[130px] px-3 py-3 text-left font-normal"><span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Source</span></th>
              <th className="w-[160px] px-3 py-3 text-right font-normal"><SortHead label={ranged ? "Collected" : "Lifetime value"} k="ltv" sort={sort} dir={dir} onSort={toggleSort} align="right" /></th>
              <th className="w-[104px] px-3 py-3 text-right font-normal"><SortHead label="MRR" k="mrr" sort={sort} dir={dir} onSort={toggleSort} align="right" /></th>
              <th className="w-[72px] px-3 py-3 text-right font-normal"><SortHead label="Pmts" k="payments" sort={sort} dir={dir} onSort={toggleSort} align="right" /></th>
              <th className="w-[150px] px-4 py-3 text-right font-normal"><SortHead label="First → Last" k="last" sort={sort} dir={dir} onSort={toggleSort} align="right" /></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && [...Array(9)].map((_, i) => <SkeletonRow key={i} />)}
            {isError && (
              <tr><td colSpan={8} className="px-4 py-16 text-center text-sm text-muted-foreground">Couldn&apos;t load customers. <button onClick={() => location.reload()} className="font-medium text-primary hover:underline">Retry</button></td></tr>
            )}
            {!isLoading && !isError && rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-20 text-center">
                <Users2 className="mx-auto h-8 w-8 text-muted-foreground/25" />
                <p className="mt-3 text-sm font-medium text-foreground">No customers match these filters</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Try clearing the search or status filter.</p>
              </td></tr>
            )}
            {!isLoading && rows.map((c) => (
              <tr key={c.id} onClick={() => setDetailId(c.id)}
                className="group cursor-pointer border-b border-border/50 transition-colors last:border-0 hover:bg-muted/40">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <Monogram name={c.name} />
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate text-[13px] font-medium text-foreground">
                        {c.name}
                        {c.isTest && <span className="rounded bg-amber-500/12 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-600">test</span>}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">{c.email ?? "no email"}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5"><StatusPill status={c.status} /></td>
                <td className="px-3 py-2.5"><TypeChip type={c.type} /></td>
                <td className="px-3 py-2.5"><SourcePicker value={c.source} onChange={(s) => setSource.mutate({ id: c.id, source: s })} /></td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-[15px] font-bold tabular-nums text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{money(c.ltvNet)}</span>
                    <span className="h-[3px] w-16 overflow-hidden rounded-full bg-muted">
                      <span className={cn("block h-full rounded-full", c.status === "active" ? "bg-success/70" : "bg-primary/30")} style={{ width: `${Math.max(4, Math.round((c.ltvNet / maxLtv) * 100))}%` }} />
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right text-[13px] tabular-nums">{c.currentMrr > 0 ? <span className="font-medium text-foreground">{money(c.currentMrr)}</span> : <span className="text-muted-foreground/40">—</span>}</td>
                <td className="px-3 py-2.5 text-right text-[13px] tabular-nums text-muted-foreground">{c.paymentsCount}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right text-[12px] tabular-nums text-muted-foreground">
                  {fmtDate(c.firstPaidAt)} <span className="text-muted-foreground/40">→</span> {fmtDate(c.lastPaidAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CustomerDetail id={detailId} onClose={() => setDetailId(null)} onOpenContact={(c) => { setDetailId(null); onOpenContact(c); }} onSetSource={(id, s) => setSource.mutate({ id, source: s })} />
    </>
  );
}

// ─── Small UI atoms ──────────────────────────────────────────────────────────
function Rule() { return <span className="h-7 w-px bg-border" />; }
function Metric({ value, label, tone, icon }: { value: string; label: string; tone?: "success"; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      {icon && <span className="text-muted-foreground">{icon}</span>}
      <div className="leading-none">
        <span className={cn("text-[17px] font-bold tabular-nums", tone === "success" ? "text-success" : "text-foreground")} style={{ fontFamily: "var(--font-heading)" }}>{value}</span>
        <span className="ml-1.5 text-[11px] text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}
function SourcePicker({ value, onChange, size = "sm" }: { value: string | null; onChange: (s: string | null) => void; size?: "sm" | "lg" }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button onClick={(e) => e.stopPropagation()}
          className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium transition-colors",
            size === "lg" ? "px-3 py-1.5 text-[13px]" : "px-2.5 py-1 text-[11px]",
            value ? SOURCE_STYLE[value] ?? "bg-muted text-muted-foreground" : "border border-dashed border-border text-muted-foreground/70 hover:border-primary/40 hover:text-primary")}>
          {value ? (<>{value}<ChevronDown className="h-3 w-3 opacity-50" /></>) : (<><Plus className="h-3 w-3" />Source</>)}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={5} onClick={(e) => e.stopPropagation()}
          className="z-[60] min-w-[150px] rounded-[10px] border border-border bg-card p-1 shadow-xl">
          {SOURCES.map((s) => (
            <DropdownMenu.Item key={s} onSelect={() => onChange(s)}
              className="flex cursor-pointer items-center justify-between rounded-[7px] px-2.5 py-1.5 text-[13px] text-foreground outline-none transition-colors data-[highlighted]:bg-muted">
              <span className="flex items-center gap-2"><span className={cn("h-2 w-2 rounded-full", SOURCE_STYLE[s]?.split(" ")[0] ?? "bg-muted")} />{s}</span>
              {value === s && <Check className="h-3.5 w-3.5 text-primary" />}
            </DropdownMenu.Item>
          ))}
          {value && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item onSelect={() => onChange(null)}
                className="cursor-pointer rounded-[7px] px-2.5 py-1.5 text-[13px] text-muted-foreground outline-none transition-colors data-[highlighted]:bg-muted">
                Clear
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="inline-flex items-center rounded-[9px] border border-border bg-card p-0.5">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)}
          className={cn("rounded-[7px] px-2.5 py-1.5 text-xs font-medium transition-colors",
            value === v ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{label}</button>
      ))}
    </div>
  );
}
function SkeletonRow() {
  return (
    <tr className="border-b border-border/50">
      <td className="px-4 py-3"><div className="flex items-center gap-3"><div className="h-9 w-9 shrink-0 animate-pulse rounded-[10px] bg-muted" /><div className="space-y-1.5"><div className="h-3 w-32 animate-pulse rounded bg-muted" /><div className="h-2 w-40 animate-pulse rounded bg-muted/60" /></div></div></td>
      <td className="px-3 py-3"><div className="h-5 w-20 animate-pulse rounded-full bg-muted/60" /></td>
      <td className="px-3 py-3"><div className="h-3 w-24 animate-pulse rounded bg-muted/60" /></td>
      <td className="px-3 py-3"><div className="h-5 w-16 animate-pulse rounded-full bg-muted/60" /></td>
      <td className="px-3 py-3"><div className="ml-auto h-4 w-20 animate-pulse rounded bg-muted" /></td>
      <td className="px-3 py-3"><div className="ml-auto h-3 w-12 animate-pulse rounded bg-muted/60" /></td>
      <td className="px-3 py-3"><div className="ml-auto h-3 w-8 animate-pulse rounded bg-muted/60" /></td>
      <td className="px-4 py-3"><div className="ml-auto h-3 w-24 animate-pulse rounded bg-muted/60" /></td>
    </tr>
  );
}

// ─── Payments section (list + manual add/edit/delete) ────────────────────────
const PAY_METHODS = [
  { value: "wire", label: "Wire" },
  { value: "bill_com", label: "Bill.com" },
  { value: "check", label: "Check" },
  { value: "ach", label: "ACH" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
] as const;
const METHOD_LABEL: Record<string, string> = Object.fromEntries(PAY_METHODS.map((m) => [m.value, m.label]));
const todayStr = () => new Date().toISOString().slice(0, 10);
const isoToDateInput = (iso: string) => new Date(iso).toISOString().slice(0, 10);

function PaymentsSection({ customerId, payments }: { customerId: string; payments: Payment[] }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayStr());
  const [method, setMethod] = useState<string>("wire");
  const [note, setNote] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["customer-detail", customerId] });
    qc.invalidateQueries({ queryKey: ["customers"] });
  };
  const reset = () => { setShowForm(false); setEditingId(null); setAmount(""); setDate(todayStr()); setMethod("wire"); setNote(""); };

  const save = useMutation({
    mutationFn: async () => {
      const payload = { amount: parseFloat(amount), paidAt: date, method, note };
      const url = editingId ? `/api/customers/${customerId}/payments/${editingId}` : `/api/customers/${customerId}/payments`;
      const res = await fetch(url, { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to save payment");
      return res.json();
    },
    onSuccess: () => { invalidate(); reset(); },
  });
  const del = useMutation({
    mutationFn: async (pid: string) => { const res = await fetch(`/api/customers/${customerId}/payments/${pid}`, { method: "DELETE" }); if (!res.ok) throw new Error("Failed to delete"); },
    onSuccess: () => { invalidate(); setConfirmDelete(null); },
  });

  function openEdit(p: Payment) {
    setEditingId(p.id); setShowForm(true);
    setAmount(String(p.amount / 100)); setDate(isoToDateInput(p.at)); setMethod(p.method ?? "other"); setNote(p.note ?? "");
  }

  const amt = parseFloat(amount);
  const canSave = isFinite(amt) && amt > 0 && !!date;
  const total = payments.reduce((s, p) => s + p.amount, 0);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Payments</p>
        <div className="flex items-center gap-3">
          {payments.length > 0 && <p className="text-[10px] tabular-nums text-muted-foreground">{payments.length} · {money(total)}</p>}
          {!showForm && (
            <button onClick={() => { reset(); setShowForm(true); }} className="flex items-center gap-1 rounded-[6px] border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary">
              <Plus className="h-3 w-3" /> Add payment
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}
          className="mb-2 space-y-3 rounded-[12px] border border-primary/30 bg-muted/20 p-3.5">
          <p className="text-[11px] font-semibold text-foreground">{editingId ? "Edit payment" : "Record a payment"}</p>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="block">
              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Amount</span>
              <div className="relative">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <input type="number" min="0" step="0.01" value={amount} autoFocus onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
                  className="w-full rounded-[7px] border border-border bg-card py-1.5 pl-6 pr-2.5 text-sm tabular-nums text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Date paid</span>
              <input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-[7px] border border-border bg-card px-2.5 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </label>
          </div>
          <div>
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Method</span>
            <div className="flex flex-wrap gap-1.5">
              {PAY_METHODS.map((m) => (
                <button key={m.value} onClick={() => setMethod(m.value)}
                  className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors", method === m.value ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:border-primary/40 hover:text-foreground")}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Note (optional)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reference, invoice #, memo…" maxLength={200}
              className="w-full rounded-[7px] border border-border bg-card px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </label>
          <div className="flex items-center justify-end gap-2 pt-0.5">
            {save.isError && <span className="mr-auto text-[11px] text-destructive">{(save.error as Error).message}</span>}
            <button onClick={reset} className="rounded-[7px] px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground">Cancel</button>
            <button onClick={() => save.mutate()} disabled={!canSave || save.isPending}
              className="flex items-center gap-1.5 rounded-[7px] bg-primary px-3.5 py-1.5 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">
              {save.isPending && <RefreshCw className="h-3 w-3 animate-spin" />} {editingId ? "Save changes" : "Add payment"}
            </button>
          </div>
        </motion.div>
      )}

      <div className="overflow-hidden rounded-[12px] border border-border">
        {payments.length === 0 ? (
          <p className="px-4 py-5 text-center text-xs text-muted-foreground">No payments on record.</p>
        ) : payments.map((p) => {
          const meta = PAYMENT_SOURCE_META[p.source] ?? PAYMENT_SOURCE_META.charge;
          const Icon = meta.icon;
          const label = p.manual ? (p.method ? METHOD_LABEL[p.method] ?? "Manual" : "Manual") : meta.label;
          return (
            <div key={p.id} className="group flex items-center justify-between gap-3 border-b border-border/50 px-4 py-2.5 last:border-0">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-muted"><Icon className="h-3.5 w-3.5 text-muted-foreground" /></span>
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-foreground">{format(new Date(p.at), "MMM d, yyyy")}</p>
                  <p className="truncate text-[10px] text-muted-foreground"><span className="uppercase tracking-[0.08em]">{label}</span>{p.note ? ` · ${p.note}` : ""}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold tabular-nums text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{money(p.amount)}</span>
                {p.stripeUrl && <a href={p.stripeUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-muted-foreground/40 transition-colors hover:text-primary" title="View in Stripe"><ExternalLink className="h-3 w-3" /></a>}
                {p.manual && confirmDelete !== p.id && (
                  <span className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button onClick={() => openEdit(p)} className="text-muted-foreground/50 transition-colors hover:text-foreground" title="Edit"><Pencil className="h-3 w-3" /></button>
                    <button onClick={() => setConfirmDelete(p.id)} className="text-muted-foreground/50 transition-colors hover:text-destructive" title="Delete"><Trash2 className="h-3 w-3" /></button>
                  </span>
                )}
                {p.manual && confirmDelete === p.id && (
                  <span className="flex items-center gap-1.5 text-[10px]">
                    <span className="text-muted-foreground">Delete?</span>
                    <button onClick={() => del.mutate(p.id)} disabled={del.isPending} className="font-semibold text-destructive hover:underline">Yes</button>
                    <button onClick={() => setConfirmDelete(null)} className="text-muted-foreground hover:text-foreground">No</button>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Detail slide-over ───────────────────────────────────────────────────────
function CustomerDetail({ id, onClose, onOpenContact, onSetSource }: { id: string | null; onClose: () => void; onOpenContact: (c: UnifiedContact) => void; onSetSource: (id: string, source: string | null) => void }) {
  const reduce = useReducedMotion();
  const { data, isLoading } = useQuery<{ customer: Customer; payments: Payment[]; contact: UnifiedContact | null }>({
    queryKey: ["customer-detail", id],
    queryFn: async () => { const r = await fetch(`/api/customers/${id}`); if (!r.ok) throw new Error(String(r.status)); return r.json(); },
    enabled: !!id,
    staleTime: 30_000,
  });
  const c = data?.customer;

  return (
    <AnimatePresence>
      {id && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
            onClick={onClose} className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-[2px]" />
          <motion.div
            initial={reduce ? { opacity: 0 } : { x: "100%" }} animate={reduce ? { opacity: 1 } : { x: 0 }} exit={reduce ? { opacity: 0 } : { x: "100%" }}
            transition={{ type: "tween", ease: [0.22, 1, 0.36, 1], duration: 0.36 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-card shadow-2xl sm:w-[452px]">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 pb-4 pt-5">
              <div className="flex min-w-0 items-center gap-3">
                {c && <Monogram name={c.name} size="lg" />}
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-foreground">{c?.name ?? "…"}</p>
                  <p className="truncate text-xs text-muted-foreground">{c?.email ?? ""}</p>
                </div>
              </div>
              <button onClick={onClose} className="-mr-1.5 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {isLoading || !c ? (
                <div className="space-y-4 p-5">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-[12px] bg-muted/50" />)}</div>
              ) : (
                <div className="space-y-5 p-5">
                  <div className="flex items-center gap-3"><StatusPill status={c.status} /><TypeChip type={c.type} /></div>

                  {/* LTV hero */}
                  <div className="rounded-[14px] border border-border bg-gradient-to-b from-muted/30 to-transparent px-5 py-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Lifetime value</p>
                    <p className="mt-1.5 text-[2.6rem] font-bold leading-none tabular-nums text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{money(c.ltvNet)}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Gross {money(c.grossPaid)}
                      {c.refunded > 0 && <> · <span className="text-destructive">refunded {money(c.refunded)}</span></>}
                      {" · "}{c.paymentsCount} payment{c.paymentsCount === 1 ? "" : "s"}
                    </p>
                  </div>

                  {c.subscriptionDetail && (
                    <div className="flex items-center gap-3 rounded-[12px] border border-border px-4 py-3">
                      <span className={cn("flex h-8 w-8 items-center justify-center rounded-[9px]", c.status === "active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}><Repeat className="h-4 w-4" /></span>
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Subscription</p>
                        <p className="truncate text-[13px] font-medium text-foreground">{c.subscriptionDetail}</p>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <Stat label="First payment" value={c.firstPaidAt ? format(new Date(c.firstPaidAt), "MMM d, yyyy") : "—"} />
                    <Stat label="Last payment" value={c.lastPaidAt ? format(new Date(c.lastPaidAt), "MMM d, yyyy") : "—"} />
                  </div>

                  {/* Payments timeline — every payment on record (invoice, card, manual) + manual add/edit */}
                  <PaymentsSection customerId={c.id} payments={data?.payments ?? []} />

                  <div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Acquisition source</p>
                    <SourcePicker value={c.source} size="lg" onChange={(s) => onSetSource(c.id, s)} />
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-border p-4">
              <button disabled={!data?.contact} onClick={() => data?.contact && onOpenContact(data.contact)}
                className="flex w-full items-center justify-center gap-2 rounded-[9px] bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40">
                View full contact <ArrowUpRight className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] border border-border px-4 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-[13px] font-medium tabular-nums text-foreground">{value}</p>
    </div>
  );
}
