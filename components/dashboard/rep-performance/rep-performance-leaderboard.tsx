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
  demos: number;
  proposalsSent: number;
  dealsClosed: number;
  closedValue: number;
  openLeads: number;

  // Setter
  callsBooked: number;
  callsShowed: number;
  showRate: number | null;

  // Closer — attributed via proposals.closedBy, so an override moves the credit with the deal
  dealsClosedAttributed: number;
  closedValueAttributed: number;
  closeRate: number | null;
  avgDealSize: number | null;
  cohortClosed: number;

  commissionPct: number;
  commissionEarned: number;
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

type Col = {
  key: keyof RepRow;
  label: string;
  drill: string;
  currency?: boolean;
  percent?: boolean;
  /** Rendered heavier — the number this role is actually judged on. */
  headline?: boolean;
  hint?: string;
};

/**
 * A setter creates qualified pipeline; a closer converts it to revenue. Ranking them on one set
 * of columns flatters neither: a setter cannot control close rate, a closer cannot control dial
 * volume. So each role gets the metrics it is genuinely accountable for, and one headline.
 */
const SETTER_COLUMNS: Col[] = [
  { key: "calls", label: "Calls", drill: "calls", hint: "Calls this rep was on" },
  { key: "callsBooked", label: "Booked", drill: "booked", headline: true, hint: "Calls they set for a closer" },
  // Demos CREATED. Attribution starts 2026-08-07 — nothing before that recorded who submitted a
  // demo, so earlier periods legitimately read 0 for everyone.
  { key: "demos", label: "Demos", drill: "demos", hint: "Demos submitted through the system" },
  { key: "showRate", label: "Show", drill: "booked", percent: true, hint: "Of the calls they booked, how many were attended" },
  { key: "openLeads", label: "Open", drill: "open", hint: "Open opportunities assigned to them" },
];

const CLOSER_COLUMNS: Col[] = [
  { key: "proposalsSent", label: "Proposals", drill: "proposals", hint: "Proposals sent" },
  { key: "dealsClosedAttributed", label: "Closed", drill: "closed", hint: "Deals closed" },
  { key: "closedValueAttributed", label: "Revenue", drill: "closed", currency: true, headline: true, hint: "Revenue from deals they closed" },
  { key: "closeRate", label: "Close", drill: "proposals", percent: true, hint: "Of the proposals they sent this period, how many signed" },
  { key: "avgDealSize", label: "Avg deal", drill: "closed", currency: true, hint: "Average value of a closed deal" },
  { key: "commissionEarned", label: "Commission", drill: "closed", currency: true, hint: "Earned at their current rate" },
];

/** Admins work as closers, so route on what they DO rather than the raw role string. */
const isSetter = (r: RepRow) => r.role === "setter";

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
    <div data-r10n-card className="bg-card border border-border rounded-[10px] overflow-hidden shrink-0">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div>
          <h3 data-r10n-section-title className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>Rep Performance</h3>
          <p className="text-[10.5px] text-muted-foreground/70 mt-0.5">Click any number to verify the records behind it</p>
        </div>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      {isLoading ? (
        <div className="px-4 py-4 space-y-2.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-9 bg-muted/50 rounded-[8px] animate-pulse" style={{ animationDelay: `${i * 70}ms` }} />
          ))}
        </div>
      ) : (
        <>
          <RepTable
            title="Closers"
            caption="Judged on conversion and revenue"
            reps={reps.filter((r) => !isSetter(r))}
            columns={CLOSER_COLUMNS}
            onDrill={setDrill}
          />
          <RepTable
            title="Setters"
            caption="Judged on the pipeline they create"
            reps={reps.filter(isSetter)}
            columns={SETTER_COLUMNS}
            onDrill={setDrill}
          />
        </>
      )}

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
  const { data, isLoading } = useQuery<{ items: DrillItem[]; total?: number }>({
    queryKey: ["rep-drilldown", userId, metric, queryParams],
    queryFn: () => fetch(`/api/dashboard/rep-performance/drilldown?userId=${userId}&metric=${metric}&${queryParams}`).then((r) => r.json()),
  });
  const items = data?.items ?? [];
  const isMoney = metric === "closed";
  // Count comes from the server's `total` (for "open" it's GHL's reliable filtered
  // total and matches the leaderboard). $ Closed sums the amounts in the list.
  const count = data?.total ?? items.length;
  const total = isMoney ? items.reduce((s, i) => s + (i.amount ?? 0), 0) : count;
  // The "open" list is a capped sample; everything else shows the full set.
  const isSample = items.length < count;

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
            <>
            {isSample && (
              <p className="px-5 py-2.5 text-[11px] text-muted-foreground bg-muted/20 border-b border-border/50">
                Showing the {items.length} most recent of {count.toLocaleString()} open leads.
              </p>
            )}
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
            </>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

/** One role's table. Kept as a single component so both roles stay visually identical and can
 *  never drift apart — only the columns differ, which is the whole point of the split. */
function RepTable({
  title,
  caption,
  reps,
  columns,
  onDrill,
}: {
  title: string;
  caption: string;
  reps: RepRow[];
  columns: Col[];
  onDrill: (d: { userId: string; rep: string; metric: string; label: string }) => void;
}) {
  if (reps.length === 0) return null;
  return (
    <div className="border-b border-border last:border-0">
      <div className="px-4 pt-3 pb-1.5 flex items-baseline gap-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/70">{title}</h4>
        <span className="text-[10.5px] text-muted-foreground/60">{caption}</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/70">
            <th data-r10n-th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Rep</th>
            {columns.map((col) => (
              <th
                key={String(col.key)}
                data-r10n-th
                title={col.hint}
                className={cn(
                  "px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-right",
                  col.headline ? "text-foreground/80" : "text-muted-foreground",
                )}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {reps.map((rep) => (
            <tr key={rep.id} className="border-b border-border/60 last:border-0 hover:bg-muted/20 transition-colors">
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2.5">
                  <Avatar name={rep.name} size={28} variant="rep" />
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate leading-tight">{rep.name}</p>
                    <StatusDot active={rep.isActive} />
                  </div>
                </div>
              </td>
              {columns.map((col) => {
                const raw = rep[col.key] as number | null;
                // A rate with no denominator is unknown, not zero — an em dash says so honestly
                // rather than implying a 0% close rate for someone who sent no proposals.
                const display =
                  raw == null ? "—" : col.currency ? fmtCurrency(raw) : col.percent ? `${raw}%` : raw;
                return (
                  <td key={String(col.key)} className="px-4 py-1.5 text-right">
                    <button
                      data-demo={`rep-cell-${col.drill}`}
                      onClick={() => onDrill({ userId: rep.id, rep: rep.name, metric: col.drill, label: col.label })}
                      className={cn(
                        "ml-auto inline-flex items-center rounded-[6px] px-2 py-1 tabular-nums transition-colors cursor-pointer",
                        "hover:bg-primary/[0.07] hover:text-primary",
                        col.headline ? "text-sm font-semibold text-foreground" : "text-sm text-foreground/80",
                      )}
                      title={`See ${rep.name}'s ${col.label.toLowerCase()}`}
                    >
                      {display}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
