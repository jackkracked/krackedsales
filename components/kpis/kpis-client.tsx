"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { RefreshCw, Shield, Settings2, Plus, X, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { format, startOfMonth, addMonths } from "date-fns";
import { MetricSection } from "./metric-section";
import { MetricCell, fmtCurrency, fmtNumber, type MetricDef, fmtValue } from "./metric-cell";
import { KpiDetailSheet } from "./KpiDetailSheet";
import { DateRangePicker } from "@/components/ui/date-range-picker";

// ─── Metric definitions per section ───────────────────────────────────────────

const BUSINESS_METRICS: MetricDef[] = [
  { key: "cashCollected", label: "Cash Collected", unit: "currency" },
  { key: "outstandingPayments", label: "Outstanding Payments", unit: "currency", accent: "negative" },
  { key: "outstanding", label: "Outstanding Proposals", unit: "currency" },
  { key: "totalMrr", label: "Total MRR", unit: "currency" },
  { key: "totalExpenses", label: "Total Expenses", unit: "currency" },
  { key: "netPL", label: "Net P/L", unit: "currency" },
];

const MANAGEMENT_METRICS: MetricDef[] = [
  { key: "managementMrr", label: "Management MRR", unit: "currency" },
  { key: "newManagementMrr", label: "New Management MRR", unit: "currency", accent: "positive" },
  { key: "churnedManagementMrr", label: "Churned Management MRR", unit: "currency", accent: "negative" },
  { key: "managementClients", label: "# Management Clients", unit: "count" },
  { key: "clientRetentionRate", label: "Client Retention Rate", unit: "percent" },
];

const PROJECT_METRICS: MetricDef[] = [
  { key: "newProjectValue", label: "New Project Value", unit: "currency", accent: "positive" },
  { key: "activeProjects", label: "# Active Projects", unit: "count", manual: true },
];

const SALES_METRICS: MetricDef[] = [
  { key: "mgmtProposalValueSent", label: "Mgmt Proposal Value Sent", unit: "currency" },
  { key: "mgmtProposalValueLost", label: "Mgmt Proposal Value Lost", unit: "currency", accent: "negative" },
  { key: "projProposalValueSent", label: "Project Proposal Value Sent", unit: "currency" },
  { key: "projProposalValueLost", label: "Project Proposal Value Lost", unit: "currency", accent: "negative" },
  { key: "adSpendMeta", label: "Meta Ad Spend", unit: "currency" },
  { key: "adSpendTiktok", label: "TikTok Ad Spend", unit: "currency" },
];

// Funnel metrics grouped by stage for scannable comparison
const FUNNEL_GROUPS: { label: string; metrics: MetricDef[] }[] = [
  {
    label: "Acquisition",
    metrics: [
      { key: "leads", label: "Leads", unit: "count" },
      { key: "adSpend", label: "Ad Spend", unit: "currency" },
      { key: "cpl", label: "CPL", unit: "currency" },
    ],
  },
  {
    label: "Conversion",
    metrics: [
      { key: "bookedCalls", label: "Booked Calls", unit: "count" },
      { key: "bookingRate", label: "Booking Rate", unit: "percent" },
      { key: "costPerBookedCall", label: "Cost / Booked Call", unit: "currency" },
    ],
  },
  {
    label: "Fulfillment",
    metrics: [
      { key: "demosSubmitted", label: "Demos Submitted", unit: "count" },
      { key: "demosCompleted", label: "Demos Completed", unit: "count" },
      { key: "costPerDemoCompleted", label: "Cost / Demo", unit: "currency" },
      { key: "auditsRequested", label: "Audits Requested", unit: "count" },
      { key: "auditsCompleted", label: "Audits Completed", unit: "count" },
    ],
  },
  {
    label: "Revenue",
    metrics: [
      { key: "cashCollected", label: "Cash Collected", unit: "currency" },
      { key: "roas", label: "ROAS", unit: "ratio" },
    ],
  },
  {
    label: "Proposals",
    metrics: [
      { key: "mgmtProposalValueSent", label: "Mgmt Sent", unit: "currency" },
      { key: "mgmtProposalValueLost", label: "Mgmt Lost", unit: "currency", accent: "negative" },
      { key: "projProposalValueSent", label: "Project Sent", unit: "currency" },
      { key: "projProposalValueLost", label: "Project Lost", unit: "currency", accent: "negative" },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toYMD(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

interface ActiveRange {
  start: string;
  end: string;
  label: string;
  preset?: string;
}

/**
 * Month-to-date range from the *current* moment in the browser's local timezone.
 * Computed at call time (never frozen at build), so it always reflects "today".
 * `end` is exclusive (first of next month) to match the metrics API.
 */
function monthToDateRange(): ActiveRange {
  const now = new Date();
  return {
    start: toYMD(startOfMonth(now)),
    end: toYMD(addMonths(startOfMonth(now), 1)),
    label: "Month to Date",
    preset: "mtd",
  };
}

interface OfferFunnel {
  id: string;
  name: string;
  pipelineIds: string[];
  campaignFilter: string | null;
  adPlatform: string;
}

const SECTION_ACCENTS = {
  business: "oklch(0.45 0.12 250)",
  management: "oklch(0.50 0.12 170)",
  project: "oklch(0.55 0.15 85)",
  sales: "oklch(0.45 0.12 300)",
  offer: "oklch(0.55 0.12 25)",
};

// ─── Main component ───────────────────────────────────────────────────────────

export function KpisClient() {
  const queryClient = useQueryClient();

  const [dateRange, setDateRange] = useState<ActiveRange>(monthToDateRange);

  // The default range is computed during SSR/static prerender, where `new Date()`
  // is the server's clock (UTC) — or, for a cached page, the build date. That can
  // leave the filter stuck on a previous month. Re-derive it on the client after
  // mount so it always tracks the real "today" in the user's local timezone.
  useEffect(() => {
    setDateRange((prev) => {
      if (prev.preset !== "mtd") return prev; // user picked a custom range — leave it
      const fresh = monthToDateRange();
      return fresh.start === prev.start && fresh.end === prev.end ? prev : fresh;
    });
  }, []);

  const [syncState, setSyncState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [syncSummary, setSyncSummary] = useState("");
  const [detailMetric, setDetailMetric] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ─── Fetch evergreen metrics ──────────────────────────────────────────────
  const metricsQuery = useQuery({
    queryKey: ["kpi-metrics", dateRange.start, dateRange.end],
    queryFn: async () => {
      const res = await fetch(`/api/kpis/metrics?start=${dateRange.start}&end=${dateRange.end}`);
      if (!res.ok) throw new Error("Failed to fetch metrics");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  // ─── Fetch offer funnels ──────────────────────────────────────────────────
  const funnelsQuery = useQuery<{ funnels: OfferFunnel[] }>({
    queryKey: ["offer-funnels"],
    queryFn: async () => {
      const res = await fetch("/api/kpis/offer-funnels");
      if (!res.ok) throw new Error("Failed to fetch funnels");
      return res.json();
    },
    staleTime: 60 * 1000,
  });

  const funnels = funnelsQuery.data?.funnels ?? [];
  const data = metricsQuery.data;
  const loading = metricsQuery.isLoading;

  // ─── Build value maps ─────────────────────────────────────────────────────
  const businessValues = useMemo(() => {
    if (!data?.business) return {};
    const b = data.business;
    return {
      cashCollected: { value: b.cashCollected, spark: b.cashSeries },
      outstandingPayments: {
        value: b.outstandingPayments,
        sub: data._raw?.pastDueInvoiceCount
          ? `${data._raw.pastDueInvoiceCount} invoice${data._raw.pastDueInvoiceCount === 1 ? "" : "s"} past due`
          : "None past due",
      },
      outstanding: { value: b.outstanding },
      totalMrr: { value: b.totalMrr },
      totalExpenses: { value: b.totalExpenses, sub: `Software: ${fmtCurrency(data._raw?.softwareCosts)} · Manual: ${fmtCurrency(data._raw?.manualExpenses)} · Fees: ${fmtCurrency(data._raw?.processingFees)} · Refunds: ${fmtCurrency(data._raw?.refunds)}` },
      netPL: { value: b.netPL, sub: b.netPL >= 0 ? "Profitable" : "Net loss" },
    };
  }, [data]);

  const managementValues = useMemo(() => {
    if (!data?.management) return {};
    const m = data.management;
    return {
      managementMrr: { value: m.managementMrr },
      newManagementMrr: { value: m.newManagementMrr, sub: `${data._raw?.newManagementCount ?? 0} new` },
      churnedManagementMrr: { value: m.churnedManagementMrr, sub: `${data._raw?.clientChurnCount ?? 0} churned` },
      managementClients: { value: m.managementClients },
      clientRetentionRate: { value: m.clientRetentionRate },
    };
  }, [data]);

  const projectValues = useMemo(() => {
    if (!data?.project) return {};
    const p = data.project;
    return {
      newProjectValue: { value: p.newProjectValue, spark: p.newProjectValueSeries, sub: `${data._raw?.newProjectCount ?? 0} projects` },
      activeProjects: { value: p.activeProjects },
    };
  }, [data]);

  const salesValues = useMemo(() => {
    if (!data?.sales) return {};
    const s = data.sales;
    return {
      mgmtProposalValueSent: { value: s.mgmtProposalValueSent, spark: s.mgmtProposalValueSentSeries },
      mgmtProposalValueLost: { value: s.mgmtProposalValueLost },
      projProposalValueSent: { value: s.projProposalValueSent, spark: s.projProposalValueSentSeries },
      projProposalValueLost: { value: s.projProposalValueLost },
      adSpendMeta: { value: s.adSpendMeta },
      adSpendTiktok: { value: s.adSpendTiktok },
    };
  }, [data]);

  async function handleManualSave(key: string, value: number) {
    const period = dateRange.start.slice(0, 7);
    await fetch("/api/kpi/overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metricKey: key === "activeProjects" ? "active_projects" : key, period, value }),
    });
    queryClient.invalidateQueries({ queryKey: ["kpi-metrics"] });
  }

  async function syncStripe() {
    setSyncState("running");
    try {
      const res = await fetch("/api/stripe/backfill", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      const s = json.summary ?? {};
      setSyncSummary(`Updated ${s.proposalsUpdated ?? 0} proposals, ${s.instalmentsUpdated ?? 0} instalments, ${s.cancellationsRecorded ?? 0} cancellations`);
      setSyncState("done");
      queryClient.invalidateQueries({ queryKey: ["kpi-metrics"] });
    } catch {
      setSyncState("error");
      setSyncSummary("Sync failed");
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">
              Kracked Retention
            </p>
            <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
              KPIs
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Business and offer performance across all channels.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/kpis/health"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground border border-border rounded-[7px] hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              <Shield className="w-3.5 h-3.5" />
              Health
            </Link>
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground border border-border rounded-[7px] hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              <Settings2 className="w-3.5 h-3.5" />
              Edit
            </button>
            <button
              onClick={syncStripe}
              disabled={syncState === "running"}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-[7px] transition-colors",
                syncState === "running"
                  ? "text-muted-foreground border-border cursor-wait"
                  : "text-muted-foreground border-border hover:text-foreground hover:border-foreground/30"
              )}
            >
              <RefreshCw className={cn("w-3.5 h-3.5", syncState === "running" && "animate-spin")} />
              Sync Stripe
            </button>
          </div>
        </div>

        {/* Date picker */}
        <div className="mb-6">
          <DateRangePicker
            value={{ start: dateRange.start, end: dateRange.end, preset: dateRange.preset }}
            onChange={(v: { start: string; end: string; preset?: string }) =>
              setDateRange({ start: v.start, end: v.end, label: v.preset ?? "Custom", preset: v.preset })
            }
          />
        </div>

        {/* Sync feedback */}
        {syncState !== "idle" && (
          <div className={cn(
            "mb-4 px-3 py-2 rounded-[7px] text-xs font-medium",
            syncState === "running" && "bg-muted text-muted-foreground",
            syncState === "done" && "bg-accent-green/10 text-accent-green",
            syncState === "error" && "bg-destructive/10 text-destructive",
          )}>
            {syncState === "running" ? "Syncing Stripe data..." : syncSummary}
          </div>
        )}

        {/* Sections */}
        <MetricSection
          title="Business Metrics"
          metrics={BUSINESS_METRICS}
          values={businessValues}
          loading={loading}
          accent={SECTION_ACCENTS.business}
          onMetricClick={setDetailMetric}
          onManualSave={handleManualSave}
        />

        <MetricSection
          title="Management Metrics"
          metrics={MANAGEMENT_METRICS}
          values={managementValues}
          loading={loading}
          accent={SECTION_ACCENTS.management}
          onMetricClick={setDetailMetric}
        />

        <MetricSection
          title="Project Metrics"
          metrics={PROJECT_METRICS}
          values={projectValues}
          loading={loading}
          accent={SECTION_ACCENTS.project}
          onMetricClick={setDetailMetric}
          onManualSave={handleManualSave}
        />

        <MetricSection
          title="Sales Metrics"
          metrics={SALES_METRICS}
          values={salesValues}
          loading={loading}
          accent={SECTION_ACCENTS.sales}
          onMetricClick={setDetailMetric}
        />

        {/* Offer Funnels */}
        {funnels.map((funnel) => (
          <FunnelSection
            key={funnel.id}
            funnel={funnel}
            dateRange={dateRange}
            onMetricClick={setDetailMetric}
          />
        ))}

        {funnels.length === 0 && !funnelsQuery.isLoading && (
          <div className="mb-6 border border-dashed border-border rounded-[10px] py-8 flex flex-col items-center gap-2">
            <p className="text-sm text-muted-foreground">No offer funnels configured</p>
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add your first offer funnel
            </button>
          </div>
        )}
      </div>

      {detailMetric && (
        <KpiDetailSheet
          metric={detailMetric}
          start={dateRange.start}
          end={dateRange.end}
          periodLabel={dateRange.label}
          onClose={() => setDetailMetric(null)}
        />
      )}

      {settingsOpen && (
        <SettingsPanel
          onClose={() => { setSettingsOpen(false); queryClient.invalidateQueries({ queryKey: ["offer-funnels"] }); }}
        />
      )}
    </div>
  );
}

// ─── Funnel Section ───────────────────────────────────────────────────────────

function FunnelSection({
  funnel,
  dateRange,
  onMetricClick,
}: {
  funnel: OfferFunnel;
  dateRange: ActiveRange;
  onMetricClick: (key: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["kpi-funnel", funnel.id, dateRange.start, dateRange.end],
    queryFn: async () => {
      const res = await fetch(`/api/kpis/funnel?funnelId=${funnel.id}&start=${dateRange.start}&end=${dateRange.end}`);
      if (!res.ok) throw new Error("Failed to fetch funnel metrics");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const metricsData = data?.metrics ?? {};

  return (
    <div className="mb-6">
      {/* Collapsible header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-3 mb-2 px-1 w-full text-left"
      >
        <div className="w-0.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: SECTION_ACCENTS.offer }} />
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-foreground/70 shrink-0" style={{ fontFamily: "var(--font-heading)" }}>
          Offer Metrics
        </h3>
        <span className="text-[11px] text-muted-foreground font-medium">{funnel.name}</span>
        <div className="flex-1 h-px bg-border/60" />
        {collapsed ? <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>

      {!collapsed && (
        <div className="bg-card border border-border rounded-[10px] overflow-hidden">
          {isLoading ? (
            <div className="grid grid-cols-3 sm:grid-cols-5 divide-x divide-y divide-border/40">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="py-3.5 px-4 animate-pulse">
                  <div className="h-2.5 w-16 bg-muted rounded mb-2" />
                  <div className="h-5 w-20 bg-muted rounded" />
                </div>
              ))}
            </div>
          ) : (
            <div>
              {FUNNEL_GROUPS.map((group, gi) => (
                <div key={group.label} className={gi > 0 ? "border-t border-border/40" : ""}>
                  {/* Sub-group label */}
                  <div className="px-4 py-1.5 bg-muted/20">
                    <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/60">
                      {group.label}
                    </p>
                  </div>
                  {/* Metrics in this group — equal-width cells filling the row */}
                  <div
                    className="grid divide-x divide-border/40"
                    style={{ gridTemplateColumns: `repeat(${group.metrics.length}, 1fr)` }}
                  >
                    {group.metrics.map((def) => (
                      <MetricCell
                        key={def.key}
                        def={def}
                        value={metricsData[def.key] ?? null}
                        onClick={onMetricClick ? () => onMetricClick(def.key) : undefined}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Settings Panel ───────────────────────────────────────────────────────────

interface GHLPipeline { id: string; name: string; }

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [newFilter, setNewFilter] = useState("");
  const [selectedPipelineIds, setSelectedPipelineIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  // Live funnel list — stays in sync after create/delete
  const liveFunnelsQuery = useQuery<{ funnels: OfferFunnel[] }>({
    queryKey: ["offer-funnels"],
    queryFn: async () => {
      const res = await fetch("/api/kpis/offer-funnels");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 0, // always fresh in the panel
  });
  const funnels = liveFunnelsQuery.data?.funnels ?? [];

  // Fetch available pipelines
  const pipelinesQuery = useQuery<{ pipelines: GHLPipeline[] }>({
    queryKey: ["ghl-pipelines"],
    queryFn: async () => {
      const res = await fetch("/api/ghl/pipelines");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const pipelines = pipelinesQuery.data?.pipelines ?? [];

  function togglePipeline(id: string) {
    setSelectedPipelineIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }

  async function createFunnel() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await fetch("/api/kpis/offer-funnels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          pipelineIds: selectedPipelineIds,
          campaignFilter: newFilter.trim() || null,
          adPlatform: "meta",
        }),
      });
      setNewName("");
      setNewFilter("");
      setSelectedPipelineIds([]);
      queryClient.invalidateQueries({ queryKey: ["offer-funnels"] });
    } finally {
      setCreating(false);
    }
  }

  async function deleteFunnel(id: string) {
    await fetch(`/api/kpis/offer-funnels/${id}`, { method: "DELETE" });
    queryClient.invalidateQueries({ queryKey: ["offer-funnels"] });
  }

  function pipelineNameById(id: string): string {
    return pipelines.find((p) => p.id === id)?.name ?? id.slice(0, 8);
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-foreground/10 backdrop-blur-[2px]" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[400px] bg-card border-l border-border shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
            KPI Settings
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Offer Funnels</p>

            {/* Existing funnels */}
            {funnels.map((f) => (
              <div key={f.id} className="py-3 border-b border-border/40">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">{f.name}</p>
                  <button onClick={() => deleteFunnel(f.id)} className="text-[10px] text-destructive/60 hover:text-destructive font-medium transition-colors">
                    Remove
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {f.campaignFilter ? `Campaign: ${f.campaignFilter}` : "No campaign filter"}
                </p>
                {(f.pipelineIds as string[]).length > 0 ? (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {(f.pipelineIds as string[]).map((pid) => (
                      <span key={pid} className="inline-flex items-center px-2 py-0.5 rounded-[5px] bg-primary/8 text-[10px] font-medium text-primary">
                        {pipelineNameById(pid)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-amber-600 mt-0.5">No pipelines assigned</p>
                )}
              </div>
            ))}

            {/* Add new funnel */}
            <div className="mt-4 space-y-2.5">
              <p className="text-[10px] font-semibold text-foreground uppercase tracking-wide">New Funnel</p>

              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Funnel name (e.g. Free Design Funnel)"
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[7px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />

              <input type="text" value={newFilter} onChange={(e) => setNewFilter(e.target.value)} placeholder="Campaign filter (e.g. FDF)"
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[7px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />

              {/* Pipeline multi-select */}
              <div>
                <p className="text-[10px] font-medium text-muted-foreground mb-1.5">Pipelines</p>
                {pipelinesQuery.isLoading ? (
                  <p className="text-xs text-muted-foreground">Loading pipelines...</p>
                ) : pipelines.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No pipelines found in GHL</p>
                ) : (
                  <div className="space-y-1 max-h-48 overflow-y-auto border border-border rounded-[7px] p-2">
                    {pipelines.map((p) => {
                      const selected = selectedPipelineIds.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => togglePipeline(p.id)}
                          className={cn(
                            "w-full text-left px-2.5 py-1.5 rounded-[5px] text-xs font-medium transition-colors",
                            selected
                              ? "bg-primary/10 text-primary"
                              : "text-foreground/70 hover:bg-muted/50 hover:text-foreground"
                          )}
                        >
                          <span className="flex items-center gap-2">
                            <span className={cn(
                              "w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors",
                              selected ? "bg-primary border-primary" : "border-border"
                            )}>
                              {selected && (
                                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </span>
                            {p.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {selectedPipelineIds.length > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {selectedPipelineIds.length} pipeline{selectedPipelineIds.length !== 1 ? "s" : ""} selected
                  </p>
                )}
              </div>

              <button onClick={createFunnel} disabled={!newName.trim() || creating}
                className={cn("w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-[7px] transition-colors",
                  newName.trim() && !creating ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-muted text-muted-foreground cursor-not-allowed")}>
                <Plus className="w-3.5 h-3.5" />
                {creating ? "Creating..." : "Add Funnel"}
              </button>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Expenses</p>
            <p className="text-xs text-muted-foreground mb-2">Manual expenses feed into Total Expenses and Net P/L.</p>
            <Link href="/settings" className="text-xs font-medium text-primary hover:text-primary/80 transition-colors">
              Manage in Settings
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
