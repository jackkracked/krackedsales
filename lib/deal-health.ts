import { differenceInDays } from "date-fns";

// Stage base scores — closer to close = higher starting point
const STAGE_BASE: Record<string, number> = {
  "demo sent":              45,
  "intro call booked":      52,
  "no show":                22,
  "sale in progress":       58,
  "proposal sent":          63,
};

function stageBase(stageName: string): number {
  const key = stageName.toLowerCase().trim();
  for (const [pattern, score] of Object.entries(STAGE_BASE)) {
    if (key.includes(pattern)) return score;
  }
  return 50;
}

export interface HealthFactor {
  label: string;
  delta: number;
  positive: boolean;
}

export interface DealHealthResult {
  score: number;
  tier: "healthy" | "at_risk" | "cold";
  stageBase: number;
  factors: HealthFactor[];
}

export interface HealthInput {
  stageName: string;
  updatedAt: string;   // ISO string
  status: string;
  callsLast14Days: number;
  hadNoShow: boolean;
  demoCompleted: boolean;         // ever reached "Sale In Progress" or later
  lastFollowupGotResponse: boolean | null;  // null = no follow-up sent
}

export function computeHealthScore(input: HealthInput): DealHealthResult {
  // Closed deals don't need health scores
  if (input.status === "won" || input.status === "lost") {
    return { score: 100, tier: "healthy", stageBase: 100, factors: [] };
  }

  const base = stageBase(input.stageName);
  const factors: HealthFactor[] = [];
  let score = base;

  // Days since last update
  const daysSince = differenceInDays(new Date(), new Date(input.updatedAt));
  let decayDelta = 0;
  if (daysSince <= 3) {
    decayDelta = 0;
  } else if (daysSince <= 7) {
    decayDelta = -12;
  } else if (daysSince <= 14) {
    decayDelta = -22;
  } else if (daysSince <= 21) {
    decayDelta = -30;
  } else {
    decayDelta = -38;
  }

  if (decayDelta !== 0) {
    factors.push({
      label: daysSince === 1 ? "1 day since last activity" : `${daysSince} days since last activity`,
      delta: decayDelta,
      positive: false,
    });
    score += decayDelta;
  } else {
    factors.push({
      label: "Active recently",
      delta: 0,
      positive: true,
    });
  }

  // Calls in last 14 days
  const callBoost = Math.min(20, input.callsLast14Days * 8);
  if (input.callsLast14Days > 0) {
    factors.push({
      label: `${input.callsLast14Days} call${input.callsLast14Days > 1 ? "s" : ""} in last 14 days`,
      delta: callBoost,
      positive: true,
    });
    score += callBoost;
  }

  // Demo completed
  if (input.demoCompleted) {
    factors.push({ label: "Demo completed", delta: 15, positive: true });
    score += 15;
  }

  // No-show recorded
  if (input.hadNoShow) {
    factors.push({ label: "No-show recorded", delta: -18, positive: false });
    score -= 18;
  }

  // Response to last follow-up
  if (input.lastFollowupGotResponse === true) {
    factors.push({ label: "Responded to follow-up", delta: 15, positive: true });
    score += 15;
  } else if (input.lastFollowupGotResponse === false) {
    factors.push({ label: "No response to last follow-up", delta: -5, positive: false });
    score -= 5;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  const tier: DealHealthResult["tier"] =
    score >= 70 ? "healthy" : score >= 40 ? "at_risk" : "cold";

  return { score, tier, stageBase: base, factors };
}

/** Simple tier from updatedAt only — used on pipeline cards without an API call */
export function quickHealthTier(updatedAt: string): "healthy" | "at_risk" | "cold" {
  const days = differenceInDays(new Date(), new Date(updatedAt));
  if (days < 4) return "healthy";
  if (days < 8) return "at_risk";
  return "cold";
}

export const TIER_COLORS = {
  healthy:  { dot: "bg-emerald-500",  text: "text-emerald-600",  bg: "bg-emerald-50",  label: "Healthy" },
  at_risk:  { dot: "bg-amber-400",    text: "text-amber-600",    bg: "bg-amber-50",    label: "At Risk" },
  cold:     { dot: "bg-red-500",      text: "text-red-600",      bg: "bg-red-50",      label: "Cold"    },
};
