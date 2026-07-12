/**
 * Unit-economics engine — Contribution Margin & CAC (per Gage's spec).
 *
 * TWO SEPARATE CALCULATIONS, on purpose (spec §1, §2, §6.5):
 *   1. Per-package model — "is a client / ad £ worth it?". VARIABLE costs only (marginal
 *      labour = hours × rate, commission, processing, contractor fee). NEVER touches fixed
 *      overhead. Drives contribution, CAC ceilings, payback, the recipe waterfall.
 *   2. Company P&L — "did the business keep money?". REAL TOTAL revenue and REAL TOTAL
 *      expenses (real salaries live in overhead here, not marginal hours), per §6.4. Never
 *      reconstructed from #1.
 *
 * Pure functions, no I/O — one engine feeds the API, the UI, and the tests; they can never
 * disagree. Full precision kept INSIDE the engine (round only at the presentation boundary).
 * Total over its declared types: every input is coerced finite so one bad row can never NaN
 * the whole dashboard (Principal-Engineer review C2). Money in whole dollars.
 */

export type Role = "designer" | "copywriter" | "strategist" | "tech";
export const ROLES: Role[] = ["designer", "copywriter", "strategist", "tech"];
export const ROLE_LABELS: Record<Role, string> = {
  designer: "Designer",
  copywriter: "Copywriter",
  strategist: "Strategist",
  tech: "Tech",
};

/** Hours a blended monthly salary buys (spec §34: monthly rate ÷ 160). */
export const HOURS_PER_MONTH = 160;

/** Coerce to a finite number; anything else (NaN, undefined, string, Infinity) → fallback. */
export function num(x: unknown, fallback = 0): number {
  return typeof x === "number" && Number.isFinite(x) ? x : fallback;
}
/** Divide, returning null (not NaN/Infinity) when the denominator is 0. */
export function safeDiv(a: number, b: number): number | null {
  return b !== 0 && Number.isFinite(b) ? a / b : null;
}

// ── Editable inputs (the "dials") ───────────────────────────────────────────────

export interface TierInput {
  id: string;
  name: string;
  monthlyPrice: number;
  deliverables: string;
  isCustom: boolean;
  additionalMonths: number; // retention beyond term (§8: 3/3/4/4/6). Estimate.
  hours: Record<Role, number>; // monthly hours per role, per client. Estimate.
  expectedMonthlyCount: number; // weights the blended target CAC (a WEIGHT, not a forecast).
}

export interface OverheadInput {
  teamPayroll: number; // real delivery-team monthly salary total
  founderComp: number;
  software: number; // ideally live from software_costs
  insurance: number;
  otherAdmin: number;
}

export interface Assumptions {
  termMonths: number; // guaranteed commitment, e.g. 3
  commissionPct: number; // 0.10
  processingPct: number; // 0.027
  contractorFeePct: number; // estimate
  ltvCacTarget: number; // 3
  roleMonthlySalary: Record<Role, number>;
  tiers: TierInput[];
  overhead: OverheadInput;
  // Whole-company monthly ACTUALS (§5/§6.4). Real total revenue + real total variable costs —
  // Gage's confirmed figures, NOT reconstructed from the per-client model or a single Stripe
  // feed. Seeded to reproduce §9 (net ~$12,330 / 12.5%); editable monthly.
  companyActuals: CompanyActuals;
}

// ── Outputs ─────────────────────────────────────────────────────────────────────

export interface RoleLabour {
  hours: number; // monthly
  hourlyRate: number;
  monthlyCost: number;
  termCost: number;
  shareOfPrice: number; // this role's term cost ÷ term revenue (for the recipe micro-bars)
}

export interface TierEconomics {
  id: string;
  name: string;
  monthlyPrice: number;
  isCustom: boolean;
  additionalMonths: number;
  expectedMonthlyCount: number;
  termRevenue: number;
  labour: Record<Role, RoleLabour>;
  rawLabourTerm: number;
  contractorFeeTerm: number;
  commissionTerm: number;
  processingTerm: number;
  variableCostTerm: number;
  contribution: number; // guaranteed-term contribution $ (signed — negative is real info)
  contributionPct: number;
  monthlyContribution: number;
  /** contribution > 0 — false means this tier loses money at these hours (don't acquire). */
  viable: boolean;
  ltvContribution: number; // with retention (the "hope")
  conservativeMaxCac: number; // = guaranteed contribution, clamped ≥ 0
  // Floor basis (0 extra months) — the honest primary number we lead with (§6.6, §7).
  targetMaxCacFloor: number;
  recommendedMaxCacFloor: number; // clamped ≥ 0
  // Retention basis — the clearly-labelled upside.
  targetMaxCacHope: number;
  recommendedMaxCacHope: number; // clamped ≥ 0
  contributionPerStrategistHour: number | null; // null when no strategist hours (§5 bottleneck)
}

export interface CompanyPnL {
  revenue: number;
  adSpend: number;
  commission: number;
  processing: number;
  variableTotal: number;
  totalContribution: number; // revenue − variable (the mid-checkpoint, §4)
  overhead: OverheadInput;
  totalOverhead: number;
  net: number; // = total contribution − overhead (surplus/shortfall)
  netPct: number;
}

// ── Per-package model (question 1) ──────────────────────────────────────────────

export function hourlyRates(a: Assumptions): Record<Role, number> {
  const s = a.roleMonthlySalary;
  const per = (v: unknown) => num(v) / HOURS_PER_MONTH;
  return { designer: per(s.designer), copywriter: per(s.copywriter), strategist: per(s.strategist), tech: per(s.tech) };
}

/** MIN(guaranteed cap, contribution-basis ÷ ratio), never below 0. Both floor and hope
 *  flow through this one path so they can never structurally drift (Eng review C1). */
function recommendedMaxCac(conservative: number, basisContribution: number, ratio: number): { target: number; recommended: number } {
  const target = ratio > 0 ? basisContribution / ratio : 0;
  return { target: Math.max(0, target), recommended: Math.max(0, Math.min(conservative, target)) };
}

export function computeTier(t: TierInput, a: Assumptions): TierEconomics {
  const T = Math.max(1, num(a.termMonths, 1)); // never divide by a 0-month term
  const rates = hourlyRates(a);
  const monthlyPrice = num(t.monthlyPrice);
  const termRevenue = monthlyPrice * T;

  const labour = {} as Record<Role, RoleLabour>;
  let rawLabourTerm = 0;
  for (const r of ROLES) {
    const hours = num(t.hours?.[r]);
    const hourlyRate = rates[r];
    const monthlyCost = hours * hourlyRate;
    const termCost = monthlyCost * T;
    labour[r] = { hours, hourlyRate, monthlyCost, termCost, shareOfPrice: termRevenue > 0 ? termCost / termRevenue : 0 };
    rawLabourTerm += termCost;
  }

  const contractorFeeTerm = rawLabourTerm * num(a.contractorFeePct);
  const commissionTerm = termRevenue * num(a.commissionPct);
  const processingTerm = termRevenue * num(a.processingPct);
  const variableCostTerm = rawLabourTerm + contractorFeeTerm + commissionTerm + processingTerm;

  const contribution = termRevenue - variableCostTerm; // signed
  const contributionPct = termRevenue > 0 ? contribution / termRevenue : 0;
  const monthlyContribution = contribution / T;
  const additionalMonths = Math.max(0, num(t.additionalMonths));
  const ltvContribution = contribution + monthlyContribution * additionalMonths;

  const conservativeMaxCac = Math.max(0, contribution);
  const ratio = num(a.ltvCacTarget);
  const floor = recommendedMaxCac(conservativeMaxCac, contribution, ratio);
  const hope = recommendedMaxCac(conservativeMaxCac, ltvContribution, ratio);

  const stratHoursTerm = labour.strategist.hours * T;
  const contributionPerStrategistHour = stratHoursTerm > 0 ? contribution / stratHoursTerm : null;

  return {
    id: t.id,
    name: t.name,
    monthlyPrice,
    isCustom: !!t.isCustom,
    additionalMonths,
    expectedMonthlyCount: Math.max(0, num(t.expectedMonthlyCount)),
    termRevenue,
    labour,
    rawLabourTerm,
    contractorFeeTerm,
    commissionTerm,
    processingTerm,
    variableCostTerm,
    contribution,
    contributionPct,
    monthlyContribution,
    viable: contribution > 0,
    ltvContribution,
    conservativeMaxCac,
    targetMaxCacFloor: floor.target,
    recommendedMaxCacFloor: floor.recommended,
    targetMaxCacHope: hope.target,
    recommendedMaxCacHope: hope.recommended,
    contributionPerStrategistHour,
  };
}

export function computeTiers(a: Assumptions): TierEconomics[] {
  return (a.tiers ?? []).map((t) => computeTier(t, a));
}

/** Weighted-by-mix blended targets (§4). Floor = the honest 0-extra-months number §9
 *  validates (~$770); hope = the retention-based upside. Blends over TierEconomics (which
 *  carries its own expectedMonthlyCount) so there's no parallel-array index coupling. */
export function blendedTargetCac(econ: TierEconomics[], basis: "floor" | "hope" = "floor"): number {
  let weighted = 0;
  let count = 0;
  for (const e of econ) {
    const rec = basis === "hope" ? e.recommendedMaxCacHope : e.recommendedMaxCacFloor;
    weighted += rec * e.expectedMonthlyCount;
    count += e.expectedMonthlyCount;
  }
  return count > 0 ? weighted / count : 0;
}

/** Blended breakeven = weighted conservative (guaranteed) max CAC, no renewals (§9 ~$2,310). */
export function blendedBreakevenCac(econ: TierEconomics[]): number {
  let weighted = 0;
  let count = 0;
  for (const e of econ) {
    weighted += e.conservativeMaxCac * e.expectedMonthlyCount;
    count += e.expectedMonthlyCount;
  }
  return count > 0 ? weighted / count : 0;
}

/** Realized CAC = total acquisition spend ÷ new client relationships (all, deduped) — §6.
 *  null when the count is 0 (honest: no clients, no CAC — never Infinity). */
export function realizedCac(adSpend: number, newClients: number): number | null {
  return safeDiv(num(adSpend), num(newClients));
}

/** CAC payback in months = CAC ÷ monthly GUARANTEED contribution (floor basis, never LTV).
 *  null when monthly contribution ≤ 0. Payback ≥ term is the danger zone (§8 fast churn). */
export function paybackMonths(cac: number, monthlyContribution: number): number | null {
  return monthlyContribution > 0 ? num(cac) / monthlyContribution : null;
}

// ── Company P&L (question 2) — real totals, per §6.4 ────────────────────────────

export function sumOverhead(o: OverheadInput): number {
  return num(o?.teamPayroll) + num(o?.founderComp) + num(o?.software) + num(o?.insurance) + num(o?.otherAdmin);
}

/** Real, actual monthly figures for the whole-company P&L (§6.4 — combined real totals, NOT
 *  reconstructed from the per-client model). Commission & processing are ACTUALS (what was
 *  paid), never % of recurring revenue (recurring revenue doesn't re-pay commission monthly). */
export interface CompanyActuals {
  revenue: number; // all lines incl. off-Stripe / white-label
  adSpend: number; // all channels
  commission: number; // actually paid this period
  processing: number; // actual processor fees
}

export function computeCompanyPnL(actuals: CompanyActuals, a: Assumptions): CompanyPnL {
  const revenue = num(actuals?.revenue);
  const adSpend = num(actuals?.adSpend);
  const commission = num(actuals?.commission);
  const processing = num(actuals?.processing);
  const variableTotal = adSpend + commission + processing;
  const totalContribution = revenue - variableTotal;
  const totalOverhead = sumOverhead(a.overhead);
  const net = totalContribution - totalOverhead;
  return {
    revenue,
    adSpend,
    commission,
    processing,
    variableTotal,
    totalContribution,
    overhead: a.overhead,
    totalOverhead,
    net,
    netPct: revenue > 0 ? net / revenue : 0,
  };
}

// ── Planner (what-if) ───────────────────────────────────────────────────────────

export interface PlannerResult {
  adSpend: number;
  months: number;
  blendedCac: number;
  expectedClients: number;
  guaranteedContribution: number; // the floor
  ltvContribution: number; // the hope
  contributionAfterSpendGuaranteed: number; // contribution AFTER acquisition cost, BEFORE fixed overhead
  contributionAfterSpendLtv: number;
  strategistHoursConsumed: number; // capacity check (§5 bottleneck)
  perTier: { id: string; name: string; clients: number; guaranteed: number; ltv: number }[];
}

/**
 * Given a monthly ad spend, months, and a CAC-per-client to plan against, project clients (by
 * the expected mix) and the guaranteed-floor vs LTV-hope contribution. NOTE the returned
 * "after spend" figures are contribution after acquisition cost, BEFORE fixed overhead — a
 * §1/§2 acquisition-level number, NOT company profit (Product/CFO review M1).
 */
export function computePlanner(a: Assumptions, monthlyAdSpend: number, months: number, cacPerClient: number): PlannerResult {
  const econ = computeTiers(a);
  const spend = num(monthlyAdSpend);
  const m = Math.max(0, num(months));
  const cac = num(cacPerClient);
  const totalSpend = spend * m;
  const expectedClients = cac > 0 ? totalSpend / cac : 0;

  const totalMix = econ.reduce((s, e) => s + e.expectedMonthlyCount, 0);
  const perTier = econ.map((e) => {
    const share = totalMix > 0 ? e.expectedMonthlyCount / totalMix : 0;
    const clients = expectedClients * share;
    return { id: e.id, name: e.name, clients, guaranteed: clients * e.contribution, ltv: clients * e.ltvContribution };
  });

  const guaranteedContribution = perTier.reduce((s, p) => s + p.guaranteed, 0);
  const ltvContribution = perTier.reduce((s, p) => s + p.ltv, 0);
  const strategistHoursConsumed = econ.reduce((s, e, i) => s + perTier[i].clients * e.labour.strategist.hours * Math.max(1, num(a.termMonths, 1)), 0);

  return {
    adSpend: totalSpend,
    months: m,
    blendedCac: cac,
    expectedClients,
    guaranteedContribution,
    ltvContribution,
    contributionAfterSpendGuaranteed: guaranteedContribution - totalSpend,
    contributionAfterSpendLtv: ltvContribution - totalSpend,
    strategistHoursConsumed,
    perTier,
  };
}
