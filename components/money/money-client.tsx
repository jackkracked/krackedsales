"use client";

import { Fragment, useEffect, useMemo, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sliders, Check, Loader2, X, TrendingUp, AlertCircle, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Bridge, type BridgeStep } from "./bridge";
import { Tip } from "./tip";
import { fmtMoney, fmtMoneyK, fmtPct, fmtRatio, fmtMonths, fmtHours } from "./format";
import {
  computeTiers, blendedTargetCac, blendedBreakevenCac, paybackMonths,
  blendedContributionPerClient, blendedLtvPerClient, blendedMonthlyContributionPerClient,
  computeCompanyPnL, sumOverhead, ROLES, ROLE_LABELS,
  type Assumptions, type TierEconomics, type Role,
} from "@/lib/unit-economics/model";

// ─── tiny shared bits ───────────────────────────────────────────────────────────

/** Dotted-underline "estimate" treatment (§8): a number that isn't measured-real yet. */
function Est({ children, on = true }: { children: React.ReactNode; on?: boolean }) {
  return <span className={cn(on && "border-b border-dotted border-muted-foreground/50")}>{children}</span>;
}
function SectionHeader({ eyebrow, title, sub, tip }: { eyebrow?: string; title: string; sub?: string; tip?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-baseline gap-3">
      <span className="h-3.5 w-0.5 shrink-0 rounded bg-primary" />
      <div className="min-w-0">
        {eyebrow && <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{eyebrow}</p>}
        <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
          {title}{tip && <Tip>{tip}</Tip>}
        </h2>
      </div>
      {sub && <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}
const card = "bg-card border border-border rounded-[10px]";

type WindowDays = 30 | 60 | 90;
interface LiveData {
  window: number;
  realized: { cac: number | null; adSpend: number; newClients: number; adSpendAvailable: boolean; clientsAvailable: boolean; byCampaign?: { campaign: string; spend: number }[] };
  month: { label?: string; revenue: number; revenueAvailable: boolean; adSpend: number; adSpendAvailable: boolean; newClients: number; commissionEstimate: number; processingEstimate: number };
}
interface ClientRow { name: string; acquiredAt: string; firstType: string; firstAmount: number }

// ══════════════════════════════════════════════════════════════════════════════
export function MoneyClient() {
  const [draft, setDraft] = useState<Assumptions | null>(null);
  const [server, setServer] = useState<Assumptions | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [win, setWin] = useState<WindowDays>(30);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [clientsOpen, setClientsOpen] = useState(false);
  const [spendOpen, setSpendOpen] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

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
  const { data: clientList } = useQuery<{ clients: ClientRow[] }>({
    queryKey: ["unit-economics", "clients", win],
    queryFn: () => fetch(`/api/unit-economics/clients?window=${win}`).then((r) => r.json()),
    enabled: clientsOpen,
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
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6"><div className="h-40 animate-pulse rounded-[10px] bg-muted/40" /></div>
      </div>
    );
  }

  // ── Whole-business health (§4/§5) — from real monthly ACTUALS, never a partial feed ──
  const pnl = computeCompanyPnL(draft.companyActuals, draft);
  const overheadTotal = sumOverhead(draft.overhead);
  const liveRevenue = live?.month.revenue ?? 0; // last complete month from Stripe cash — CROSS-CHECK only
  const liveRevenueAvailable = !!live?.month.revenueAvailable;
  const pnlMonth = live?.month.label;

  // ── Acquisition efficiency (§4/§5) — Contribution-Margin basis, NEVER fixed overhead ──
  const realized = live?.realized.cac ?? null; // Realized CAC
  const rollAdSpend = live?.realized.adSpend ?? 0;
  const rollClients = live?.realized.newClients ?? 0;
  const clientsAvailable = !!live?.realized.clientsAvailable;
  const spendCampaigns = live?.realized.byCampaign ?? [];
  const contribPerClient = blendedContributionPerClient(econ); // Contribution Margin $ per client, blended
  const ltvPerClient = blendedLtvPerClient(econ); // LTV Contribution per client (modelled retention)
  const monthlyContribPerClient = blendedMonthlyContributionPerClient(econ);
  const blendedTargetHope = blendedTargetCac(econ, "hope"); // Blended Target CAC on the LTV basis (§6.6 shows both)
  const ltvCacRatio = realized && realized > 0 ? ltvPerClient / realized : null;
  const payback = realized != null ? paybackMonths(realized, monthlyContribPerClient) : null;
  const cacUnder = realized != null && realized <= blendedTarget;

  // What the spend is BUILT to return at the Blended Target CAC (the honest model answer while
  // realized closes are still settling).
  const impliedClients = blendedTarget > 0 ? rollAdSpend / blendedTarget : 0;
  const impliedProfit = impliedClients * contribPerClient;
  // Realized closes lag the spend that produced them. Only trust Realized CAC once enough have
  // settled vs what the spend implies (the ramp gate) — else a timing/under-count artifact reads
  // as a catastrophic CAC.
  const acqTrustworthy = clientsAvailable && rollClients >= 3 && rollClients >= impliedClients * 0.4;
  const realizedProfit = rollClients * contribPerClient;
  const acqNet = realizedProfit - rollAdSpend;
  const acqReturn = rollAdSpend > 0 && acqTrustworthy ? realizedProfit / rollAdSpend : null;

  return (
    <div className="h-full overflow-y-auto">
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>Money</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Contribution Margin &amp; CAC. Two questions, kept separate, per the spec.</p>
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

      {/* ═══ ACQUISITION EFFICIENCY (§5) — Contribution-Margin basis, no overhead ═══ */}
      <div className={cn(card, "mb-4 overflow-hidden")}>
        <div className="border-b border-border bg-muted/20 px-6 py-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Acquisition efficiency · Contribution-Margin basis
            <Tip>Question 1 of the spec: &quot;is this client / ad dollar worth it?&quot; The only costs counted are the VARIABLE costs of serving a client (role hours, commission, processing). Fixed overhead is deliberately excluded — that is Whole-business health below (§2, §6.5).</Tip>
          </p>
        </div>
        <div className="px-6 py-5">
          {acqTrustworthy ? (
            <p className="text-lg leading-snug text-foreground sm:text-xl">
              We spent{" "}
              <b className="font-bold tabular-nums text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{fmtMoney(rollAdSpend)}</b>{" "}
              on ads in the last {win} days and brought in{" "}
              <b className="font-bold tabular-nums text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{rollClients} client{rollClients === 1 ? "" : "s"}</b>{" "}
              at a Realized CAC of <b className="tabular-nums">{realized != null ? fmtMoney(realized) : "—"}</b>. Their blended Contribution Margin is about{" "}
              <b className="font-bold tabular-nums text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{fmtMoney(realizedProfit)}</b>{" "}
              (guaranteed term), so net of ad spend that is{" "}
              <b className={cn("text-2xl font-bold tabular-nums sm:text-[26px]", acqNet >= 0 ? "text-success" : "text-destructive")} style={{ fontFamily: "var(--font-heading)" }}>{fmtMoney(acqNet)}</b>
              {acqReturn != null && <span className="text-muted-foreground"> — a {fmtRatio(acqReturn)} return, before any renewals.</span>}
            </p>
          ) : (
            <p className="text-lg leading-snug text-foreground sm:text-xl">
              We spent{" "}
              <b className="font-bold tabular-nums text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{fmtMoney(rollAdSpend)}</b>{" "}
              on ads in the last {win} days. Blended Contribution Margin is about{" "}
              <b className="font-bold tabular-nums text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{fmtMoney(contribPerClient)}</b>{" "}
              per client, and the Blended Target CAC is{" "}
              <b className="font-bold tabular-nums text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{fmtMoney(blendedTarget)}</b>{" "}
              (floor; up to <b className="tabular-nums">{fmtMoney(blendedTargetHope)}</b> on the LTV basis). At that CAC this spend is built to acquire about{" "}
              <b className="font-bold tabular-nums text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{impliedClients.toFixed(0)} clients</b>{" "}
              (~<b className="tabular-nums">{fmtMoney(impliedProfit)}</b> Contribution).{" "}
              <span className="text-muted-foreground">
                <b className="tabular-nums text-foreground">{rollClients}</b> ha{rollClients === 1 ? "s" : "ve"} settled so far, so Realized CAC is still landing.
              </span>
            </p>
          )}
          {/* where the ad spend comes from — click to verify, biggest first */}
          {spendCampaigns.length > 0 && (
            <div className="mt-3">
              <button onClick={() => setSpendOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground underline decoration-dotted decoration-muted-foreground/40 underline-offset-2 transition-colors hover:text-foreground">
                {spendOpen ? "Hide" : "See"} where the {fmtMoney(rollAdSpend)} comes from ({spendCampaigns.length} campaign{spendCampaigns.length === 1 ? "" : "s"})
              </button>
              {spendOpen && (
                <div className="mt-2 max-w-xl divide-y divide-border/50 rounded-[8px] border border-border bg-background px-3">
                  {spendCampaigns.map((c, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 py-1.5 text-[12.5px]">
                      <span className="min-w-0 flex-1 truncate text-foreground" title={c.campaign}>{c.campaign}</span>
                      <span className="shrink-0 font-medium tabular-nums text-foreground">{fmtMoney(c.spend)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-3 py-1.5 text-[12.5px] font-bold">
                    <span className="text-muted-foreground">Total · last {win} days</span>
                    <span className="tabular-nums text-foreground">{fmtMoney(rollAdSpend)}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* the three CAC numbers, at a glance */}
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <KeyNum label="Contribution Margin / client" tip="Contribution Margin $ (§4): revenue minus only the variable costs of serving a client (role hours, commission, processing), over the 3-month guaranteed term. Blended across the expected mix. Excludes fixed overhead." value={fmtMoney(contribPerClient)} sub="guaranteed term, blended" estimate />
            <KeyNum label="Blended Target CAC" tip="Blended Target CAC (§4): the mix-weighted Recommended Max CAC. FLOOR = the guaranteed-term basis (0 renewals); HOPE = the LTV basis. We lead with the floor and never bank on the hope (§6.6)." value={fmtMoney(blendedTarget)} sub={`floor · up to ${fmtMoney(blendedTargetHope)} on LTV basis`} />
            <KeyNum label={`Realized CAC · ${win}d`} tip="Realized CAC (§4, §6): total acquisition spend ÷ new client relationships in the window. Compared against the Blended Target CAC as an over/under signal." value={realized != null ? fmtMoney(realized) : "—"}
              sub={acqTrustworthy ? (cacUnder ? "under target" : "over target") : "still settling"}
              tone={!acqTrustworthy ? "muted" : cacUnder ? "good" : "bad"} estimate={!acqTrustworthy} />
          </div>
        </div>
      </div>

      {/* ── Acquisition-efficiency KPI strip ─────────────────────────────────── */}
      <div className={cn(card, "mb-6 grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0")}>
        <Stat label={`Realized CAC · ${win}d`} value={realized != null ? fmtMoney(realized) : "—"} accent
          tip="Realized CAC (§4, §6): total acquisition spend ÷ new client relationships, counted per §6 (all lines, deduped)."
          badge={realized != null ? { text: acqTrustworthy ? (cacUnder ? "under target" : "over target") : "settling", ok: acqTrustworthy ? cacUnder : undefined } : undefined}
          sub={`vs ${fmtMoney(blendedTarget)} target`} estimate={!acqTrustworthy} />
        <Stat label="LTV : CAC" value={ltvCacRatio != null ? fmtRatio(ltvCacRatio) : "—"} accent
          tip="LTV Contribution per client ÷ Realized CAC. 3:1 is the health line (§4). Uses modelled retention, so treat as the hope until churn data matures (§8)."
          badge={ltvCacRatio != null ? { text: ltvCacRatio >= 3 ? "healthy" : "thin", ok: ltvCacRatio >= 3 } : undefined}
          sub="3:1 health line · retention hope" estimate />
        <Stat label="CAC Payback" value={payback != null ? fmtMonths(payback) : "—"}
          tip="Months for a client's Monthly Contribution to repay the Realized CAC. Inside the guaranteed term is safe."
          sub={`term is ${draft.termMonths} mo`} badge={payback != null ? { text: payback < draft.termMonths ? "inside term" : "past term", ok: payback < draft.termMonths } : undefined} estimate />
        <Stat label={`New Clients · ${win}d`} value={String(rollClients)} sub="click to verify who" onClick={() => setClientsOpen((v) => !v)}
          tip="New client relationships (§6): distinct clients, counted once at their first-ever payment across Management + Project, refunds excluded." />
        <Stat label="Breakeven CAC" value={fmtMoney(breakeven)} sub="max, zero renewals"
          tip="Breakeven CAC (blended, §9): the mix-weighted Conservative Max CAC = Guaranteed Contribution. The most we could pay and still break even on the guaranteed term, with zero renewals." />
      </div>

      {/* new-client drill-down (click the count to verify — §6 trust anchor) */}
      {clientsOpen && (
        <div className={cn(card, "mb-6 p-4")}>
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              New client relationships · last {win} days
              <Tip>Every distinct client whose first-ever payment landed in this window (§6 counting). This is the exact list behind the count — Realized CAC is only as trustworthy as this list.</Tip>
            </span>
            <button onClick={() => setClientsOpen(false)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
          </div>
          {!clientList ? (
            <div className="h-16 animate-pulse rounded-[8px] bg-muted/40" />
          ) : clientList.clients.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No new client relationships counted in this window.</p>
          ) : (
            <div className="divide-y divide-border/50">
              {clientList.clients.map((c, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 text-sm">
                  <span className="font-medium text-foreground">{c.name}</span>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-medium uppercase tracking-wide">{c.firstType || "—"}</span>
                    <span className="tabular-nums">{fmtMoney(c.firstAmount)}</span>
                    <span className="tabular-nums">{new Date(c.acquiredAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── PER-PACKAGE ECONOMICS (§5) ───────────────────────────────────────── */}
      <section className={cn(card, "mb-6 p-5")}>
        <SectionHeader eyebrow="Per-package economics (§5)" title="Contribution Margin & Recommended Max CAC, by package" sub={`Realized CAC · rolling ${win}-day`}
          tip="Per §5: Contribution Margin % and $, Contribution Margin per Strategist Hour, Recommended Max CAC, and Realized CAC vs Recommended (over/under) for each tier. Variable costs only — never fixed overhead (§6.1)." />
        <div className="mb-4 inline-flex overflow-hidden rounded-[8px] border border-border text-xs">
          {([30, 60, 90] as WindowDays[]).map((d) => (
            <button key={d} onClick={() => setWin(d)}
              className={cn("px-3 py-1.5 font-semibold transition-colors", win === d ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/60")}>{d}d</button>
          ))}
        </div>

        {/* per-package table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-3 text-left font-semibold">Package</th>
                <th className="px-3 py-2 text-right font-semibold"><HeadTip label="Contribution %" tip="Contribution Margin % (§4) = Contribution Margin $ ÷ revenue. Only variable costs are deducted." /></th>
                <th className="px-3 py-2 text-right font-semibold"><HeadTip label="Contribution $" tip="Contribution Margin $ (§4) = Guaranteed Contribution over the 3-month term." /></th>
                <th className="px-3 py-2 text-right font-semibold"><HeadTip label="CAC Payback" tip="Months for Monthly Contribution to repay the current Realized CAC." /></th>
                <th className="px-3 py-2 text-right font-semibold"><HeadTip label="Recommended Max CAC" tip="Recommended Max CAC (§4) = MIN(Conservative Max CAC, Target Max CAC). Floor shown; (+hope) is the LTV basis." /></th>
                <th className="px-3 py-2 text-right font-semibold"><HeadTip label="Contribution / Strat-hr" tip="Contribution Margin per Strategist Hour (§5): Guaranteed Contribution ÷ strategist hours over the term. Strategist time is the capacity bottleneck." /></th>
                <th className="py-2 pl-3 text-right font-semibold"><HeadTip label="Realized vs Max" tip="Realized CAC vs Recommended Max CAC (§5), as a simple over/under indicator for this tier." /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {econ.map((e) => {
                const pb = paybackMonths(realized ?? 0, e.monthlyContribution);
                const over = acqTrustworthy && realized != null && realized > e.recommendedMaxCacFloor;
                const isOpen = expanded === e.id;
                return (
                  <Fragment key={e.id}>
                    <tr onClick={() => setExpanded(isOpen ? null : e.id)}
                      className={cn("cursor-pointer transition-colors hover:bg-muted/40", isOpen && "bg-muted/30")}>
                      <td className="py-2.5 pr-3">
                        <span className="font-semibold text-foreground">{e.name}</span>
                        <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{fmtMoney(e.monthlyPrice)}/mo</span>
                        {e.isCustom && <span className="ml-1.5 rounded bg-muted px-1 py-px text-[9px] font-semibold uppercase text-muted-foreground">custom</span>}
                        {!e.viable && <span className="ml-1.5 rounded bg-destructive/10 px-1 py-px text-[9px] font-semibold uppercase text-destructive">negative CM</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium"><Est>{fmtPct(e.contributionPct)}</Est></td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-foreground"><Est>{fmtMoney(e.contribution)}</Est></td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{acqTrustworthy && pb != null ? fmtMonths(pb) : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium"><Est>{fmtMoney(e.recommendedMaxCacFloor)}</Est>
                        <span className="ml-1 text-[10px] text-muted-foreground">(+{fmtMoneyK(e.recommendedMaxCacHope)} hope)</span></td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground"><Est>{e.contributionPerStrategistHour != null ? fmtMoney(e.contributionPerStrategistHour) : "—"}</Est></td>
                      <td className="py-2.5 pl-3 text-right">
                        {!acqTrustworthy || realized == null ? <span className="text-muted-foreground">—</span> :
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

        {/* Actual new clients vs expected mix (§5) */}
        <ExpectedMix econ={econ} actualNewClients={rollClients} window={win} trustworthy={acqTrustworthy} />

        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <span className="mt-px">Contribution leads with the <b className="font-semibold text-foreground">guaranteed 3-month floor</b>; the retention &quot;hope&quot; is the LTV basis, shown separately (§6.6 — some clients churned in 4&ndash;8 weeks). Dotted numbers are §8 estimates until real logged hours land. Click a row for the Variable-Cost breakdown.</span>
        </p>
      </section>

      {/* ── RETENTION (§5) — modelled now, actuals as data matures ────────────── */}
      <RetentionSection econ={econ} />

      {/* ═══ the visual firewall between the two questions (§6.5) ═══ */}
      <div className="mb-6 flex items-center gap-3 px-1">
        <span className="h-px flex-1 bg-border" />
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          <ArrowDown className="h-3 w-3" /> Whole-business health — a separate question (§6.5)
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      {/* ═══ WHOLE-BUSINESS HEALTH (§4/§5) — real totals, never per-client margins ═══ */}
      <section className={cn(card, "mb-6 overflow-hidden")}>
        <div className="border-b border-border bg-muted/20 px-6 py-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Whole-business health · Surplus / (Shortfall)
            <Tip>Question 2 of the spec (§4, §5): Total Monthly Contribution (all lines) minus Total Monthly Fixed Overhead. The real &quot;can we afford to run&quot; number — never computed by summing per-client fully-loaded margins (§6.5).</Tip>
          </p>
        </div>
        <div className="px-6 py-5">
          <p className="mb-4 text-lg leading-snug text-foreground sm:text-xl">
            In a typical month total revenue is{" "}
            <b className="font-bold tabular-nums text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{fmtMoney(pnl.revenue)}</b>{" "}
            and, after every cost, the surplus is{" "}
            <b className={cn("text-2xl font-bold tabular-nums sm:text-[26px]", pnl.net >= 0 ? "text-success" : "text-destructive")} style={{ fontFamily: "var(--font-heading)" }}>{fmtMoney(pnl.net)}</b>{" "}
            <span className="text-muted-foreground">— a {fmtPct(pnl.netPct)} net margin.</span>
          </p>

          <Bridge steps={pnlSteps(pnl)} height={210} />

          <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <MiniStat label="Total Revenue" tip="Total company revenue, all lines, actual monthly (§5). Real total, not one payment feed." value={fmtMoney(pnl.revenue)} estimate />
            <MiniStat label="Total Fixed Overhead" tip="Total company fixed overhead, actual monthly (§5): the whole team, founders, software, insurance, admin." value={fmtMoney(overheadTotal)} estimate />
            <MiniStat label="Surplus / (Shortfall)" tip="Total Monthly Contribution − Total Monthly Fixed Overhead (§4). The real 'can we afford to run' number." value={fmtMoney(pnl.net)} accent={pnl.net >= 0} danger={pnl.net < 0} />
            <MiniStat label="Net Margin" tip="Surplus ÷ total revenue. Reported here as a mix-health metric, never as an acquisition gate (§2)." value={fmtPct(pnl.netPct)} accent={pnl.net >= 0} danger={pnl.net < 0} />
          </div>

          {/* live cross-check + honesty */}
          <div className="mt-4 flex items-start gap-2 rounded-[8px] border border-border bg-muted/20 px-3 py-2.5 text-[11px] text-muted-foreground">
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span>
              These are your <b className="text-foreground">confirmed monthly actuals</b> (edit in Assumptions), seeded to the §9 reference (revenue {fmtMoney(98580)} → surplus {fmtMoney(12330)}, 12.5%).{" "}
              {liveRevenueAvailable
                ? <>Live cross-check: the payment system settled <b className="tabular-nums text-foreground">{fmtMoney(liveRevenue)}</b>{pnlMonth ? ` in ${pnlMonth}` : ""}. If that is well below the real total, revenue collected off that one system is the gap — confirm the true figure so the surplus stays accurate.</>
                : <>Connect the payment system to show a live cross-check against your confirmed total.</>}
            </span>
          </div>
        </div>
      </section>

      {/* ── CAC Planner ──────────────────────────────────────────────────────── */}
      <Planner draft={draft} econ={econ} blendedTarget={blendedTarget} />

      {drawerOpen && <AssumptionsDrawer draft={draft} setDraft={setDraft} onClose={() => setDrawerOpen(false)} econ={econ} />}
    </div>
    </div>
  );
}

// ─── Whole-business health → bridge steps (§4 whole-business formula) ───────────
function pnlSteps(pnl: ReturnType<typeof computeCompanyPnL>): BridgeStep[] {
  return [
    { label: "Total Revenue", value: pnl.revenue, kind: "anchor" },
    { label: "− Ad spend", value: pnl.adSpend, kind: "out", estimate: true },
    { label: "− Commission", value: pnl.commission, kind: "out", estimate: true },
    { label: "− Processing", value: pnl.processing, kind: "out", estimate: true },
    { label: "= Total Contribution", value: pnl.totalContribution, kind: "checkpoint" },
    { label: "− Fixed Overhead", value: pnl.totalOverhead, kind: "out", estimate: true },
    { label: "= Surplus", value: Math.abs(pnl.net), kind: "result" },
  ];
}

// ─── the three headline CAC numbers under the acquisition sentence ─────────────
function KeyNum({ label, value, sub, tip, tone, estimate }: { label: string; value: string; sub?: string; tip?: React.ReactNode; tone?: "good" | "bad" | "muted"; estimate?: boolean }) {
  return (
    <div className="rounded-[8px] border border-border bg-background px-3.5 py-3">
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}{tip && <Tip>{tip}</Tip>}</p>
      <p className={cn("mt-1 text-xl font-bold tabular-nums", tone === "good" ? "text-success" : tone === "bad" ? "text-destructive" : "text-foreground")} style={{ fontFamily: "var(--font-heading)" }}>
        <Est on={estimate}>{value}</Est>
      </p>
      {sub && <p className="mt-0.5 text-[10.5px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ─── stat cells ───────────────────────────────────────────────────────────────
function Stat({ label, value, sub, badge, accent, estimate, tip, onClick }: { label: string; value: string; sub?: string; badge?: { text: string; ok?: boolean }; accent?: boolean; estimate?: boolean; tip?: React.ReactNode; onClick?: () => void }) {
  return (
    <div className={cn("px-4 py-3.5", onClick && "cursor-pointer transition-colors hover:bg-muted/40")} onClick={onClick}>
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}{tip && <Tip>{tip}</Tip>}</p>
      <p className={cn("mt-1 text-lg font-bold tabular-nums text-foreground", onClick && "underline decoration-dotted decoration-muted-foreground/40 underline-offset-2")} style={{ fontFamily: "var(--font-heading)" }}>
        <Est on={estimate}>{value}</Est>
      </p>
      <div className="mt-0.5 flex items-center gap-1.5">
        {badge && <span className={cn("rounded-full px-1.5 py-px text-[9.5px] font-semibold", badge.ok === undefined ? "bg-muted text-muted-foreground" : badge.ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>{badge.text}</span>}
        {sub && <span className="text-[10.5px] text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}
function MiniStat({ label, value, accent, danger, estimate, tip }: { label: string; value: string; accent?: boolean; danger?: boolean; estimate?: boolean; tip?: React.ReactNode }) {
  return (
    <div className="rounded-[8px] border border-border bg-background px-3 py-2.5">
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}{tip && <Tip>{tip}</Tip>}</p>
      <p className={cn("mt-0.5 text-base font-bold tabular-nums", danger ? "text-destructive" : accent ? "text-success" : "text-foreground")} style={{ fontFamily: "var(--font-heading)" }}>
        <Est on={estimate}>{value}</Est>
      </p>
    </div>
  );
}
function HeadTip({ label, tip }: { label: string; tip: React.ReactNode }) {
  return <span className="inline-flex items-center justify-end gap-1">{label}<Tip>{tip}</Tip></span>;
}

// ─── Actual new clients vs expected mix (§5) ────────────────────────────────────
function ExpectedMix({ econ, actualNewClients, window, trustworthy }: { econ: TierEconomics[]; actualNewClients: number; window: number; trustworthy: boolean }) {
  const totalMix = econ.reduce((s, e) => s + e.expectedMonthlyCount, 0) || 1;
  return (
    <div className="mt-4 rounded-[8px] border border-border bg-background px-3.5 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Actual new clients vs expected mix
          <Tip>§5: the expected per-tier mix (weights used for the Blended Target CAC) against actual new clients closed. Per-tier attribution of the {actualNewClients} actual clients fills in as tier is logged at first payment.</Tip>
        </span>
        <span className="text-[11px] text-muted-foreground"><b className="tabular-nums text-foreground">{actualNewClients}</b> actual · {window}d{trustworthy ? "" : " (settling)"}</span>
      </div>
      {/* expected-mix bar */}
      <div className="flex h-2 w-full overflow-hidden rounded-full">
        {econ.map((e, i) => {
          const share = e.expectedMonthlyCount / totalMix;
          const shades = ["bg-primary", "bg-primary/80", "bg-primary/60", "bg-primary/40", "bg-primary/25"];
          return <div key={e.id} className={cn(shades[i % shades.length])} style={{ width: `${share * 100}%` }} title={`${e.name}: ${(share * 100).toFixed(0)}%`} />;
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {econ.map((e) => (
          <span key={e.id} className="text-[10.5px] text-muted-foreground">
            {e.name} <b className="tabular-nums text-foreground">{((e.expectedMonthlyCount / totalMix) * 100).toFixed(0)}%</b>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Retention (§5) — modelled now, actual columns as data matures ──────────────
function RetentionSection({ econ }: { econ: TierEconomics[] }) {
  return (
    <section className={cn(card, "mb-6 p-5")}>
      <SectionHeader eyebrow="Retention (§5)" title="Retention & LTV Contribution" sub="modelled now · actuals as data matures"
        tip="§5 retention: actual average months retained by tier (trailing cohort) and actual vs modelled LTV Contribution. Built once data volume supports it (§8) — the modelled basis is shown now, flagged as an estimate." />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="py-2 pr-3 text-left font-semibold">Package</th>
              <th className="px-3 py-2 text-right font-semibold"><HeadTip label="Modelled extra months" tip="Additional Months Retained beyond the guaranteed term (§8: 3/3/4/4/6 smallest→largest). An estimate — some 2026 clients churned in 4–8 weeks." /></th>
              <th className="px-3 py-2 text-right font-semibold"><HeadTip label="LTV Contribution" tip="LTV Contribution (§4) = Guaranteed Contribution + Monthly Contribution × Additional Months Retained. Modelled." /></th>
              <th className="px-3 py-2 text-right font-semibold">Actual months</th>
              <th className="py-2 pl-3 text-right font-semibold">Actual vs modelled</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {econ.map((e) => (
              <tr key={e.id}>
                <td className="py-2.5 pr-3 font-semibold text-foreground">{e.name}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-foreground"><Est>{e.additionalMonths} mo</Est></td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-foreground"><Est>{fmtMoney(e.ltvContribution)}</Est></td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground/60">—</td>
                <td className="py-2.5 pl-3 text-right tabular-nums text-muted-foreground/60">—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">Actual columns populate once there is enough client history to trust a trailing cohort (§8). Until then the modelled LTV is the hope, never the floor.</p>
    </section>
  );
}

// ─── recipe (per-package Variable-Cost breakdown — role hours on a waterfall) ───
function Recipe({ e, draft }: { e: TierEconomics; draft: Assumptions }) {
  const rows: { label: string; sub?: string; amount: number; share: number }[] = [
    ...ROLES.map((r) => ({ label: ROLE_LABELS[r], sub: `${fmtHours(e.labour[r].hours)}/mo`, amount: -e.labour[r].termCost, share: e.labour[r].shareOfPrice })),
    { label: "Contractor fee", sub: fmtPct(draft.contractorFeePct, 0), amount: -e.contractorFeeTerm, share: e.contractorFeeTerm / (e.termRevenue || 1) },
    { label: "Commission", sub: fmtPct(draft.commissionPct, 0), amount: -e.commissionTerm, share: e.commissionTerm / (e.termRevenue || 1) },
    { label: "Processing", sub: fmtPct(draft.processingPct, 1), amount: -e.processingTerm, share: e.processingTerm / (e.termRevenue || 1) },
  ];
  return (
    <div className="max-w-xl">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{e.name} — Contribution Margin build (3-mo term)</span>
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
          <span className="flex-1 text-[12.5px] font-bold text-foreground">= Contribution Margin</span>
          <span className="text-sm font-bold tabular-nums text-success" style={{ fontFamily: "var(--font-heading)" }}>{fmtMoney(e.contribution)} <span className="text-[11px] text-muted-foreground">({fmtPct(e.contributionPct)})</span></span>
        </div>
      </div>
    </div>
  );
}

// ─── CAC Planner (what-if) ──────────────────────────────────────────────────────
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
      <SectionHeader eyebrow="CAC Planner" title="What can we afford?" sub="floor vs hope"
        tip="Given a monthly ad budget and the Blended Target CAC, projects expected clients and Contribution: the guaranteed floor vs the LTV hope. Acquisition-level — before fixed overhead (§6.5)." />
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="space-y-4">
          <Field label="Monthly ad spend" value={fmtMoney(spend)}>
            <input type="range" min={0} max={50000} step={500} value={spend} onChange={(e) => setSpend(+e.target.value)} className="w-full accent-primary" />
          </Field>
          <Field label="Months" value={String(months)}>
            <input type="range" min={1} max={12} step={1} value={months} onChange={(e) => setMonths(+e.target.value)} className="w-full accent-primary" />
          </Field>
          <div className="rounded-[8px] bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">Planning at the Blended Target CAC of <b className="text-foreground tabular-nums">{fmtMoney(cac)}</b>/client.</div>
        </div>
        <div className="grid grid-cols-2 gap-3 self-start sm:grid-cols-3">
          <BigStat label="Expected Clients" value={clients.toFixed(1)} tip="Ad budget ÷ Blended Target CAC." />
          <BigStat label="Guaranteed Contribution" value={fmtMoney(guaranteed)} accent sub="the floor" tip="Contribution locked in over each client's 3-month guaranteed term, before fixed overhead." />
          <BigStat label="LTV Contribution" value={fmtMoney(hope)} sub="hope" estimate tip="With modelled retention — extra Contribution if clients stay past the term. A hope, not a guarantee (§6.6)." />
          <BigStat label="Total Ad Spend (CAC)" value={fmtMoney(totalSpend)} danger tip="Monthly ad spend × months — the acquisition cost." />
          <BigStat label="Contribution after CAC" value={fmtMoney(guaranteed - totalSpend)} accent={guaranteed - totalSpend >= 0} danger={guaranteed - totalSpend < 0} sub="guaranteed, before overhead" tip="Guaranteed Contribution minus ad spend. An acquisition number — it does NOT subtract fixed overhead (that is Whole-business health, §6.5)." />
          <BigStat label="Strategist Hours" value={fmtHours(stratHrs)} sub="capacity to serve" estimate tip="Strategist hours those clients would consume over the term — a capacity check on the bottleneck role (§5)." />
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
function BigStat({ label, value, sub, accent, danger, estimate, tip }: { label: string; value: string; sub?: string; accent?: boolean; danger?: boolean; estimate?: boolean; tip?: React.ReactNode }) {
  return (
    <div className="rounded-[8px] border border-border bg-background px-3 py-3">
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}{tip && <Tip>{tip}</Tip>}</p>
      <p className={cn("mt-1 text-xl font-bold tabular-nums", danger ? "text-destructive" : accent ? "text-success" : "text-foreground")} style={{ fontFamily: "var(--font-heading)" }}><Est on={estimate}>{value}</Est></p>
      {sub && <p className="mt-0.5 text-[10.5px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ─── assumptions drawer (dials + hours grid + real monthly actuals) ─────────────
function AssumptionsDrawer({ draft, setDraft, onClose, econ }: {
  draft: Assumptions; setDraft: (a: Assumptions) => void; onClose: () => void; econ: TierEconomics[];
}) {
  const setHours = (tierId: string, role: Role, v: number) =>
    setDraft({ ...draft, tiers: draft.tiers.map((t) => t.id === tierId ? { ...t, hours: { ...t.hours, [role]: Math.max(0, v) } } : t) });
  const setSalary = (role: Role, v: number) => setDraft({ ...draft, roleMonthlySalary: { ...draft.roleMonthlySalary, [role]: Math.max(0, v) } });
  const setOverhead = (key: keyof Assumptions["overhead"], v: number) => setDraft({ ...draft, overhead: { ...draft.overhead, [key]: Math.max(0, v) } });
  const setActual = (key: keyof Assumptions["companyActuals"], v: number) => setDraft({ ...draft, companyActuals: { ...draft.companyActuals, [key]: Math.max(0, v) } });

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
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0 text-primary" />
            <span>Hours, retention and the contractor fee are <b>§8 estimates</b> calibrated to the current model, pending real time-tracking. Edit them to your real figures.</span>
          </div>

          {/* whole-business monthly actuals */}
          <div>
            <p className="mb-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Whole-business monthly actuals <Tip>Real total figures for a typical month, all lines (§5/§6.4). These drive Whole-business health — not a single payment feed.</Tip>
            </p>
            <div className="space-y-1.5">
              {([
                ["revenue", "Total revenue (all lines)"],
                ["adSpend", "Ad spend"],
                ["commission", "Sales commission paid"],
                ["processing", "Processing fees"],
              ] as const).map(([k, label]) => (
                <div key={k} className="flex items-center justify-between rounded-[6px] border border-border px-2.5 py-1.5">
                  <span className="text-[12px] text-foreground">{label}</span>
                  <div className="flex items-center gap-1"><span className="text-xs text-muted-foreground">$</span>
                    <input type="number" min={0} value={draft.companyActuals[k]} onChange={(e) => setActual(k, +e.target.value)}
                      className="w-24 rounded border-b border-transparent bg-transparent text-right text-[13px] tabular-nums text-foreground focus:border-primary/60 focus:outline-none" /></div>
                </div>
              ))}
            </div>
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
                    <td className="px-2 py-1.5 font-semibold uppercase tracking-wide text-muted-foreground">Contribution %</td>
                    {econ.map((e) => <td key={e.id} className="px-1.5 py-1.5 text-right font-bold tabular-nums text-primary">{fmtPct(e.contributionPct)}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-[10.5px] text-muted-foreground">The small number by each role is its monthly salary (÷160 gives the hourly rate automatically — §3, you never type a rate).</p>
          </div>

          {/* scalar dials */}
          <div className="grid grid-cols-2 gap-3">
            <Dial label="Commission %" value={draft.commissionPct * 100} onChange={(v) => setDraft({ ...draft, commissionPct: v / 100 })} suffix="%" />
            <Dial label="Processing %" value={draft.processingPct * 100} onChange={(v) => setDraft({ ...draft, processingPct: v / 100 })} suffix="%" />
            <Dial label="Contractor fee %" value={draft.contractorFeePct * 100} onChange={(v) => setDraft({ ...draft, contractorFeePct: v / 100 })} suffix="%" est />
            <Dial label="LTV:CAC target" value={draft.ltvCacTarget} onChange={(v) => setDraft({ ...draft, ltvCacTarget: v })} suffix="x" />
            <Dial label="Term (months)" value={draft.termMonths} onChange={(v) => setDraft({ ...draft, termMonths: Math.round(v) })} />
          </div>

          {/* retention per tier */}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Additional months retained <span className="normal-case text-muted-foreground/70">(§8 estimate)</span></p>
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

          {/* fixed overhead */}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Total fixed overhead <span className="normal-case text-primary tabular-nums">= {fmtMoney(sumOverhead(draft.overhead))}</span></p>
            <div className="space-y-1.5">
              {(["teamPayroll", "founderComp", "software", "insurance", "otherAdmin"] as const).map((k) => (
                <div key={k} className="flex items-center justify-between rounded-[6px] border border-border px-2.5 py-1.5">
                  <span className="text-[12px] text-foreground">{OVERHEAD_LABELS[k]}</span>
                  <div className="flex items-center gap-1"><span className="text-xs text-muted-foreground">$</span>
                    <input type="number" min={0} value={draft.overhead[k]} onChange={(e) => setOverhead(k, +e.target.value)}
                      className="w-24 rounded border-b border-transparent bg-transparent text-right text-[13px] tabular-nums text-foreground focus:border-primary/60 focus:outline-none" /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
const OVERHEAD_LABELS: Record<string, string> = { teamPayroll: "Team & delivery payroll", founderComp: "Founder compensation", software: "Software & tools", insurance: "Insurance & admin", otherAdmin: "Other" };
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
