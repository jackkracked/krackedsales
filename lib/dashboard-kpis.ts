/**
 * Dashboard KPI definitions — the full pool of metrics available to pin.
 * Each metric has a stable key, display config, and which roles can use it.
 */

export type KpiUnit = "currency" | "count" | "ratio" | "percent";
export type KpiPeriod = "day" | "week" | "month";

export interface KpiDef {
  key: string;
  label: string;
  description: string;
  unit: KpiUnit;
  roles: ("admin" | "rep")[];
  /** True if this metric can be compared against a user-set target */
  hasTarget: boolean;
  /** If false, always shows monthly data regardless of period toggle */
  periodAware: boolean;
}

export const KPI_POOL: KpiDef[] = [
  // ── Admin ────────────────────────────────────────────────────────────────
  {
    key: "cash",
    label: "Cash Collected",
    description: "Revenue from won deals in the selected period",
    unit: "currency",
    roles: ["admin"],
    hasTarget: false,
    periodAware: true,
  },
  {
    key: "leads",
    label: "New Leads",
    description: "New GHL opportunities created in the selected period",
    unit: "count",
    roles: ["admin"],
    hasTarget: false,
    periodAware: true,
  },
  {
    key: "calls_admin",
    label: "Calls Logged",
    description: "Total calls logged by the team in the selected period",
    unit: "count",
    roles: ["admin"],
    hasTarget: false,
    periodAware: true,
  },
  {
    key: "proposals_sent",
    label: "Proposals Sent",
    description: "Number of proposals sent in the selected period",
    unit: "count",
    roles: ["admin"],
    hasTarget: false,
    periodAware: true,
  },
  {
    key: "roas",
    label: "ROAS",
    description: "Return on ad spend (monthly)",
    unit: "ratio",
    roles: ["admin"],
    hasTarget: false,
    periodAware: false,
  },
  {
    key: "mrr",
    label: "MRR",
    description: "Monthly recurring revenue from active subscriptions",
    unit: "currency",
    roles: ["admin"],
    hasTarget: false,
    periodAware: false,
  },
  {
    key: "ad_spend",
    label: "Ad Spend",
    description: "Total Meta ad spend (monthly)",
    unit: "currency",
    roles: ["admin"],
    hasTarget: false,
    periodAware: false,
  },
  {
    key: "pipeline_value_admin",
    label: "Pipeline Value",
    description: "Total value of all open opportunities in GHL",
    unit: "currency",
    roles: ["admin"],
    hasTarget: false,
    periodAware: false,
  },
  {
    key: "software_spend",
    label: "Software Spend",
    description: "Monthly active software subscription costs",
    unit: "currency",
    roles: ["admin"],
    hasTarget: false,
    periodAware: false,
  },

  // ── Rep ──────────────────────────────────────────────────────────────────
  {
    key: "deals_won",
    label: "Deals Won",
    description: "Closed deals assigned to you in the selected period",
    unit: "count",
    roles: ["rep"],
    hasTarget: true,
    periodAware: true,
  },
  {
    key: "calls_rep",
    label: "Calls",
    description: "Calls you've logged in the selected period",
    unit: "count",
    roles: ["rep"],
    hasTarget: true,
    periodAware: true,
  },
  {
    key: "commission",
    label: "Commission",
    description: "Earned commission in the selected period",
    unit: "currency",
    roles: ["rep"],
    hasTarget: false,
    periodAware: true,
  },
  {
    key: "revenue_won",
    label: "Revenue Won",
    description: "Total deal value from closed deals in the selected period",
    unit: "currency",
    roles: ["rep"],
    hasTarget: false,
    periodAware: true,
  },
  {
    key: "pipeline_count",
    label: "Pipeline Deals",
    description: "Number of open deals currently in your pipeline",
    unit: "count",
    roles: ["rep"],
    hasTarget: false,
    periodAware: false,
  },
  {
    key: "pipeline_value",
    label: "Pipeline Value",
    description: "Total value of your open pipeline deals",
    unit: "currency",
    roles: ["rep"],
    hasTarget: false,
    periodAware: false,
  },
];

export const DEFAULT_ADMIN_KEYS = ["cash", "leads", "roas"];
export const DEFAULT_REP_KEYS = ["deals_won", "calls_rep", "commission"];

export function getDefaults(role: "admin" | "rep"): string[] {
  return role === "admin" ? DEFAULT_ADMIN_KEYS : DEFAULT_REP_KEYS;
}

export function getPoolForRole(role: "admin" | "rep"): KpiDef[] {
  return KPI_POOL.filter((k) => k.roles.includes(role));
}

export function getKpiDef(key: string): KpiDef | undefined {
  return KPI_POOL.find((k) => k.key === key);
}
