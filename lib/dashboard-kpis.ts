/**
 * Dashboard KPI definitions — the full pool of metrics available to pin.
 * Each metric has a stable key, display config, and which roles can use it.
 */

export type KpiUnit = "currency" | "count" | "ratio" | "percent";
export type KpiPeriod = "day" | "week" | "month";

/**
 * How a metric behaves over a date range:
 *  - additive : a flow — summed/counted over [start, end) (cash, leads, calls…).
 *  - ratio    : derived from two additive flows over the range (ROAS = cash/spend).
 *  - snapshot : a level / point-in-time value shown "as of" the range end (MRR,
 *               open pipeline). Not summed; its trend is the level over time.
 */
export type KpiKind = "additive" | "ratio" | "snapshot";

export interface KpiDef {
  key: string;
  label: string;
  description: string;
  unit: KpiUnit;
  roles: ("admin" | "rep")[];
  /** True if this metric can be compared against a user-set target */
  hasTarget: boolean;
  /** Range semantics — drives how value, comparison and trend are computed. */
  kind: KpiKind;
}

export const KPI_POOL: KpiDef[] = [
  // ── Admin ────────────────────────────────────────────────────────────────
  {
    key: "cash",
    label: "Cash Collected",
    description: "Revenue collected in the selected period",
    unit: "currency",
    roles: ["admin"],
    hasTarget: false,
    kind: "additive",
  },
  {
    key: "leads",
    label: "New Leads",
    description: "New GHL opportunities created in the selected period",
    unit: "count",
    roles: ["admin"],
    hasTarget: false,
    kind: "additive",
  },
  {
    key: "calls_admin",
    label: "Calls Logged",
    description: "Total calls logged by the team in the selected period",
    unit: "count",
    roles: ["admin"],
    hasTarget: false,
    kind: "additive",
  },
  {
    key: "proposals_sent",
    label: "Proposals Sent",
    description: "Number of proposals sent in the selected period",
    unit: "count",
    roles: ["admin"],
    hasTarget: false,
    kind: "additive",
  },
  {
    key: "roas",
    label: "ROAS",
    description: "Return on ad spend (cash collected ÷ ad spend) over the period",
    unit: "ratio",
    roles: ["admin"],
    hasTarget: false,
    kind: "ratio",
  },
  {
    key: "mrr",
    label: "MRR",
    description: "Monthly recurring revenue from active subscriptions, as of the period end",
    unit: "currency",
    roles: ["admin"],
    hasTarget: false,
    kind: "snapshot",
  },
  {
    key: "ad_spend",
    label: "Ad Spend",
    description: "Total Meta ad spend in the selected period",
    unit: "currency",
    roles: ["admin"],
    hasTarget: false,
    kind: "additive",
  },
  {
    key: "pipeline_value_admin",
    label: "Pipeline Value",
    description: "Total value of all open opportunities, as of the period end",
    unit: "currency",
    roles: ["admin"],
    hasTarget: false,
    kind: "snapshot",
  },
  {
    key: "software_spend",
    label: "Software Spend",
    description: "Current monthly active software subscription costs",
    unit: "currency",
    roles: ["admin"],
    hasTarget: false,
    kind: "snapshot",
  },

  // ── Rep ──────────────────────────────────────────────────────────────────
  {
    key: "proposals_sent_rep",
    label: "Proposals Sent",
    description: "Proposals you've sent in the selected period",
    unit: "count",
    roles: ["rep"],
    hasTarget: false,
    kind: "additive",
  },
  {
    key: "deals_won",
    label: "Deals Closed",
    description: "Closed deals assigned to you in the selected period",
    unit: "count",
    roles: ["rep"],
    hasTarget: true,
    kind: "additive",
  },
  {
    key: "calls_rep",
    label: "Calls",
    description: "Calls you've logged in the selected period",
    unit: "count",
    roles: ["rep"],
    hasTarget: true,
    kind: "additive",
  },
  {
    key: "commission",
    label: "Commission Earned",
    description: "Your earned commission from closed deals in the selected period",
    unit: "currency",
    roles: ["rep"],
    hasTarget: false,
    kind: "additive",
  },
  {
    key: "revenue_won",
    label: "Revenue Won",
    description: "Total deal value from closed deals in the selected period",
    unit: "currency",
    roles: ["rep"],
    hasTarget: false,
    kind: "additive",
  },
  {
    key: "pipeline_count",
    label: "Pipeline Deals",
    description: "Number of open deals currently in your pipeline",
    unit: "count",
    roles: ["rep"],
    hasTarget: false,
    kind: "snapshot",
  },
  {
    key: "pipeline_value",
    label: "Pipeline Value",
    description: "Total value of your open pipeline deals",
    unit: "currency",
    roles: ["rep"],
    hasTarget: false,
    kind: "snapshot",
  },
];

export const DEFAULT_ADMIN_KEYS = ["cash", "leads", "roas"];
export const DEFAULT_REP_KEYS = ["proposals_sent_rep", "deals_won", "commission"];

export function getDefaults(role: "admin" | "rep"): string[] {
  return role === "admin" ? DEFAULT_ADMIN_KEYS : DEFAULT_REP_KEYS;
}

export function getPoolForRole(role: "admin" | "rep"): KpiDef[] {
  return KPI_POOL.filter((k) => k.roles.includes(role));
}

export function getKpiDef(key: string): KpiDef | undefined {
  return KPI_POOL.find((k) => k.key === key);
}
