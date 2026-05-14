"use client";

import { useState, useMemo } from "react";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import {
  AreaChart, Area, ResponsiveContainer, Tooltip,
} from "recharts";
import { cn } from "@/lib/utils/cn";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BusinessMetrics {
  cashCollected: number;
  mrr: number;
  processingFees: number;
  refunds: number;
  totalValueAddLoss: number;
  managementClients: number;
  activeProjectClients: number;
  newManagementCount: number;
  newManagementValue: number;
  newProjectCount: number;
  newProjectValue: number;
  clientChurnCount: number;
  clientChurnValue: number;
  outstanding: number;
  outstandingOverdue: number;
  failedPayments: number;
  valueOfProposalsSent: number;
}

interface SourceRow {
  source: string;
  stages: Record<string, number>;
  total: number;
}

interface RecentDemo {
  id: string;
  name: string;
  status: string;
  statusColor: string;
  dateCreated: number;
  url: string;
}

interface OfferMetrics {
  stageBreakdown: SourceRow[];
  stageNames: string[];
  demosCompleted: number;
  recentDemos: RecentDemo[];
  cashCollected: number;
  adSpend: number;
  roas: number;
  valueOfProposalsSent: number;
  newClientsCount: number;
  costOfProposal: number;
  cac: number;
  totalFulfillmentCost: number;
}

// ─── Date range logic ─────────────────────────────────────────────────────────

type Preset = "today" | "yesterday" | "7d" | "30d" | "mtd" | "last_month" | "qtd" | "ytd" | "month" | "custom";

interface ActiveRange {
  start: string; // YYYY-MM-DD (inclusive)
  end: string;   // YYYY-MM-DD (exclusive — day after last)
  label: string;
}

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const PRESETS: { id: Preset; label: string }[] = [
  { id: "today",      label: "Today" },
  { id: "yesterday",  label: "Yesterday" },
  { id: "7d",         label: "7D" },
  { id: "30d",        label: "30D" },
  { id: "mtd",        label: "MTD" },
  { id: "last_month", label: "Last Mo" },
  { id: "qtd",        label: "QTD" },
  { id: "ytd",        label: "YTD" },
  { id: "month",      label: "Month" },
  { id: "custom",     label: "Custom" },
];

function todayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function computeRange(
  preset: Preset,
  navYear: number,
  navMonth: number,
  customStart: string,
  customEnd: string
): ActiveRange | null {
  const today = todayUTC();
  const tomorrow = addDays(today, 1);

  switch (preset) {
    case "today":
      return { start: toYMD(today), end: toYMD(tomorrow), label: "Today" };

    case "yesterday": {
      const yest = addDays(today, -1);
      return { start: toYMD(yest), end: toYMD(today), label: "Yesterday" };
    }

    case "7d":
      return { start: toYMD(addDays(today, -6)), end: toYMD(tomorrow), label: "Last 7 Days" };

    case "30d":
      return { start: toYMD(addDays(today, -29)), end: toYMD(tomorrow), label: "Last 30 Days" };

    case "mtd": {
      const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      return { start: toYMD(first), end: toYMD(tomorrow), label: "Month to Date" };
    }

    case "last_month": {
      const firstLast = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      const firstThis = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      return { start: toYMD(firstLast), end: toYMD(firstThis), label: "Last Month" };
    }

    case "qtd": {
      const qm = Math.floor(today.getUTCMonth() / 3) * 3;
      const firstQ = new Date(Date.UTC(today.getUTCFullYear(), qm, 1));
      return { start: toYMD(firstQ), end: toYMD(tomorrow), label: "Quarter to Date" };
    }

    case "ytd": {
      const jan1 = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
      return { start: toYMD(jan1), end: toYMD(tomorrow), label: "Year to Date" };
    }

    case "month": {
      const s = new Date(Date.UTC(navYear, navMonth - 1, 1));
      const e = new Date(Date.UTC(navYear, navMonth, 1));
      return { start: toYMD(s), end: toYMD(e), label: `${MONTHS[navMonth - 1]} ${navYear}` };
    }

    case "custom": {
      if (!customStart || !customEnd) return null;
      const endDate = new Date(customEnd + "T00:00:00.000Z");
      return {
        start: customStart,
        end: toYMD(addDays(endDate, 1)),
        label: `${customStart} – ${customEnd}`,
      };
    }
  }
}

// Returns the last `n` YYYY-MM strings ending at (and including) `current`
function pastPeriods(current: string, n: number): string[] {
  const [y, m] = current.split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    let mm = m - i;
    let yy = y;
    while (mm <= 0) { mm += 12; yy--; }
    out.push(`${yy}-${String(mm).padStart(2, "0")}`);
  }
  return out;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtUSD(val: number): string {
  if (val === 0) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(val);
}

function fmtNum(val: number): string {
  return new Intl.NumberFormat("en-US").format(val);
}

function fmtX(val: number): string {
  return `${val.toFixed(2)}x`;
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ values, positive = true }: { values: number[]; positive?: boolean }) {
  if (values.length < 2) return null;
  const data = values.map((v, i) => ({ i, v }));
  const color = positive ? "hsl(142 71% 45%)" : "hsl(0 72% 51%)";
  const id = `sg-${Math.random().toString(36).slice(2)}`;
  return (
    <ResponsiveContainer width="100%" height={36}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.18} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#${id})`}
          dot={false}
          isAnimationActive={false}
        />
        <Tooltip
          content={({ active, payload }) =>
            active && payload?.[0] ? (
              <div className="rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium shadow-sm">
                {fmtUSD(payload[0].value as number)}
              </div>
            ) : null
          }
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── Metric cards ─────────────────────────────────────────────────────────────

interface HeroCardProps {
  label: string;
  value: string;
  sub?: string;
  sparkValues?: number[];
  sparkPositive?: boolean;
  accent?: "green" | "red" | "neutral";
}

function HeroCard({ label, value, sub, sparkValues, sparkPositive = true, accent = "neutral" }: HeroCardProps) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-1 min-h-[120px]">
      <p className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground/70">
        {label}
      </p>
      <p className={cn(
        "text-[2rem] font-bold leading-none tabular-nums tracking-tight mt-1",
        accent === "green" && "text-emerald-600 dark:text-emerald-400",
        accent === "red" && "text-red-600 dark:text-red-400",
        value === "—" && "text-muted-foreground/40",
      )}>
        {value}
      </p>
      {sub && (
        <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
      )}
      {sparkValues && sparkValues.length >= 2 && (
        <div className="mt-auto pt-2">
          <Sparkline values={sparkValues} positive={sparkPositive} />
        </div>
      )}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  accent?: "green" | "red" | "neutral";
}

function StatCard({ label, value, sub, accent = "neutral" }: StatCardProps) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-1">
      <p className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground/70">
        {label}
      </p>
      <p className={cn(
        "text-xl font-semibold leading-none tabular-nums tracking-tight mt-1",
        accent === "green" && "text-emerald-600 dark:text-emerald-400",
        accent === "red" && "text-red-600 dark:text-red-400",
        value === "—" && "text-muted-foreground/40",
      )}>
        {value}
      </p>
      {sub && (
        <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
      )}
    </div>
  );
}

function SectionHeader({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-5">
      <div className="w-1 h-3.5 rounded-full bg-foreground/20" />
      <span className="text-[11px] font-bold tracking-widest uppercase text-muted-foreground">
        {label}
      </span>
      {sub && (
        <span className="text-[11px] font-medium text-muted-foreground/50 tracking-wide">
          {sub}
        </span>
      )}
      <div className="flex-1 h-px bg-border/60" />
    </div>
  );
}

function SkeletonHero() {
  return (
    <div className="bg-card border border-border rounded-xl p-5 min-h-[120px] space-y-3 animate-pulse">
      <div className="h-2 w-24 rounded bg-muted" />
      <div className="h-8 w-32 rounded bg-muted" />
    </div>
  );
}

function SkeletonStat() {
  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-2.5 animate-pulse">
      <div className="h-2 w-20 rounded bg-muted" />
      <div className="h-5 w-24 rounded bg-muted" />
    </div>
  );
}

// ─── Business Metrics ─────────────────────────────────────────────────────────

function BusinessMetricsSection({
  start,
  end,
  sparkPeriod,
}: {
  start: string;
  end: string;
  sparkPeriod: string;
}) {
  // Main data query for the active date range
  const { data, isLoading } = useQuery<BusinessMetrics>({
    queryKey: ["kpis-business", start, end],
    queryFn: async () => {
      const res = await fetch(`/api/kpis/business?start=${start}&end=${end}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  // Sparkline queries — always monthly, last 6 months
  const periods6 = useMemo(() => pastPeriods(sparkPeriod, 6), [sparkPeriod]);
  const sparkQueries = useQueries({
    queries: periods6.map((p) => ({
      queryKey: ["kpis-business-spark", p],
      queryFn: async (): Promise<BusinessMetrics> => {
        const res = await fetch(`/api/kpis/business?period=${p}`);
        if (!res.ok) throw new Error("Failed");
        return res.json();
      },
      staleTime: 10 * 60 * 1000,
    })),
  });

  function spark(key: keyof BusinessMetrics): number[] {
    return sparkQueries.map((q) => (q.data ? (q.data[key] as number) : 0));
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <SectionHeader label="Business Metrics" />
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonHero key={i} />)}
        </div>
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonStat key={i} />)}
        </div>
      </div>
    );
  }

  const tvPositive = data.totalValueAddLoss >= 0;

  return (
    <div>
      <SectionHeader label="Business Metrics" />

      {/* Hero row */}
      <div className="grid grid-cols-4 gap-3 mb-3">
        <HeroCard
          label="Cash Collected"
          value={fmtUSD(data.cashCollected)}
          sparkValues={spark("cashCollected")}
          sparkPositive
        />
        <HeroCard
          label="MRR"
          value={fmtUSD(data.mrr)}
          sparkValues={spark("mrr")}
          sparkPositive
        />
        <HeroCard
          label="Client Churn Value"
          value={fmtUSD(data.clientChurnValue)}
          sub={data.clientChurnCount > 0 ? `${data.clientChurnCount} client${data.clientChurnCount !== 1 ? "s" : ""} cancelled` : undefined}
          sparkValues={spark("clientChurnValue")}
          sparkPositive={false}
          accent={data.clientChurnValue > 0 ? "red" : "neutral"}
        />
        <HeroCard
          label="Total Value Add / Loss"
          value={data.totalValueAddLoss === 0 ? "—" : `${tvPositive ? "+" : ""}${fmtUSD(Math.abs(data.totalValueAddLoss))}`}
          sparkValues={spark("totalValueAddLoss")}
          sparkPositive={tvPositive}
          accent={data.totalValueAddLoss > 0 ? "green" : data.totalValueAddLoss < 0 ? "red" : "neutral"}
        />
      </div>

      {/* Client counts */}
      <div className="grid grid-cols-4 gap-3 mb-3">
        <StatCard
          label="Management Clients"
          value={fmtNum(data.managementClients)}
          sub={data.newManagementCount > 0 ? `+${data.newManagementCount} this period` : "No new clients"}
        />
        <StatCard
          label="Active Project Clients"
          value={fmtNum(data.activeProjectClients)}
          sub={data.newProjectCount > 0 ? `+${data.newProjectCount} this period` : "No new clients"}
        />
        <StatCard
          label="New Management Value"
          value={fmtUSD(data.newManagementValue)}
          sub={data.newManagementCount > 0 ? `${data.newManagementCount} signed` : undefined}
          accent={data.newManagementValue > 0 ? "green" : "neutral"}
        />
        <StatCard
          label="New Project Value"
          value={fmtUSD(data.newProjectValue)}
          sub={data.newProjectCount > 0 ? `${data.newProjectCount} signed` : undefined}
          accent={data.newProjectValue > 0 ? "green" : "neutral"}
        />
      </div>

      {/* Pipeline + costs */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard
          label="Outstanding"
          value={fmtUSD(data.outstanding)}
          sub={data.outstandingOverdue > 0 ? `${fmtUSD(data.outstandingOverdue)} overdue` : "No overdue amounts"}
          accent={data.outstandingOverdue > 0 ? "red" : "neutral"}
        />
        <StatCard
          label="Failed Payments"
          value={fmtUSD(data.failedPayments)}
          accent={data.failedPayments > 0 ? "red" : "neutral"}
        />
        <StatCard
          label="Processing Fees"
          value={fmtUSD(data.processingFees)}
        />
        <StatCard
          label="Refunds Issued"
          value={fmtUSD(data.refunds)}
          accent={data.refunds > 0 ? "red" : "neutral"}
        />
        <StatCard
          label="Value of Proposals Sent"
          value={fmtUSD(data.valueOfProposalsSent)}
        />
        <StatCard
          label="Client Churn Count"
          value={data.clientChurnCount > 0 ? fmtNum(data.clientChurnCount) : "—"}
          accent={data.clientChurnCount > 0 ? "red" : "neutral"}
        />
      </div>
    </div>
  );
}

// ─── Offer Metrics ────────────────────────────────────────────────────────────

function OfferMetricsSection({
  start,
  end,
}: {
  start: string;
  end: string;
}) {
  const { data, isLoading } = useQuery<OfferMetrics>({
    queryKey: ["kpis-offer", start, end],
    queryFn: async () => {
      const res = await fetch(`/api/kpis/offer?start=${start}&end=${end}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading || !data) {
    return (
      <div>
        <SectionHeader label="Offer Metrics" sub="Free Email Design" />
        <div className="grid grid-cols-4 gap-3 mb-3">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonStat key={i} />)}
        </div>
      </div>
    );
  }



  const roasGood = data.adSpend > 0 && data.roas >= 3;
  const roasBad = data.adSpend > 0 && data.roas < 1;

  return (
    <div>
      <SectionHeader label="Offer Metrics" sub="Free Email Design" />

      {/* Key offer numbers */}
      <div className="grid grid-cols-4 gap-3 mb-3">
        <HeroCard
          label="ROAS"
          value={data.adSpend > 0 ? fmtX(data.roas) : "—"}
          sub={data.adSpend > 0 ? `${fmtUSD(data.cashCollected)} on ${fmtUSD(data.adSpend)} spend` : "No ad spend recorded"}
          accent={roasGood ? "green" : roasBad ? "red" : "neutral"}
        />
        <HeroCard
          label="Ad Spend"
          value={fmtUSD(data.adSpend)}
        />
        <HeroCard
          label="Cash Collected"
          value={fmtUSD(data.cashCollected)}
          sub={data.newClientsCount > 0 ? `${data.newClientsCount} new client${data.newClientsCount !== 1 ? "s" : ""}` : undefined}
          accent={data.cashCollected > 0 ? "green" : "neutral"}
        />
        <HeroCard
          label="Demos Completed"
          value={data.demosCompleted > 0 ? fmtNum(data.demosCompleted) : "—"}
          sub={data.demosCompleted > 0 ? `${fmtUSD(data.totalFulfillmentCost)} fulfillment cost` : undefined}
        />
      </div>

      <div className="grid grid-cols-4 gap-3 mb-5">
        <StatCard
          label="Cost per Acquired Customer"
          value={data.cac > 0 ? fmtUSD(data.cac) : "—"}
        />
        <StatCard
          label="Cost of Proposal"
          value={data.costOfProposal > 0 ? fmtUSD(data.costOfProposal) : "—"}
        />
        <StatCard
          label="Value of Proposals Sent"
          value={fmtUSD(data.valueOfProposalsSent)}
        />
        <StatCard
          label="Fulfillment Cost"
          value={fmtUSD(data.totalFulfillmentCost)}
          sub={data.demosCompleted > 0 ? `${data.demosCompleted} demos × $30` : undefined}
        />
      </div>

      {/* Recent demos submitted */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b border-border">
          <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground/70">
            Recent Demos Submitted
          </p>
        </div>
        {data.recentDemos.length > 0 ? (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/30">
                <th className="text-left px-5 py-2.5 text-[10px] font-bold text-muted-foreground tracking-widest uppercase">Client</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-bold text-muted-foreground tracking-widest uppercase">Status</th>
                <th className="text-right px-5 py-2.5 text-[10px] font-bold text-muted-foreground tracking-widest uppercase">Date</th>
              </tr>
            </thead>
            <tbody>
              {data.recentDemos.map((demo) => (
                <tr key={demo.id} className="border-t border-border hover:bg-muted/20 transition-colors">
                  <td className="px-5 py-3 font-medium text-foreground">
                    <a href={demo.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      {demo.name}
                    </a>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
                      style={{ backgroundColor: demo.statusColor + "22", color: demo.statusColor }}
                    >
                      {demo.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-muted-foreground text-xs">
                    {new Date(demo.dateCreated).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-muted-foreground">No demos submitted in this period.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export function KpisClient() {
  const now = new Date();

  const [preset, setPreset] = useState<Preset>("month");
  const [navYear, setNavYear] = useState(now.getFullYear());
  const [navMonth, setNavMonth] = useState(now.getMonth() + 1);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [syncState, setSyncState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [syncSummary, setSyncSummary] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Sparklines always reflect last 6 calendar months from today
  const sparkPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const activeRange = useMemo(
    () => computeRange(preset, navYear, navMonth, customStart, customEnd),
    [preset, navYear, navMonth, customStart, customEnd]
  );

  const isCurrentMonth = navYear === now.getFullYear() && navMonth === now.getMonth() + 1;

  function prevMonth() {
    if (navMonth === 1) { setNavMonth(12); setNavYear((y) => y - 1); }
    else setNavMonth((m) => m - 1);
  }

  function nextMonth() {
    if (isCurrentMonth) return;
    if (navMonth === 12) { setNavMonth(1); setNavYear((y) => y + 1); }
    else setNavMonth((m) => m + 1);
  }

  return (
    <div className="px-6 py-6 space-y-8 max-w-[1400px] mx-auto">

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground/60 mb-1">
            Kracked Retention
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">KPIs</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Business and offer performance across all channels.
          </p>
        </div>

        {/* Stripe sync */}
        <div className="flex flex-col items-end gap-1 shrink-0 pt-1">
          <button
            onClick={async () => {
              setSyncState("running");
              setSyncSummary(null);
              try {
                const res = await fetch("/api/stripe/backfill", { method: "POST" });
                const json = await res.json();
                if (!res.ok) throw new Error(json.error ?? "Failed");
                const s = json.summary;
                setSyncSummary(
                  `${s.proposalsUpdated} proposals · ${s.instalmentsUpdated} instalments · ${s.cancellationsRecorded} cancellations`
                );
                setSyncState("done");
                // Bust all KPI caches so metrics refresh
                queryClient.invalidateQueries({ queryKey: ["kpis-business"] });
                queryClient.invalidateQueries({ queryKey: ["kpis-business-spark"] });
                queryClient.invalidateQueries({ queryKey: ["kpis-offer"] });
              } catch (e) {
                setSyncSummary((e as Error).message);
                setSyncState("error");
              }
            }}
            disabled={syncState === "running"}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              syncState === "done"
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : syncState === "error"
                ? "bg-red-50 text-red-700 border border-red-200"
                : "bg-muted text-muted-foreground hover:text-foreground border border-border"
            )}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", syncState === "running" && "animate-spin")} />
            {syncState === "running" ? "Syncing…" : syncState === "done" ? "Synced" : syncState === "error" ? "Error" : "Sync Stripe"}
          </button>
          {syncSummary && (
            <p className="text-[11px] text-muted-foreground/70 text-right max-w-[240px]">
              {syncSummary}
            </p>
          )}
        </div>
      </div>

      {/* ── Date filters ─────────────────────────────────────────────────── */}
      <div className="space-y-3">
        {/* Preset chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {PRESETS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setPreset(id)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                preset === id
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}

          {/* Active label badge */}
          {activeRange && preset !== "month" && preset !== "custom" && (
            <span className="ml-2 text-xs text-muted-foreground/60 tabular-nums">
              {activeRange.start} → {new Date(activeRange.end + "T00:00:00.000Z").toISOString().slice(0, 10) === activeRange.end
                ? new Date(new Date(activeRange.end + "T00:00:00.000Z").getTime() - 86400000).toISOString().slice(0, 10)
                : activeRange.end}
            </span>
          )}
        </div>

        {/* Month navigator — shown when preset is "month" */}
        {preset === "month" && (
          <div className="flex items-center gap-2">
            <button
              onClick={prevMonth}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold w-36 text-center tabular-nums">
              {MONTHS[navMonth - 1]} {navYear}
            </span>
            <button
              onClick={nextMonth}
              disabled={isCurrentMonth}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Custom date inputs — shown when preset is "custom" */}
        {preset === "custom" && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-muted-foreground">From</label>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="h-8 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <input
                type="date"
                value={customEnd}
                min={customStart}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="h-8 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {customStart && customEnd && (
              <span className="text-xs text-muted-foreground/60">
                {customStart} – {customEnd}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Sections ─────────────────────────────────────────────────────── */}
      {activeRange ? (
        <>
          <BusinessMetricsSection
            start={activeRange.start}
            end={activeRange.end}
            sparkPeriod={sparkPeriod}
          />
          <OfferMetricsSection
            start={activeRange.start}
            end={activeRange.end}
          />
        </>
      ) : (
        <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
          Select a start and end date to view metrics.
        </div>
      )}
    </div>
  );
}
