/**
 * lib/packages/catalog.ts
 *
 * The agency's 90-Day Retention Sprint packages (Jack-confirmed from Gage, 2026-07-27). Each is a
 * 90-DAY commitment: the headline price is the full-term investment, and everything is delivered
 * across the 90 days (not per month). Billing stays monthly internally (monthlyPrice = termPrice ÷ 3),
 * so the proven engine is untouched — the builder just shows the 90-day framing.
 *
 * `emails` = total emails (campaigns + flows) over the term. `popUps` = total pop-up redesigns.
 * `included` = the rest of "what you get over the next 90 days". `exclusive` = "exclusive to your plan".
 */
export interface PackageTier {
  id: string;
  name: string;
  tagline: string;
  monthlyPrice: number; // dollars / month (termPrice ÷ 3) — what the engine bills
  termMonths: number; // 90-day = 3
  mostPopular?: boolean;
  isCustom?: boolean;
  emails: number; // total campaigns + flows over the term
  popUps: number; // total pop-up redesigns over the term
  included: string[]; // "what you get over the next 90 days" (beyond emails + pop-ups)
  exclusive: string[]; // "exclusive to your plan"
}

const CORE_INCLUDED = (calls: string, kpi?: string): string[] => [
  "Complimentary SMS management (flows + campaigns)",
  "1 strategy kick-off call",
  calls,
  ...(kpi ? [kpi] : []),
  "Monthly campaign calendar + strategy (3 total)",
  "Monthly performance report (3 total)",
];
const BASE_EXCLUSIVE = [
  "Dedicated team: strategist, copywriter, designer & tech",
  "Dedicated Slack channel with your full team",
  "Discounted à la carte rate on extra emails",
];
const PRO_EXCLUSIVE = [
  "Dedicated team: strategist, copywriter, designer & tech",
  "Dedicated Slack channel with your full team",
  "Free Krackdown.io usage",
  "Kracked OS live metrics dashboard",
  "Discounted à la carte rate on extra emails",
];

export const PACKAGE_TIERS: PackageTier[] = [
  {
    id: "kickstarter", name: "Kickstarter", tagline: "For brands getting started",
    monthlyPrice: 1000, termMonths: 3, emails: 12, popUps: 3,
    included: CORE_INCLUDED("Monthly strategy call (3 total)"),
    exclusive: BASE_EXCLUSIVE,
  },
  {
    id: "core", name: "Core", tagline: "For brands finding traction",
    monthlyPrice: 1500, termMonths: 3, emails: 18, popUps: 3,
    included: CORE_INCLUDED("Monthly strategy call (3 total)"),
    exclusive: BASE_EXCLUSIVE,
  },
  {
    id: "accelerator", name: "Accelerator", tagline: "For scaling brands", mostPopular: true,
    monthlyPrice: 3000, termMonths: 3, emails: 34, popUps: 3,
    included: CORE_INCLUDED("Bi-weekly strategy calls (6 total)", "Bi-weekly Slack KPI updates (6 total)"),
    exclusive: PRO_EXCLUSIVE,
  },
  {
    id: "powerhouse", name: "Powerhouse", tagline: "For high-growth brands",
    monthlyPrice: 4500, termMonths: 3, emails: 56, popUps: 3,
    included: CORE_INCLUDED("Bi-weekly strategy calls (6 total)", "Weekly Slack KPI updates (12 total)"),
    exclusive: PRO_EXCLUSIVE,
  },
  {
    id: "elite", name: "Elite", tagline: "For brands going all-in",
    monthlyPrice: 7500, termMonths: 3, emails: 78, popUps: 3,
    included: CORE_INCLUDED("Weekly strategy calls (12 total)", "Weekly Slack KPI updates (12 total)"),
    exclusive: PRO_EXCLUSIVE,
  },
  {
    id: "custom", name: "Custom", tagline: "Build the scope from scratch",
    monthlyPrice: 1000, termMonths: 3, isCustom: true, emails: 0, popUps: 0,
    included: [], exclusive: [],
  },
];

/** The full 90-day investment (what Gage quotes). */
export const termPriceOf = (p: PackageTier): number => p.monthlyPrice * p.termMonths;

export function getPackage(id: string): PackageTier | undefined {
  return PACKAGE_TIERS.find((p) => p.id === id);
}
