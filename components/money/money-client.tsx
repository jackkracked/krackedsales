"use client";

import { Fragment, useEffect, useMemo, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sliders, Check, Loader2, X, TrendingUp, TrendingDown, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Bridge, type BridgeStep } from "./bridge";
import { fmtMoney, fmtMoneyK, fmtPct, fmtRatio, fmtMonths, fmtHours } from "./format";
import {
  computeTiers, blendedTargetCac, blendedBreakevenCac, realizedCac, paybackMonths,
  computeCompanyPnL, sumOverhead, ROLES, ROLE_LABELS,
  type Assumptions, type TierEconomics, type Role,
} from "@/lib/unit-economics/model";

// ─── tiny shared bits ───────────────────────────────────────────────────────────

/** Dotted-underline "estimate" treatment (CDO): a number that isn't measured-real yet. */
function Est({ children, on = true }: { children: React.ReactNode; on?: boolean }) {
  return <span className={cn(on && "border-b border-dotted border-muted-foreground/50")}>{children}</span>;
}
function SectionHeader({ eyebrow, title, sub }: { eyebrow?: string; title: string; sub?: string }) {
  return (
    <div className="mb-4 flex items-baseline gap-3">
      <span className="h-3.5 w-0.5 shrink-0 rounded bg-primary" />
      <div className="min-w-0">
        {eyebrow && <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{eyebrow}</p>}
        <h2 className="text-[15px] font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{title}</h2>
      </div>
      {sub && <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}
const card = "bg-card border border-border rounded-[10px]";

type WindowDays = 30 | 60 | 90;
interface LiveData {
  window: number;
  realized: { cac: number | null; adSpend: number; newClients: number; adSpendAvailable: boolean; clientsAvailable: boolean };
  month: { revenue: number; revenueAvailable: boolean; adSpend: number; adSpendAvailable: boolean; newClients: number; commissionEstimate: number; processingEstimate: number };
}

// ══════════════════════════════════════════════════════════════════════════════
export function MoneyClient() {
  const [draft, setDraft] = useState<Assumptions | null>(null);
  const [server, setServer] = useState<Assumptions | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [win, setWin] = useState<WindowDays>(30);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // Company-P&L commission is an editable actual (recurring cash doesn't re-pay commission);
  // default 0 + flagged, so the demo net reconciles and Gage types the real figure.
  const [commissionActual, setCommissionActual] = useState<number>(0);

  const { data: aData } = useQuery<{ assumptions: Assumptions }>({
    queryKey: ["unit-economics", "assumptions"],
    queryFn: () => fetch("/api/settings/unit-economics").then((r) => r.json()),
  });
  useEffect(() => {
    if (aData?.assumptions && !draft) { setDraft(aData.assumptions); setServer(aData.assumptions); }
  }, [aData, draft]);

  const { data: live } = useQuery<LiveData>({
    queryKey: ["unit-economics", "live", win],
    queryFn: () => fetch(`/api/unit-economics/live?window=${win}`).then((r) => r.json()),
    staleTime: 60_000,
  });

  // ── the model — computed CLIENT-SIDE from the (instantly-editable) draft ──────
  const econ = useMemo<TierEconomics[]>(() => (draft ? computeTiers(draft) : []), [draft]);
  const blendedTarget = useMemo(() => blendedTargetCac(econ, "floor"), [econ]);
  const breakeven = useMemo(() => blendedBreakevenCac(econ), [econ]);

  const dirty = useMemo(() => draft && server && JSON.stringify(draft) !== JSON.stringify(server), [draft, server]);

  const save = useCallback(async () => {
    if (!draft) return;
    setSaveState("saving");
    try {
      const res = await fetch("/api/settings/unit-economics", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assumptions: draft }), keepalive: true,
      });
      if (!res.ok) throw new Error();
      const json = await res.json();
      setServer(json.assumptions); setDraft(json.assumptions);
      setSaveState("saved"); setTimeout(() => setSaveState("idle"), 2500);
    } catch { setSaveState("error"); }
  }, [draft]);

  if (!draft) {
    return <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6"><div className="h-40 animate-pulse rounded-[10px] bg-muted/40" /></div>;
  }

  // ── company P&L (real totals) ─────────────────────────────────────────────────
  const revenue = live?.month.revenue ?? 0;
  const monthAdSpend = live?.month.adSpend ?? 0;
  const processing = live?.month.processingEstimate ?? 0;
  const overheadTotal = sumOverhead(draft.overhead);
  const pnl = computeCompanyPnL({ revenue, adSpend: monthAdSpend, commission: commissionActual, processing }, draft);
  const revenueLive = !!live?.month.revenueAvailable;

  // ── acquisition headline ──────────────────────────────────────────────────────
  const realized = live?.realized.cac ?? null;
  const rollAdSpend = live?.realized.adSpend ?? 0;
  const rollClients = live?.realized.newClients ?? 0;
  const mixTotal = Math.max(1, econ.reduce((s, e) => s + e.expectedMonthlyCount, 0));
  const blendedLtvPerClient = econ.reduce((s, e) => s + e.ltvContribution * e.expectedMonthlyCount, 0) / mixTotal;
  const ltvCacRatio = realized && realized > 0 ? blendedLtvPerClient / realized : null;
  const monthlyBlendedContribution = econ.reduce((s, e) => s + e.monthlyContribution * e.expectedMonthlyCount, 0) / mixTotal;
  const payback = realized != null ? paybackMonths(realized, monthlyBlendedContribution) : null;
  const cacUnder = realized != null && realized <= blendedTarget;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>Money</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">What we spend to grow, and what we keep.</p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <button onClick={save} disabled={saveState === "saving"}
              className="inline-flex items-center gap-1.5 rounded-[8px] bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-70">
              {saveState === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{saveState === "saving" ? "Saving" : "Save changes"}
            </button>
          )}
          {saveState === "saved" && <span className="inline-flex items-center gap-1 text-xs font-medium text-success"><Check className="h-3.5 w-3.5" />Saved</span>}
          {saveState === "error" && <span className="text-xs text-destructive">Save failed</span>}
          <button onClick={() => setDrawerOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <Sliders className="h-3.5 w-3.5" /> Assumptions
          </button>
        </div>
      </div>

      {/* ── Verdict line ─────────────────────────────────────────────────────── */}
      <div className={cn(card, "mb-4 px-6 py-5")}>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">This month</p>
        <p className="mt-1.5 text-lg leading-snug text-foreground sm:text-xl">
          We spent{" "}
          <b className="text-2xl font-bold tabular-nums text-destructive sm:text-[28px]" style={{ fontFamily: "var(--font-heading)" }}>{fmtMoney(monthAdSpend)}</b>{" "}
          on ads and, after every cost, the company{" "}
          {revenueLive ? (
            <>kept <b className={cn("text-2xl font-bold tabular-nums sm:text-[28px]", pnl.net >= 0 ? "text-success" : "text-destructive")} style={{ fontFamily: "var(--font-heading)" }}>{fmtMoney(pnl.net)}</b>{" "}
              <span className="text-muted-foreground">({fmtPct(pnl.netPct)}).</span></>
          ) : (
            <span className="text-muted-foreground">kept — <span className="text-xs">connect Stripe to show revenue.</span></span>
          )}
        </p>
      </div>

      {/* ── At-a-glance strip ────────────────────────────────────────────────── */}
      <div className={cn(card, "mb-6 grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0")}>
        <Stat label={`Realized CAC · ${win}d`} value={realized != null ? fmtMoney(realized) : "—"} accent
          badge={realized != null ? { text: cacUnder ? "under target" : "over target", ok: cacUnder } : undefined}
          sub={`vs ${fmtMoney(blendedTarget)} target`} estimate={!live?.realized.adSpendAvailable} />
        <Stat label="LTV : CAC" value={ltvCacRatio != null ? fmtRatio(ltvCacRatio) : "—"} accent
          badge={ltvCacRatio != null ? { text: ltvCacRatio >= 3 ? "healthy" : "thin", ok: ltvCacRatio >= 3 } : undefined}
          sub="3:1 is the health line" estimate />
        <Stat label="CAC payback" value={payback != null ? fmtMonths(payback) : "—"}
          sub={`term is ${draft.termMonths} mo`} badge={payback != null ? { text: payback < draft.termMonths ? "inside term" : "past term", ok: payback < draft.termMonths } : undefined} estimate />
        <Stat label={`New clients · ${win}d`} value={String(rollClients)} sub={`from ${fmtMoney(rollAdSpend)} spend`} />
        <Stat label="Blended breakeven" value={fmtMoney(breakeven)} sub="max before losing money" />
      </div>

      {/* ── ① Is our ad money worth it? ──────────────────────────────────────── */}
      <section className={cn(card, "mb-6 p-5")}>
        <SectionHeader eyebrow="Acquisition" title="Is our ad money worth it?" sub={`rolling ${win}-day`} />
        <div className="mb-4 inline-flex overflow-hidden rounded-[8px] border border-border text-xs">
          {([30, 60, 90] as WindowDays[]).map((d) => (
            <button key={d} onClick={() => setWin(d)}
              className={cn("px-3 py-1.5 font-semibold transition-colors", win === d ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/60")}>{d}d</button>
          ))}
        </div>

        {/* per-package table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-3 text-left font-semibold">Package</th>
                <th className="px-3 py-2 text-right font-semibold">Profit %</th>
                <th className="px-3 py-2 text-right font-semibold">Profit (3&nbsp;mo)</th>
                <th className="px-3 py-2 text-right font-semibold">Payback</th>
                <th className="px-3 py-2 text-right font-semibold">Max CAC (floor)</th>
                <th className="px-3 py-2 text-right font-semibold">$/strat&nbsp;hr</th>
                <th className="py-2 pl-3 text-right font-semibold">vs realized</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {econ.map((e) => {
                const pb = paybackMonths(realized ?? 0, e.monthlyContribution);
                const over = realized != null && realized > e.recommendedMaxCacFloor;
                const isOpen = expanded === e.id;
                return (
                  <Fragment key={e.id}>
                    <tr onClick={() => setExpanded(isOpen ? null : e.id)}
                      className={cn("cursor-pointer transition-colors hover:bg-muted/40", isOpen && "bg-muted/30")}>
                      <td className="py-2.5 pr-3">
                        <span className="font-semibold text-foreground">{e.name}</span>
                        <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{fmtMoney(e.monthlyPrice)}/mo</span>
                        {e.isCustom && <span className="ml-1.5 rounded bg-muted px-1 py-px text-[9px] font-semibold uppercase text-muted-foreground">custom</span>}
                        {!e.viable && <span className="ml-1.5 rounded bg-destructive/10 px-1 py-px text-[9px] font-semibold uppercase text-destructive">loses money</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium"><Est>{fmtPct(e.contributionPct)}</Est></td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-foreground"><Est>{fmtMoney(e.contribution)}</Est></td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{pb != null ? fmtMonths(pb) : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium"><Est>{fmtMoney(e.recommendedMaxCacFloor)}</Est>
                        <span className="ml-1 text-[10px] text-muted-foreground">(+{fmtMoneyK(e.recommendedMaxCacHope)} hope)</span></td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground"><Est>{e.contributionPerStrategistHour != null ? fmtMoney(e.contributionPerStrategistHour) : "—"}</Est></td>
                      <td className="py-2.5 pl-3 text-right">
                        {realized == null ? <span className="text-muted-foreground">—</span> :
                          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", over ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success")}>
                            {over ? <TrendingUp className="h-3 w-3" /> : <Check className="h-3 w-3" />}{over ? "over" : "clears"}</span>}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr><td colSpan={7} className="bg-muted/20 px-3 py-3">
                        <Recipe e={e} draft={draft} /></td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Info className="h-3 w-3" /> Profit leads with the <b className="font-semibold">guaranteed 3-month floor</b>; the retention "hope" is shown separately (some clients have churned in 4–8 weeks). Dotted numbers are estimates until real hours land.
        </p>
      </section>

      {/* ── ② Did the company keep money? ────────────────────────────────────── */}
      <section className={cn(card, "mb-6 p-5")}>
        <SectionHeader eyebrow="Whole business" title="Did the company keep money?" sub="this month" />
        {revenueLive ? (
          <Bridge steps={pnlSteps(pnl, commissionActual === 0)} height={210} />
        ) : (
          <div className="flex items-center gap-2 rounded-[8px] bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4" /> Connect Stripe to show the company P&L.
          </div>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <MiniStat label="Revenue" value={fmtMoney(revenue)} estimate={!revenueLive} />
          <MiniStat label="Contribution" value={fmtMoney(pnl.totalContribution)} accent />
          <MiniStat label="Fixed overhead" value={fmtMoney(overheadTotal)} estimate />
          <MiniStat label="Net kept" value={fmtMoney(pnl.net)} accent={pnl.net >= 0} danger={pnl.net < 0} />
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">Commission & processing here are estimates until you enter the real monthly figures in Assumptions. This is the real "can we afford to run" number, kept separate from the per-client view above (never mixed).</p>
      </section>

      {/* ── ③ Planner ────────────────────────────────────────────────────────── */}
      <Planner draft={draft} econ={econ} blendedTarget={blendedTarget} />

      {drawerOpen && <AssumptionsDrawer draft={draft} setDraft={setDraft} onClose={() => setDrawerOpen(false)} econ={econ}
        commissionActual={commissionActual} setCommissionActual={setCommissionActual} />}
    </div>
  );
}

// ─── company P&L → bridge steps ───────────────────────────────────────────────
function pnlSteps(pnl: ReturnType<typeof computeCompanyPnL>, commissionEst: boolean): BridgeStep[] {
  return [
    { label: "Revenue", value: pnl.revenue, kind: "anchor" },
    { label: "− Ad spend", value: pnl.adSpend, kind: "out" },
    { label: "− Commission", value: pnl.commission, kind: "out", estimate: commissionEst },
    { label: "− Processing", value: pnl.processing, kind: "out", estimate: true },
    { label: "= Contribution", value: pnl.totalContribution, kind: "checkpoint" },
    { label: "− Overhead", value: pnl.totalOverhead, kind: "out", estimate: true },
    { label: "= Kept", value: Math.abs(pnl.net), kind: "result" },
  ];
}

// ─── stat cells ───────────────────────────────────────────────────────────────
function Stat({ label, value, sub, badge, accent, estimate }: { label: string; value: string; sub?: string; badge?: { text: string; ok: boolean }; accent?: boolean; estimate?: boolean }) {
  return (
    <div className="px-4 py-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-lg font-bold tabular-nums", accent ? "text-foreground" : "text-foreground")} style={{ fontFamily: "var(--font-heading)" }}>
        <Est on={estimate}>{value}</Est>
      </p>
      <div className="mt-0.5 flex items-center gap-1.5">
        {badge && <span className={cn("rounded-full px-1.5 py-px text-[9.5px] font-semibold", badge.ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>{badge.text}</span>}
        {sub && <span className="text-[10.5px] text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}
function MiniStat({ label, value, accent, danger, estimate }: { label: string; value: string; accent?: boolean; danger?: boolean; estimate?: boolean }) {
  return (
    <div className="rounded-[8px] border border-border bg-background px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-base font-bold tabular-nums", danger ? "text-destructive" : accent ? "text-success" : "text-foreground")} style={{ fontFamily: "var(--font-heading)" }}>
        <Est on={estimate}>{value}</Est>
      </p>
    </div>
  );
}

// ─── recipe (per-package role/fee breakdown — role hours on a waterfall) ────────
function Recipe({ e, draft }: { e: TierEconomics; draft: Assumptions }) {
  const rows: { label: string; sub?: string; amount: number; share: number }[] = [
    ...ROLES.map((r) => ({ label: ROLE_LABELS[r], sub: `${fmtHours(e.labour[r].hours)}/mo`, amount: -e.labour[r].termCost, share: e.labour[r].shareOfPrice })),
    { label: "Contractor fee", sub: fmtPct(draft.contractorFeePct, 0), amount: -e.contractorFeeTerm, share: e.contractorFeeTerm / (e.termRevenue || 1) },
    { label: "Commission", sub: fmtPct(draft.commissionPct, 0), amount: -e.commissionTerm, share: e.commissionTerm / (e.termRevenue || 1) },
    { label: "Card fee", sub: fmtPct(draft.processingPct, 1), amount: -e.processingTerm, share: e.processingTerm / (e.termRevenue || 1) },
  ];
  return (
    <div className="max-w-xl">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">How {e.name}'s profit is built (3 months)</span>
        <span className="text-sm font-bold tabular-nums text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{fmtMoney(e.termRevenue)}</span>
      </div>
      <div className="space-y-1">
        {rows.map((row, i) => (
          <div key={i} className="relative flex items-center gap-2 rounded-[6px] px-2 py-1">
            <span className="absolute inset-y-0 left-0 rounded-[6px] bg-destructive/10" style={{ width: `${Math.min(100, row.share * 100)}%` }} />
            <span className="relative z-10 flex-1 text-[12.5px] text-foreground">{row.label}{row.sub && <span className="ml-1.5 text-[11px] text-muted-foreground tabular-nums">{row.sub}</span>}</span>
            <span className="relative z-10 text-[12.5px] font-medium tabular-nums text-destructive">{fmtMoney(row.amount)}</span>
          </div>
        ))}
        <div className="mt-1 flex items-center gap-2 rounded-[6px] border-t border-primary/40 px-2 pt-2">
          <span className="flex-1 text-[12.5px] font-bold text-foreground">= Contribution</span>
          <span className="text-sm font-bold tabular-nums text-success" style={{ fontFamily: "var(--font-heading)" }}>{fmtMoney(e.contribution)} <span className="text-[11px] text-muted-foreground">({fmtPct(e.contributionPct)})</span></span>
        </div>
      </div>
    </div>
  );
}

// ─── planner ──────────────────────────────────────────────────────────────────
function Planner({ draft, econ, blendedTarget }: { draft: Assumptions; econ: TierEconomics[]; blendedTarget: number }) {
  const [spend, setSpend] = useState(10000);
  const [months, setMonths] = useState(3);
  const cac = blendedTarget || 770;
  const totalSpend = spend * months;
  const clients = cac > 0 ? totalSpend / cac : 0;
  const totalMix = econ.reduce((s, e) => s + e.expectedMonthlyCount, 0) || 1;
  const guaranteed = econ.reduce((s, e) => s + (clients * (e.expectedMonthlyCount / totalMix)) * e.contribution, 0);
  const hope = econ.reduce((s, e) => s + (clients * (e.expectedMonthlyCount / totalMix)) * e.ltvContribution, 0);
  const stratHrs = econ.reduce((s, e) => s + (clients * (e.expectedMonthlyCount / totalMix)) * e.labour.strategist.hours * draft.termMonths, 0);

  return (
    <section className={cn(card, "mb-6 p-5")}>
      <SectionHeader eyebrow="Planner" title="What can we afford?" sub="floor vs hope" />
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="space-y-4">
          <Field label="Monthly ad spend" value={fmtMoney(spend)}>
            <input type="range" min={0} max={50000} step={500} value={spend} onChange={(e) => setSpend(+e.target.value)} className="w-full accent-primary" />
          </Field>
          <Field label="Months" value={String(months)}>
            <input type="range" min={1} max={12} step={1} value={months} onChange={(e) => setMonths(+e.target.value)} className="w-full accent-primary" />
          </Field>
          <div className="rounded-[8px] bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">Planning at <b className="text-foreground tabular-nums">{fmtMoney(cac)}</b>/client (your blended target).</div>
        </div>
        <div className="grid grid-cols-2 gap-3 self-start sm:grid-cols-3">
          <BigStat label="Expected clients" value={clients.toFixed(1)} />
          <BigStat label="Guaranteed profit" value={fmtMoney(guaranteed)} accent sub="the floor" />
          <BigStat label="If retention holds" value={fmtMoney(hope)} sub="hope" estimate />
          <BigStat label="Total ad spend" value={fmtMoney(totalSpend)} danger />
          <BigStat label="Net (guaranteed)" value={fmtMoney(guaranteed - totalSpend)} accent={guaranteed - totalSpend >= 0} danger={guaranteed - totalSpend < 0} sub="after ad spend, before overhead" />
          <BigStat label="Strategist hours" value={fmtHours(stratHrs)} sub="capacity to serve them" estimate />
        </div>
      </div>
    </section>
  );
}
function Field({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="text-sm font-bold tabular-nums text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{value}</span>
      </div>
      {children}
    </div>
  );
}
function BigStat({ label, value, sub, accent, danger, estimate }: { label: string; value: string; sub?: string; accent?: boolean; danger?: boolean; estimate?: boolean }) {
  return (
    <div className="rounded-[8px] border border-border bg-background px-3 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-xl font-bold tabular-nums", danger ? "text-destructive" : accent ? "text-success" : "text-foreground")} style={{ fontFamily: "var(--font-heading)" }}><Est on={estimate}>{value}</Est></p>
      {sub && <p className="mt-0.5 text-[10.5px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ─── assumptions drawer (dials + hours grid) ────────────────────────────────────
function AssumptionsDrawer({ draft, setDraft, onClose, econ, commissionActual, setCommissionActual }: {
  draft: Assumptions; setDraft: (a: Assumptions) => void; onClose: () => void; econ: TierEconomics[];
  commissionActual: number; setCommissionActual: (n: number) => void;
}) {
  const setHours = (tierId: string, role: Role, v: number) =>
    setDraft({ ...draft, tiers: draft.tiers.map((t) => t.id === tierId ? { ...t, hours: { ...t.hours, [role]: Math.max(0, v) } } : t) });
  const setSalary = (role: Role, v: number) => setDraft({ ...draft, roleMonthlySalary: { ...draft.roleMonthlySalary, [role]: Math.max(0, v) } });
  const setOverhead = (key: keyof Assumptions["overhead"], v: number) => setDraft({ ...draft, overhead: { ...draft.overhead, [key]: Math.max(0, v) } });

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-[520px] flex-col border-l border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>Assumptions</h2>
            <p className="text-xs text-muted-foreground">Change anything — every number updates live.</p>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          {/* estimate banner */}
          <div className="flex items-start gap-2 rounded-[8px] border border-primary/25 bg-primary/5 px-3 py-2.5 text-[11px] text-foreground">
            <Info className="mt-px h-3.5 w-3.5 shrink-0 text-primary" />
            <span>Hours, retention and the contractor fee are <b>reasoned estimates</b> calibrated to your current model, pending real time-tracking. Edit them to your real figures.</span>
          </div>

          {/* hours grid */}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Hours per package (monthly, per client)</p>
            <div className="overflow-x-auto rounded-[8px] border border-border">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-2 py-2 text-left font-semibold">Role</th>
                  {draft.tiers.map((t) => <th key={t.id} className="px-1.5 py-2 text-right font-semibold">{t.name}<br /><span className="text-muted-foreground/70 tabular-nums">{fmtMoneyK(t.monthlyPrice)}</span></th>)}
                </tr></thead>
                <tbody className="divide-y divide-border/50">
                  {ROLES.map((r) => (
                    <tr key={r}>
                      <td className="px-2 py-1.5"><span className="font-medium text-foreground">{ROLE_LABELS[r]}</span>
                        <input type="number" min={0} value={draft.roleMonthlySalary[r]} onChange={(e) => setSalary(r, +e.target.value)}
                          className="ml-1 w-16 border-b border-transparent bg-transparent text-right text-[11px] tabular-nums text-muted-foreground focus:border-primary/50 focus:outline-none" title="Monthly salary" /></td>
                      {draft.tiers.map((t) => (
                        <td key={t.id} className="px-1 py-1">
                          <input type="number" min={0} step={0.5} value={Math.round((t.hours[r] ?? 0) * 10) / 10} onChange={(e) => setHours(t.id, r, +e.target.value)}
                            className="w-full rounded-[4px] border-b border-transparent bg-transparent py-1 text-right text-[13px] tabular-nums text-foreground hover:bg-muted/40 focus:border-b-primary/60 focus:bg-primary/5 focus:outline-none" />
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="border-t border-border bg-muted/20 text-[11px]">
                    <td className="px-2 py-1.5 font-semibold uppercase tracking-wide text-muted-foreground">Profit %</td>
                    {econ.map((e) => <td key={e.id} className="px-1.5 py-1.5 text-right font-bold tabular-nums text-primary">{fmtPct(e.contributionPct)}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-[10.5px] text-muted-foreground">The small number by each role is its monthly salary (÷160 gives the hourly cost automatically — you never type a rate).</p>
          </div>

          {/* scalar dials */}
          <div className="grid grid-cols-2 gap-3">
            <Dial label="Commission %" value={draft.commissionPct * 100} onChange={(v) => setDraft({ ...draft, commissionPct: v / 100 })} suffix="%" />
            <Dial label="Card fee %" value={draft.processingPct * 100} onChange={(v) => setDraft({ ...draft, processingPct: v / 100 })} suffix="%" />
            <Dial label="Contractor fee %" value={draft.contractorFeePct * 100} onChange={(v) => setDraft({ ...draft, contractorFeePct: v / 100 })} suffix="%" est />
            <Dial label="LTV:CAC target" value={draft.ltvCacTarget} onChange={(v) => setDraft({ ...draft, ltvCacTarget: v })} suffix="x" />
            <Dial label="Term (months)" value={draft.termMonths} onChange={(v) => setDraft({ ...draft, termMonths: Math.round(v) })} />
          </div>

          {/* retention per tier */}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Extra months retained <span className="normal-case text-muted-foreground/70">(estimate)</span></p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {draft.tiers.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-[6px] border border-border px-2.5 py-1.5">
                  <span className="truncate text-[12px] text-foreground">{t.name}</span>
                  <input type="number" min={0} value={t.additionalMonths} onChange={(e) => setDraft({ ...draft, tiers: draft.tiers.map((x) => x.id === t.id ? { ...x, additionalMonths: Math.max(0, +e.target.value) } : x) })}
                    className="w-12 rounded border-b border-transparent bg-transparent text-right text-[13px] tabular-nums text-foreground focus:border-primary/60 focus:outline-none" />
                </div>
              ))}
            </div>
          </div>

          {/* overhead */}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Fixed monthly overhead <span className="normal-case text-primary tabular-nums">= {fmtMoney(sumOverhead(draft.overhead))}</span></p>
            <div className="space-y-1.5">
              {(["teamPayroll", "founderComp", "software", "insurance", "otherAdmin"] as const).map((k) => (
                <div key={k} className="flex items-center justify-between rounded-[6px] border border-border px-2.5 py-1.5">
                  <span className="text-[12px] text-foreground">{OVERHEAD_LABELS[k]}</span>
                  <div className="flex items-center gap-1"><span className="text-xs text-muted-foreground">$</span>
                    <input type="number" min={0} value={draft.overhead[k]} onChange={(e) => setOverhead(k, +e.target.value)}
                      className="w-24 rounded border-b border-transparent bg-transparent text-right text-[13px] tabular-nums text-foreground focus:border-primary/60 focus:outline-none" /></div>
                </div>
              ))}
              <div className="flex items-center justify-between rounded-[6px] border border-primary/20 bg-primary/5 px-2.5 py-1.5">
                <span className="text-[12px] text-foreground">Actual commission paid <span className="text-[10px] text-muted-foreground">(this month)</span></span>
                <div className="flex items-center gap-1"><span className="text-xs text-muted-foreground">$</span>
                  <input type="number" min={0} value={commissionActual} onChange={(e) => setCommissionActual(Math.max(0, +e.target.value))}
                    className="w-24 rounded border-b border-transparent bg-transparent text-right text-[13px] tabular-nums text-foreground focus:border-primary/60 focus:outline-none" /></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
const OVERHEAD_LABELS: Record<string, string> = { teamPayroll: "Team & delivery payroll", founderComp: "Founder pay", software: "Software & tools", insurance: "Insurance & admin", otherAdmin: "Other" };
function Dial({ label, value, onChange, suffix, est }: { label: string; value: number; onChange: (v: number) => void; suffix?: string; est?: boolean }) {
  return (
    <div className="rounded-[8px] border border-border px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}{est && <span className="ml-1 text-primary">est</span>}</p>
      <div className="mt-0.5 flex items-baseline gap-1">
        <input type="number" step="any" value={Math.round(value * 100) / 100} onChange={(e) => onChange(+e.target.value)}
          className="w-full border-b border-transparent bg-transparent text-base font-bold tabular-nums text-foreground focus:border-primary/60 focus:outline-none" style={{ fontFamily: "var(--font-heading)" }} />
        {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}
