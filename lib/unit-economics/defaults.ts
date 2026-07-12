/**
 * Seed assumptions, from Gage's spec §8/§9. These are the starting numbers the dashboard
 * ships with; everything is editable in the app. Estimates (hours, retention, contractor
 * fee, overhead split) are flagged in the UI, per §8.
 *
 * The per-tier hours are GENERATED from the target contribution % in §9 via a reasoned
 * role mix, so the engine reproduces §9 exactly on day one. When Gage provides real logged
 * hours, they replace these and the % recomputes.
 */
import type { Assumptions, Role, TierInput } from "./model";
import { HOURS_PER_MONTH } from "./model";

const COMMISSION_PCT = 0.10; // §3, §9
const PROCESSING_PCT = 0.027; // §3, §9
const CONTRACTOR_FEE_PCT = 0.03; // §8 estimate (placeholder; does not affect the contribution %)
const TERM_MONTHS = 3; // guaranteed commitment
const LTV_CAC_TARGET = 3; // §4 (3x safety)

const ROLE_SALARY: Record<Role, number> = {
  designer: 2000,
  copywriter: 3750,
  strategist: 6000,
  tech: 2068,
};
const RATE: Record<Role, number> = {
  designer: ROLE_SALARY.designer / HOURS_PER_MONTH,
  copywriter: ROLE_SALARY.copywriter / HOURS_PER_MONTH,
  strategist: ROLE_SALARY.strategist / HOURS_PER_MONTH,
  tech: ROLE_SALARY.tech / HOURS_PER_MONTH,
};

/**
 * Generate seed monthly hours per role that reproduce a target contribution %.
 * loaded labour = revenue × (1 − CM% − commission − processing); raw labour = loaded /
 * (1+fee); split by mix; hours = role$ / rate. (The fee cancels out of the CM%, so the
 * result matches §9 for any fee value.)
 */
function seedHours(monthlyPrice: number, cmPct: number, mix: Record<Role, number>): Record<Role, number> {
  const loadedMonthly = monthlyPrice * (1 - cmPct - COMMISSION_PCT - PROCESSING_PCT);
  const rawMonthly = loadedMonthly / (1 + CONTRACTOR_FEE_PCT);
  return {
    designer: (mix.designer * rawMonthly) / RATE.designer,
    copywriter: (mix.copywriter * rawMonthly) / RATE.copywriter,
    strategist: (mix.strategist * rawMonthly) / RATE.strategist,
    tech: (mix.tech * rawMonthly) / RATE.tech,
  };
}

interface TierSeed {
  id: string;
  name: string;
  monthlyPrice: number;
  deliverables: string;
  isCustom: boolean;
  cmPct: number; // §9 target
  additionalMonths: number; // §8 retention (smallest→largest: 3/3/4/4/6)
  mix: Record<Role, number>; // reasoned role split (estimate)
  expectedMonthlyCount: number; // seed mix (proportions from the artifact)
}

const TIER_SEEDS: TierSeed[] = [
  {
    id: "custom_1000", name: "Custom", monthlyPrice: 1000, isCustom: true,
    deliverables: "Downsell / custom pricing",
    cmPct: 0.312, additionalMonths: 3,
    mix: { designer: 0.35, copywriter: 0.30, strategist: 0.25, tech: 0.10 }, expectedMonthlyCount: 11.6,
  },
  {
    id: "limited_1500", name: "Limited Deal", monthlyPrice: 1500, isCustom: false,
    deliverables: "5 email/SMS campaigns · 5 flow emails · bi-weekly calendar & calls",
    cmPct: 0.366, additionalMonths: 3,
    mix: { designer: 0.33, copywriter: 0.30, strategist: 0.27, tech: 0.10 }, expectedMonthlyCount: 20.6,
  },
  {
    id: "starter_3000", name: "Starter", monthlyPrice: 3000, isCustom: false,
    deliverables: "5 emails & SMS · 1 flow email · monthly calendar & call · bi-weekly Slack",
    cmPct: 0.432, additionalMonths: 4,
    mix: { designer: 0.30, copywriter: 0.28, strategist: 0.32, tech: 0.10 }, expectedMonthlyCount: 3.9,
  },
  {
    id: "growth_4500", name: "Growth", monthlyPrice: 4500, isCustom: false,
    deliverables: "12 emails & SMS · 20 flow emails · monthly calendar · bi-weekly calls · weekly Slack",
    cmPct: 0.410, additionalMonths: 4,
    mix: { designer: 0.30, copywriter: 0.27, strategist: 0.33, tech: 0.10 }, expectedMonthlyCount: 3.9,
  },
  {
    id: "elite_7500", name: "Elite", monthlyPrice: 7500, isCustom: false,
    deliverables: "20 emails & SMS · 30 flow emails · monthly calendar · weekly calls · weekly Slack",
    cmPct: 0.485, additionalMonths: 6,
    mix: { designer: 0.28, copywriter: 0.26, strategist: 0.36, tech: 0.10 }, expectedMonthlyCount: 1.3,
  },
];

const TIERS: TierInput[] = TIER_SEEDS.map((s) => ({
  id: s.id,
  name: s.name,
  monthlyPrice: s.monthlyPrice,
  deliverables: s.deliverables,
  isCustom: s.isCustom,
  additionalMonths: s.additionalMonths,
  hours: seedHours(s.monthlyPrice, s.cmPct, s.mix),
  expectedMonthlyCount: s.expectedMonthlyCount,
}));

export const SEED_ASSUMPTIONS: Assumptions = {
  termMonths: TERM_MONTHS,
  commissionPct: COMMISSION_PCT,
  processingPct: PROCESSING_PCT,
  contractorFeePct: CONTRACTOR_FEE_PCT,
  ltvCacTarget: LTV_CAC_TARGET,
  roleMonthlySalary: ROLE_SALARY,
  tiers: TIERS,
  // Fixed overhead — the individual splits are placeholders (only the ~$83,750 total is known
  // from §9); Gage itemizes the real figures. Software should read live from software_costs.
  overhead: {
    teamPayroll: 45000,
    founderComp: 25000,
    software: 5000,
    insurance: 4000,
    otherAdmin: 4750,
  },
  // Whole-company monthly actuals (§9 validated averages). Seeded so the P&L reproduces §9
  // EXACTLY on first load: 98,580 revenue − (500 + 1,500 + 500) variable − 83,750 overhead =
  // 12,330 net (12.5%). These are Gage's real totals — editable monthly, flagged as estimates.
  companyActuals: {
    revenue: 98580,
    adSpend: 500,
    commission: 1500,
    processing: 500,
  },
};
