"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { X, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Avatar } from "@/components/ui/avatar";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { fmtCurrency } from "@/components/kpis/metric-cell";
import { relativeTime } from "@/lib/utils/date";
import { startOfMonth, addDays, format } from "date-fns";

interface RepRow {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
  calls: number;
  proposalsSent: number;
  dealsClosed: number;
  closedValue: number;
  openLeads: number;
}

interface DrillItem {
  id: string;
  title: string;
  sub?: string;
  date?: string;
  amount?: number;
  href?: string;
  status?: string;
}

function StatusDot({ active }: { active: boolean }) {
  return <span className={cn("inline-block w-1.5 h-1.5 rounded-full", active ? "bg-emerald-500" : "bg-muted-foreground/40")} />;
}

// col key → leaderboard label + the drilldown metric it validates.
const COLUMNS: { key: keyof RepRow; label: string; drill: string; currency?: boolean }[] = [
  { key: "calls", label: "Calls", drill: "calls" },
  { key: "proposalsSent", label: "Proposals", drill: "proposals" },
  { key: "dealsClosed", label: "Closed", drill: "closed" },
  { key: "closedValue", label: "$ Closed", drill: "closed", currency: true },
  { key: "openLeads", label: "Open", drill: "open" },
];

export function RepPerformanceLeaderboard() {
  const defaultRange = useMemo(() => {
    const now = new Date();
    const s = startOfMonth(now);
    const e = addDays(startOfMonth(new Date(now.getFullYear(), now.getMonth() + 1, 1)), 0);
    return { start: format(s, "yyyy-MM-dd"), end: format(e, "yyyy-MM-dd"), preset: "mtd" };
  }, []);

  const [dateRange, setDateRange] = useState<{ start: string; end: string; preset?: string }>(defaultRange);
  const [drill, setDrill] = useState<{ userId: string; rep: string; metric: string; label: string } | null>(null);

  const queryParams = useMemo(() => {
    const presetMap: Record<string, string> = {
      today: "range=today", yesterday: "range=today", wtd: "range=week",
      mtd: "range=month", last_7: "range=30d", last_30: "range=30d", ytd: "range=all",
    };
    if (dateRange.preset && presetMap[dateRange.preset]) return presetMap[dateRange.preset];
    return `start=${dateRange.start}&end=${dateRange.end}`;
  }, [dateRange]);

  const { data, isPending } = useQuery<{ reps: RepRow[] }>({
    queryKey: ["rep-performance", queryParams],
    queryFn: () => fetch(`/api/dashboard/rep-performance?${queryParams}`).then((r) => r.json()),
    staleTime: 60 * 1000,
    refetchInterval: 3 * 60 * 1000,
  });

  const reps = data?.reps ?? [];
  const isLoading = isPending && !data;

  return (
    <div className="bg-card border border-border rounded-[10px] overflow-hidden shrink-0">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>Rep Performance</h3>
          <p className="text-[10.5px] text-muted-foreground/70 mt-0.5">Click any number to verify the records behind it</p>
        </div>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Rep</th>
            {COLUMNS.map((col) => (
              <th key={col.key} className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground text-right">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <td className="px-4 py-3" colSpan={6}><div className="h-4 bg-muted/60 rounded animate-pulse w-full" /></td>
              </tr>
            ))
          ) : (
            reps.map((rep) => (
              <tr key={rep.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={rep.name} size={28} variant="rep" />
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate leading-tight">{rep.name}</p>
                      <StatusDot active={rep.isActive} />
                    </div>
                  </div>
                </td>
                {COLUMNS.map((col) => {
                  const val = rep[col.key] as number;
                  const display = col.currency ? fmtCurrency(val) : val;
                  return (
                    <td key={col.key} className="px-4 py-2 text-right">
                      <button
                        onClick={() => setDrill({ userId: rep.id, rep: rep.name, metric: col.drill, label: col.label })}
                        className="ml-auto inline-flex items-center rounded-[6px] px-2 py-1 tabular-nums text-sm text-foreground/80 hover:bg-primary/[0.07] hover:text-primary transition-colors cursor-pointer"
                        title={`See ${rep.name}'s ${col.label.toLowerCase()}`}
                      >
                        {display}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {!isLoading && reps.length === 0 && (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">No activity in this period.</div>
      )}

      {drill && (
        <DrilldownDrawer
          userId={drill.userId}
          rep={drill.rep}
          metric={drill.metric}
          label={drill.label}
          queryParams={queryParams}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}

// ─── Drill-down drawer — the records behind a number ──────────────────────────

function DrilldownDrawer({
  userId, rep, metric, label, queryParams, onClose,
}: { userId: string; rep: string; metric: string; label: string; queryParams: string; onClose: () => void }) {
  const { data, isLoading } = useQuery<{ items: DrillItem[] }>({
    queryKey: ["rep-drilldown", userId, metric, queryParams],
    queryFn: () => fetch(`/api/dashboard/rep-performance/drilldown?userId=${userId}&metric=${metric}&${queryParams}`).then((r) => r.json()),
  });
  const items = data?.items ?? [];
  const isMoney = metric === "closed";
  const total = isMoney ? items.reduce((s, i) => s + (i.amount ?? 0), 0) : items.length;

  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      <div className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 h-full w-[440px] max-w-[92vw] bg-card border-l border-border shadow-2xl flex flex-col" role="dialog" aria-modal="true">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border shrink-0">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{rep} · {label}</p>
            <p className="text-[15px] font-semibold text-foreground mt-0.5" style={{ fontFamily: "var(--font-heading)" }}>
              {isMoney ? fmtCurrency(total) : `${total} ${label.toLowerCase()}`}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 -mr-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {isLoading ? (
            <div className="p-5 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-12 rounded-[8px] bg-muted/50 animate-pulse" />)}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6 py-16">
              <p className="text-sm font-medium text-foreground mb-1">Nothing to show</p>
              <p className="text-xs text-muted-foreground">No {label.toLowerCase()} for {rep} in this period.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border/50">
              {items.map((it) => {
                const Row = (
                  <div className="flex items-center gap-3 px-5 py-2.5 hover:bg-muted/20 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-foreground truncate">{it.title}</p>
                      {it.sub && <p className="text-[11px] text-muted-foreground truncate">{it.sub}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      {it.amount != null && <p className="text-[13px] font-semibold tabular-nums text-foreground">{fmtCurrency(it.amount)}</p>}
                      {it.date && <p className="text-[10.5px] text-muted-foreground/70">{relativeTime(it.date)}</p>}
                    </div>
                    {it.href && <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />}
                  </div>
                );
                return (
                  <li key={it.id}>
                    {it.href ? <a href={it.href} target="_blank" rel="noopener noreferrer" className="block">{Row}</a> : Row}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
