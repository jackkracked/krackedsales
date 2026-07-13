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

/** Dotted-underline "estimate" treatment (CDO): a number that isn't measured-real yet. */
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

  // ── whole-company P&L — from Gage's real monthly ACTUALS (§6.4), never a partial feed ──
  const pnl = computeCompanyPnL(draft.companyActuals, draft);
  const overheadTotal = sumOverhead(draft.overhead);
  const liveRevenue = live?.month.revenue ?? 0; // last complete month from Stripe cash — CROSS-CHECK only
  const liveRevenueAvailable = !!live?.month.revenueAvailable;
  const pnlMonth = live?.month.label;

  // ── acquisition (question 1) — Contribution basis, NEVER fixed overhead ───────
  const realized = live?.realized.cac ?? null;
  const rollAdSpend = live?.realized.adSpend ?? 0;
  const rollClients = live?.realized.newClients ?? 0;
  const clientsAvailable = !!live?.realized.clientsAvailable;
  const spendCampaigns = live?.realized.byCampaign ?? [];
  const contribPerClient = blendedContributionPerClient(econ); // guaranteed $/client, blended by mix
  const ltvPerClient = blendedLtvPerClient(econ); // with modelled retention (the "hope")
  const monthlyContribPerClient = blendedMonthlyContributionPerClient(econ);
  const blendedTargetHope = blendedTargetCac(econ, "hope"); // ceiling if retention holds (§6.6 shows both)
  const ltvCacRatio = realized && realized > 0 ? ltvPerClient / realized : null;
  const payback = realized != null ? paybackMonths(realized, monthlyContribPerClient) : null;
  const cacUnder = realized != null && realized <= blendedTarget;

  // What the spend is BUILT to return at our validated target CAC (the honest model answer
  // while realized closes are still settling).
  const impliedClients = blendedTarget > 0 ? rollAdSpend / blendedTarget : 0;
  const impliedProfit = impliedClients * contribPerClient;
  // Realized closes lag the spend that produced them. Only trust the realized cost-per-client
  // once enough have settled vs what the spend implies (the ramp gate) — otherwise a timing /
  // under-count artifact reads as a catastrophic CAC.
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
          <p className="mt-0.5 text-sm text-muted-foreground">What we spend to grow, and what we keep. Two questions, kept separate.</p>
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

      {/* ═══ QUESTION 1 — Is our ad spend worth it? (Contribution basis, no overhead) ═══ */}
      <div className={cn(card, "mb-4 overflow-hidden")}>
        <div className="border-b border-border bg-muted/20 px-6 py-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Question 1 — is our ad spend worth it?
            <Tip>The only costs counted here are the costs of serving a client (their team&apos;s hours, commission, card fees). Fixed bills like salaries and rent are deliberately left out — that&apos;s Question 2 below. Mixing them is the classic mistake this page is built to avoid.</Tip>
          </p>
        </div>
        <div className="px-6 py-5">
          {acqTrustworthy ? (
            <p className="text-lg leading-snug text-foreground sm:text-xl">
              We spent{" "}
              <b className="font-bold tabular-nums text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{fmtMoney(rollAdSpend)}</b>{" "}
              on ads in the last {win} days and brought in{" "}
              <b className="font-bold tabular-nums text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{rollClients} client{rollClients === 1 ? "" : "s"}</b>{" "}
              at <b className="tabular-nums">{realized != null ? fmtMoney(realized) : "—"}</b> each. At our average client value they&apos;re worth about{" "}
              <b className="font-bold tabular-nums text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{fmtMoney(realizedProfit)}</b>{" "}
              in guaranteed profit, so after the ad spend we&apos;re up{" "}
              <b className={cn("text-2xl font-bold tabular-nums sm:text-[26px]", acqNet >= 0 ? "text-success" : "text-destructive")} style={{ fontFamily: "var(--font-heading)" }}>{fmtMoney(acqNet)}</b>
              {acqReturn != null && <span className="text-muted-foreground"> — a {fmtRatio(acqReturn)} return, before any renewals.</span>}
            </p>
          ) : (
            <p className="text-lg leading-snug text-foreground sm:text-xl">
              We spent{" "}
              <b className="font-bold tabular-nums text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{fmtMoney(rollAdSpend)}</b>{" "}
              on ads in the last {win} days. Each client we bring in is worth about{" "}
              <b className="font-bold tabular-nums text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{fmtMoney(contribPerClient)}</b>{" "}
              in guaranteed profit, and we can afford up to{" "}
              <b className="font-bold tabular-nums text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{fmtMoney(blendedTarget)}</b>{" "}
              to get one (guaranteed floor; up to <b className="tabular-nums">{fmtMoney(blendedTargetHope)}</b> if they renew). At that rate this spend is built to return about{" "}
              <b className="font-bold tabular-nums text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{impliedClients.toFixed(0)} clients</b>{" "}
              (~<b className="tabular-nums">{fmtMoney(impliedProfit)}</b> guaranteed).{" "}
              <span className="text-muted-foreground">
                <b className="tabular-nums text-foreground">{rollClients}</b> ha{rollClients === 1 ? "s" : "ve"} settled so far, so the true cost-per-client is still landing.
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

          {/* the three numbers that make the answer, at a glance */}
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <KeyNum label="Worth per client" tip="What one new client is worth to us in guaranteed profit over their 3-month minimum — counting only the cost of serving them, not fixed bills." value={fmtMoney(contribPerClient)} sub="guaranteed, first 3 months" estimate />
            <KeyNum label="Most we'll pay to get one" tip="Two ceilings, per the spec: the FLOOR is what we can pay and still profit on the guaranteed 3 months alone (no renewals). The HOPE is the higher ceiling if clients stay past their minimum. We lead with the floor and never bank on the hope." value={fmtMoney(blendedTarget)} sub={`guaranteed floor · up to ${fmtMoney(blendedTargetHope)} if they renew`} />
            <KeyNum label={`Cost per client · ${win}d`} tip="What we actually paid in ads per new client over this window (ad spend ÷ new clients). Needs enough settled closes to trust." value={realized != null ? fmtMoney(realized) : "—"}
              sub={acqTrustworthy ? (cacUnder ? "under target — good" : "over target") : "still settling"}
              tone={!acqTrustworthy ? "muted" : cacUnder ? "good" : "bad"} estimate={!acqTrustworthy} />
          </div>
        </div>
      </div>

      {/* ── At-a-glance strip ────────────────────────────────────────────────── */}
      <div className={cn(card, "mb-6 grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0")}>
        <Stat label={`Cost per client · ${win}d`} value={realized != null ? fmtMoney(realized) : "—"} accent
          tip="Realized CAC — total ad spend ÷ new clients in this window."
          badge={realized != null ? { text: acqTrustworthy ? (cacUnder ? "under target" : "over target") : "settling", ok: acqTrustworthy ? cacUnder : undefined } : undefined}
          sub={`vs ${fmtMoney(blendedTarget)} target`} estimate={!acqTrustworthy} />
        <Stat label="LTV : CAC" value={ltvCacRatio != null ? fmtRatio(ltvCacRatio) : "—"} accent
          tip="For every $1 we spend to get a client, how many dollars they're worth back. 3:1 or higher is healthy. Uses modelled retention, so treat as a hope until churn data matures."
          badge={ltvCacRatio != null ? { text: ltvCacRatio >= 3 ? "healthy" : "thin", ok: ltvCacRatio >= 3 } : undefined}
          sub="3:1 healthy · retention hope" estimate />
        <Stat label="CAC payback" value={payback != null ? fmtMonths(payback) : "—"}
          tip="How many months a new client takes to pay back what we spent to acquire them. Inside the 3-month term is safe."
          sub={`term is ${draft.termMonths} mo`} badge={payback != null ? { text: payback < draft.termMonths ? "inside term" : "past term", ok: payback < draft.termMonths } : undefined} estimate />
        <Stat label={`New clients · ${win}d`} value={String(rollClients)} sub="click to verify who" onClick={() => setClientsOpen((v) => !v)}
          tip="Distinct new clients in this window, counted once at their first-ever payment (management or project), refunds excluded." />
        <Stat label="Blended breakeven" value={fmtMoney(breakeven)} sub="max before losing money"
          tip="The absolute most we could pay to acquire a client and still break even on their guaranteed 3 months, assuming zero renewals." />
      </div>

      {/* new-client drill-down (click the count to verify) */}
      {clientsOpen && (
        <div className={cn(card, "mb-6 p-4")}>
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              New clients counted · last {win} days
              <Tip>Every distinct client whose first-ever payment landed in this window. This is the exact list behind the count above — the number is only as trustworthy as this list.</Tip>
            </span>
            <button onClick={() => setClientsOpen(false)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
          </div>
          {!clientList ? (
            <div className="h-16 animate-pulse rounded-[8px] bg-muted/40" />
          ) : clientList.clients.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No new clients counted in this window.</p>
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

      {/* ── ① Per-package: which packages make the best use of ad money ───────── */}
      <section className={cn(card, "mb-6 p-5")}>
        <SectionHeader eyebrow="Per package" title="Which packages are worth acquiring?" sub={`rolling ${win}-day`}
          tip="Each package's guaranteed profit and the most we should pay to acquire one. Everything here counts only the cost of serving a client, never fixed overhead." />
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
                <th className="px-3 py-2 text-right font-semibold"><HeadTip label="Profit %" tip="Contribution margin — the share of a client's payment left after only the costs of serving them (team hours, commission, card fees)." /></th>
                <th className="px-3 py-2 text-right font-semibold"><HeadTip label="Profit (3 mo)" tip="Guaranteed profit in dollars from one client over their 3-month minimum." /></th>
                <th className="px-3 py-2 text-right font-semibold"><HeadTip label="Payback" tip="Months for a client to pay back what we spent to acquire them, at the current cost per client." /></th>
                <th className="px-3 py-2 text-right font-semibold"><HeadTip label="Max CAC (floor)" tip="The most we should pay to acquire this client, based only on their guaranteed 3 months. The safe ceiling; the '+hope' is the extra if they renew." /></th>
                <th className="px-3 py-2 text-right font-semibold"><HeadTip label="$/strat hr" tip="Guaranteed profit per hour of strategist time — our scarcest resource. Higher = better use of delivery capacity." /></th>
                <th className="py-2 pl-3 text-right font-semibold"><HeadTip label="vs realized" tip="Whether our actual cost-to-acquire is under (clears) or over this package's safe ceiling." /></th>
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
                        {!e.viable && <span className="ml-1.5 rounded bg-destructive/10 px-1 py-px text-[9px] font-semibold uppercase text-destructive">loses money</span>}
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
        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <span className="mt-px">Profit leads with the <b className="font-semibold text-foreground">guaranteed 3-month floor</b>; the retention &quot;hope&quot; is shown separately (some clients have churned in 4&ndash;8 weeks). Dotted numbers are estimates until real logged hours land. Click any row to see how its profit is built.</span>
        </p>
      </section>

      {/* ═══ the visual firewall between the two questions (§6.5) ═══ */}
      <div className="mb-6 flex items-center gap-3 px-1">
        <span className="h-px flex-1 bg-border" />
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          <ArrowDown className="h-3 w-3" /> A completely different question
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      {/* ═══ QUESTION 2 — After every bill, does the whole company profit? ═══ */}
      <section className={cn(card, "mb-6 overflow-hidden")}>
        <div className="border-b border-border bg-muted/20 px-6 py-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Question 2 — after every bill, does the company profit?
            <Tip>This counts EVERYTHING the business pays in a month — the whole team, founders, software, ads, fees. A single package can be worth acquiring (Question 1) while the whole company still needs to watch its costs. Never read one as the other.</Tip>
          </p>
        </div>
        <div className="px-6 py-5">
          <p className="mb-4 text-lg leading-snug text-foreground sm:text-xl">
            In a typical month the company brings in{" "}
            <b className="font-bold tabular-nums text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{fmtMoney(pnl.revenue)}</b>{" "}
            and, after paying for absolutely everything, keeps{" "}
            <b className={cn("text-2xl font-bold tabular-nums sm:text-[26px]", pnl.net >= 0 ? "text-success" : "text-destructive")} style={{ fontFamily: "var(--font-heading)" }}>{fmtMoney(pnl.net)}</b>{" "}
            <span className="text-muted-foreground">— that&apos;s {fmtPct(pnl.netPct)} of every dollar.</span>
          </p>

          <Bridge steps={pnlSteps(pnl)} height={210} />

          <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <MiniStat label="Money in" tip="All revenue the company brings in during the month, across every service line — not just what settled through one payment processor." value={fmtMoney(pnl.revenue)} estimate />
            <MiniStat label="What it costs to run" tip="Everything the business pays each month: the whole team, founders' pay, software, insurance, ads and fees." value={fmtMoney(pnl.variableTotal + overheadTotal)} estimate />
            <MiniStat label="Kept" tip="What's left after every single cost is paid — the real 'can we afford to run' number." value={fmtMoney(pnl.net)} accent={pnl.net >= 0} danger={pnl.net < 0} />
            <MiniStat label="Margin" tip="Kept as a share of revenue. 12.5% means we keep about 12.5 cents of every dollar." value={fmtPct(pnl.netPct)} accent={pnl.net >= 0} danger={pnl.net < 0} />
          </div>

          {/* live cross-check + honesty */}
          <div className="mt-4 flex items-start gap-2 rounded-[8px] border border-border bg-muted/20 px-3 py-2.5 text-[11px] text-muted-foreground">
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span>
              These are your <b className="text-foreground">confirmed monthly figures</b> (edit them in Assumptions).{" "}
              {liveRevenueAvailable
                ? <>Live cross-check: our payment system settled <b className="tabular-nums text-foreground">{fmtMoney(liveRevenue)}</b>{pnlMonth ? ` in ${pnlMonth}` : ""}. If that&apos;s well below your real total, revenue collected off that one system is the gap — confirm the true number so &quot;kept&quot; stays accurate.</>
                : <>Connect the payment system to show a live cross-check against your confirmed total.</>}
            </span>
          </div>
        </div>
      </section>

      {/* ── ③ Planner ────────────────────────────────────────────────────────── */}
      <Planner draft={draft} econ={econ} blendedTarget={blendedTarget} />

      {drawerOpen && <AssumptionsDrawer draft={draft} setDraft={setDraft} onClose={() => setDrawerOpen(false)} econ={econ} />}
    </div>
    </div>
  );
}

// ─── company P&L → bridge steps ───────────────────────────────────────────────
function pnlSteps(pnl: ReturnType<typeof computeCompanyPnL>): BridgeStep[] {
  return [
    { label: "Money in", value: pnl.revenue, kind: "anchor" },
    { label: "− Ads", value: pnl.adSpend, kind: "out", estimate: true },
    { label: "− Commission", value: pnl.commission, kind: "out", estimate: true },
    { label: "− Card fees", value: pnl.processing, kind: "out", estimate: true },
    { label: "= After client costs", value: pnl.totalContribution, kind: "checkpoint" },
    { label: "− Team, founders, software", value: pnl.totalOverhead, kind: "out", estimate: true },
    { label: "= Kept", value: Math.abs(pnl.net), kind: "result" },
  ];
}

// ─── the three headline numbers under the acquisition sentence ─────────────────
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
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">How {e.name}&apos;s profit is built (3 months)</span>
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
      <SectionHeader eyebrow="Planner" title="What can we afford?" sub="floor vs hope"
        tip="Move the sliders to see what a given ad budget is built to return, at your target cost-per-client. 'Guaranteed' is locked in over the 3-month minimum; 'if retention holds' is the upside if clients stay." />
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
          <BigStat label="Expected clients" value={clients.toFixed(1)} tip="Ad budget ÷ your target cost-per-client." />
          <BigStat label="Guaranteed profit" value={fmtMoney(guaranteed)} accent sub="the floor" tip="Profit locked in over each client's 3-month minimum, before fixed overhead." />
          <BigStat label="If retention holds" value={fmtMoney(hope)} sub="hope" estimate tip="Extra profit IF clients stay past their minimum. A hope, not a guarantee." />
          <BigStat label="Total ad spend" value={fmtMoney(totalSpend)} danger tip="Monthly ad spend × months." />
          <BigStat label="Net (guaranteed)" value={fmtMoney(guaranteed - totalSpend)} accent={guaranteed - totalSpend >= 0} danger={guaranteed - totalSpend < 0} sub="after ad spend, before overhead" tip="Guaranteed client profit minus the ad spend to acquire them. This is an acquisition number — it does NOT subtract fixed overhead (that's Question 2)." />
          <BigStat label="Strategist hours" value={fmtHours(stratHrs)} sub="capacity to serve them" estimate tip="Strategist hours those clients would need over the term — a capacity check on our scarcest role." />
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
            <span>Hours, retention and the contractor fee are <b>reasoned estimates</b> calibrated to your current model, pending real time-tracking. Edit them to your real figures.</span>
          </div>

          {/* whole-company real monthly actuals (Question 2) */}
          <div>
            <p className="mb-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Whole-company monthly actuals <Tip>Your real total figures for a typical month, across every service line. These drive the &quot;after every bill, does the company profit?&quot; section — not a single payment feed.</Tip>
            </p>
            <div className="space-y-1.5">
              {([
                ["revenue", "Total revenue (all lines)"],
                ["adSpend", "Ad spend"],
                ["commission", "Sales commission paid"],
                ["processing", "Card / processing fees"],
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
