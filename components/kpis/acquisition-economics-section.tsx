"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Check, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Tip } from "@/components/money/tip";
import { fmtMoney, fmtRatio } from "@/components/money/format";
import {
  computeTiers, blendedTargetCac, blendedBreakevenCac,
  blendedContributionPerClient, blendedLtvPerClient,
  type Assumptions, type TierEconomics,
} from "@/lib/unit-economics/model";

/**
 * The spec's acquisition-efficiency KPIs, surfaced on the KPI dashboard (§5) — admin-only,
 * because the same engine also powers the sensitive company P&L. This shows only the
 * acquisition side (cost to acquire vs what a client is worth); the full editable model and
 * the whole-business P&L live on /money, which this links to. Numbers come from the exact same
 * pure engine as /money, so the two surfaces can never disagree.
 */
const WINDOWS = [30, 60, 90] as const;
interface Live {
  realized: { cac: number | null; adSpend: number; newClients: number; clientsAvailable: boolean };
}

export function AcquisitionEconomicsSection() {
  const { data: aData } = useQuery<{ assumptions: Assumptions }>({
    queryKey: ["unit-economics", "assumptions"],
    queryFn: () => fetch("/api/settings/unit-economics").then((r) => r.json()),
    staleTime: 60_000,
  });
  const w30 = useLive(30);
  const w60 = useLive(60);
  const w90 = useLive(90);
  const byWindow: Record<number, Live | undefined> = { 30: w30, 60: w60, 90: w90 };

  const econ = useMemo<TierEconomics[]>(() => (aData?.assumptions ? computeTiers(aData.assumptions) : []), [aData]);

  if (!aData?.assumptions) return <SectionShell><div className="h-28 animate-pulse rounded-[10px] bg-muted/40" /></SectionShell>;

  const targetFloor = blendedTargetCac(econ, "floor");
  const targetHope = blendedTargetCac(econ, "hope");
  const breakeven = blendedBreakevenCac(econ);
  const contribPerClient = blendedContributionPerClient(econ);
  const ltvPerClient = blendedLtvPerClient(econ);

  // headline window = 30d (with 60/90 shown alongside as the rolling trend, per §5)
  const primary = windowStats(byWindow[30], targetFloor, ltvPerClient);

  return (
    <SectionShell>
      <div data-r10n-card className="overflow-hidden rounded-[10px] border border-border bg-card">
        {/* Rolling cost-to-acquire — 30/60/90 together (the spec's rolling series) */}
        <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
          {WINDOWS.map((d) => {
            const s = windowStats(byWindow[d], targetFloor, ltvPerClient);
            return (
              <div key={d} className="px-4 py-3.5">
                <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Cost / client · {d}d
                  {d === 30 && <Tip>Realized CAC — total ad spend ÷ new clients acquired in the window (deduped, first payment). Shown across 30/60/90 days as a trend.</Tip>}
                </p>
                <p className="mt-1 text-lg font-bold tabular-nums text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                  {s.cac != null ? fmtMoney(s.cac) : "—"}
                </p>
                <div className="mt-0.5">
                  {s.cac == null ? <span className="text-[10.5px] text-muted-foreground">no data</span> :
                    <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[9.5px] font-semibold",
                      !s.trustworthy ? "bg-muted text-muted-foreground" : s.under ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
                      {s.trustworthy && (s.under ? <Check className="h-2.5 w-2.5" /> : <TrendingUp className="h-2.5 w-2.5" />)}
                      {!s.trustworthy ? "settling" : s.under ? "under target" : "over target"}
                    </span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* the numbers that frame it */}
        <div className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4 sm:divide-y-0">
          <Cell label="Worth per client" tip="What one new client is worth in guaranteed profit over their 3-month minimum, counting only the cost of serving them (blended across the expected package mix)."
            value={fmtMoney(contribPerClient)} sub="guaranteed, 3 mo" est />
          <Cell label="Target to acquire" tip="Two ceilings per the spec: the FLOOR is what we can pay and still profit on the guaranteed term alone; the HOPE is higher if clients renew. We lead with the floor."
            value={fmtMoney(targetFloor)} sub={`floor · ${fmtMoney(targetHope)} hope`} est />
          <Cell label="LTV : CAC" tip="Dollars a client is worth back per $1 spent to acquire them. 3:1+ is healthy. Uses modelled retention, so it's a hope until churn data matures."
            value={primary.ltvCac != null ? fmtRatio(primary.ltvCac) : "—"} sub="3:1 healthy · hope"
            badge={primary.ltvCac != null ? { text: primary.ltvCac >= 3 ? "healthy" : "thin", ok: primary.ltvCac >= 3 } : undefined} est />
          <Cell label="Breakeven" tip="The absolute most we could pay to acquire a client and still break even on their guaranteed 3 months, zero renewals assumed."
            value={fmtMoney(breakeven)} sub="max before losing" />
        </div>

        {/* link to the deep model + company P&L */}
        <Link href="/money" className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground">
          <span>Open the full model, per-package breakdown & company P&amp;L</span>
          <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
        </Link>
      </div>
    </SectionShell>
  );
}

function useLive(windowDays: number): Live | undefined {
  const { data } = useQuery<Live>({
    queryKey: ["unit-economics", "live", windowDays],
    queryFn: () => fetch(`/api/unit-economics/live?window=${windowDays}`).then((r) => r.json()),
    staleTime: 60_000,
  });
  return data;
}

interface Stats { cac: number | null; trustworthy: boolean; under: boolean; ltvCac: number | null }
function windowStats(live: Live | undefined, targetFloor: number, ltvPerClient: number): Stats {
  const cac = live?.realized.cac ?? null;
  const adSpend = live?.realized.adSpend ?? 0;
  const clients = live?.realized.newClients ?? 0;
  const available = !!live?.realized.clientsAvailable;
  const implied = targetFloor > 0 ? adSpend / targetFloor : 0;
  const trustworthy = available && clients >= 3 && clients >= implied * 0.4;
  return {
    cac,
    trustworthy,
    under: cac != null && cac <= targetFloor,
    ltvCac: cac != null && cac > 0 ? ltvPerClient / cac : null,
  };
}

function SectionShell({ children }: { children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center gap-3 px-1">
        <div data-r10n-section-accent className="h-3.5 w-0.5 shrink-0 rounded-full" style={{ backgroundColor: "var(--r10n-section-accent, oklch(0.62 0.13 250))" }} />
        <h3 data-r10n-section-title className="shrink-0 text-[11px] font-bold uppercase tracking-widest text-foreground/70" style={{ fontFamily: "var(--font-heading)" }}>
          Acquisition Economics
        </h3>
        <span className="text-[11px] font-medium text-muted-foreground">cost to acquire vs what a client is worth</span>
        <div className="h-px flex-1 bg-border/60" />
      </div>
      {children}
    </section>
  );
}

function Cell({ label, value, sub, tip, badge, est }: { label: string; value: string; sub?: string; tip?: React.ReactNode; badge?: { text: string; ok: boolean }; est?: boolean }) {
  return (
    <div className="px-4 py-3.5">
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}{tip && <Tip>{tip}</Tip>}</p>
      <p className={cn("mt-1 text-lg font-bold tabular-nums text-foreground", est && "border-b border-dotted border-muted-foreground/40 inline-block leading-tight")} style={{ fontFamily: "var(--font-heading)" }}>{value}</p>
      <div className="mt-0.5 flex items-center gap-1.5">
        {badge && <span className={cn("rounded-full px-1.5 py-px text-[9.5px] font-semibold", badge.ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>{badge.text}</span>}
        {sub && <span className="text-[10.5px] text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}
