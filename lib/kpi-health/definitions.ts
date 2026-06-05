export interface KpiDefinition {
  key: string;
  name: string;
  whatItMeasures: string;
  whereItComesFrom: string;
  sourceSystem: "stripe" | "ghl" | "meta" | "local_db" | "computed";
  sourceUrl: string | null;
  zeroMeans: string;
  unit: "currency" | "count" | "ratio" | "percent";
  roles: ("admin" | "rep")[];
}

export const KPI_DEFINITIONS: Record<string, KpiDefinition> = {
  // ─── Admin Metrics ───────────────────────────────────────────────

  cash: {
    key: "cash",
    name: "Cash Collected",
    whatItMeasures:
      "Every payment that landed in your Stripe account this period. Includes one-off project payments and monthly retainer charges. Does not include refunds or failed payments.",
    whereItComesFrom: "Stripe \u2192 Payments \u2192 All successful charges",
    sourceSystem: "stripe",
    sourceUrl: "https://dashboard.stripe.com/payments?status=successful",
    zeroMeans: "No payments were received this period",
    unit: "currency",
    roles: ["admin"],
  },

  leads: {
    key: "leads",
    name: "New Leads",
    whatItMeasures:
      "New leads that entered your GoHighLevel pipeline this period. Counted from when the opportunity was first created.",
    whereItComesFrom:
      "GoHighLevel \u2192 Pipeline \u2192 New opportunities created",
    sourceSystem: "ghl",
    sourceUrl: "https://app.gohighlevel.com",
    zeroMeans: "No new leads entered the pipeline this period",
    unit: "count",
    roles: ["admin"],
  },

  calls_admin: {
    key: "calls_admin",
    name: "Calls Logged",
    whatItMeasures:
      "Total calls logged by your team this period. Includes both Google Meet and dialer calls recorded in the system.",
    whereItComesFrom:
      "Internal database \u2192 Calls table \u2192 All team calls",
    sourceSystem: "local_db",
    sourceUrl: null,
    zeroMeans: "No calls were logged by the team this period",
    unit: "count",
    roles: ["admin"],
  },

  proposals_sent: {
    key: "proposals_sent",
    name: "Proposals Sent",
    whatItMeasures:
      "Proposals your team sent to clients this period. Counted from when the proposal email was delivered.",
    whereItComesFrom:
      "Internal database \u2192 Proposals \u2192 Sent date in period",
    sourceSystem: "local_db",
    sourceUrl: null,
    zeroMeans: "No proposals were sent this period",
    unit: "count",
    roles: ["admin"],
  },

  roas: {
    key: "roas",
    name: "ROAS",
    whatItMeasures:
      "Cash collected divided by ad spend. Shows how many dollars you earned for every dollar spent on Meta ads. Always calculated for the full month.",
    whereItComesFrom:
      "Calculated from Stripe payments \u00f7 Meta ad spend",
    sourceSystem: "computed",
    sourceUrl: null,
    zeroMeans:
      "Either no cash was collected or no ad spend was recorded",
    unit: "ratio",
    roles: ["admin"],
  },

  mrr: {
    key: "mrr",
    name: "MRR",
    whatItMeasures:
      "Total of all your active monthly retainers in Stripe right now. If a client pays quarterly or yearly, we convert it to the monthly equivalent.",
    whereItComesFrom:
      "Stripe \u2192 Subscriptions \u2192 All currently active",
    sourceSystem: "stripe",
    sourceUrl: "https://dashboard.stripe.com/subscriptions",
    zeroMeans:
      "No active subscriptions found in Stripe \u2014 check if your Stripe connection is working",
    unit: "currency",
    roles: ["admin"],
  },

  ad_spend: {
    key: "ad_spend",
    name: "Ad Spend",
    whatItMeasures:
      "How much Meta charged you for ads this period. Pulled directly from your Meta Ads Manager account.",
    whereItComesFrom:
      "Meta Ads Manager \u2192 Account insights \u2192 Total spend",
    sourceSystem: "meta",
    sourceUrl: "https://adsmanager.facebook.com",
    zeroMeans:
      "No ad spend recorded \u2014 either no ads ran or Meta connection needs checking",
    unit: "currency",
    roles: ["admin"],
  },

  pipeline_value_admin: {
    key: "pipeline_value_admin",
    name: "Pipeline Value",
    whatItMeasures:
      "Total dollar value of every open deal in your pipeline right now. Does not include won, lost, or abandoned deals.",
    whereItComesFrom:
      "GoHighLevel \u2192 All pipelines \u2192 Open opportunities \u2192 Sum of values",
    sourceSystem: "ghl",
    sourceUrl: "https://app.gohighlevel.com",
    zeroMeans: "No open deals have a dollar value set in GHL",
    unit: "currency",
    roles: ["admin"],
  },

  software_spend: {
    key: "software_spend",
    name: "Software Spend",
    whatItMeasures:
      "Monthly cost of all active software subscriptions you've added in Settings. Does not auto-detect tools \u2014 only counts what you've manually entered.",
    whereItComesFrom:
      "Internal database \u2192 Settings \u2192 Software costs (active only)",
    sourceSystem: "local_db",
    sourceUrl: null,
    zeroMeans: "No software costs have been added in Settings",
    unit: "currency",
    roles: ["admin"],
  },

  // ─── Rep Metrics ─────────────────────────────────────────────────

  proposals_sent_rep: {
    key: "proposals_sent_rep",
    name: "Proposals Sent",
    whatItMeasures: "Proposals you personally sent this period.",
    whereItComesFrom:
      "Internal database \u2192 Proposals \u2192 Created by you, sent in period",
    sourceSystem: "local_db",
    sourceUrl: null,
    zeroMeans: "You haven't sent any proposals this period",
    unit: "count",
    roles: ["rep"],
  },

  deals_won: {
    key: "deals_won",
    name: "Deals Closed",
    whatItMeasures:
      "Deals you personally closed this period. Matched by your GoHighLevel user ID.",
    whereItComesFrom:
      "GoHighLevel \u2192 Your assigned opportunities \u2192 Status changed to won",
    sourceSystem: "ghl",
    sourceUrl: "https://app.gohighlevel.com",
    zeroMeans: "No deals were closed by you this period",
    unit: "count",
    roles: ["rep"],
  },

  calls_rep: {
    key: "calls_rep",
    name: "Calls",
    whatItMeasures:
      "Calls you personally logged this period. Matched by your email address in the system.",
    whereItComesFrom:
      "Internal database \u2192 Calls \u2192 Filtered by your email",
    sourceSystem: "local_db",
    sourceUrl: null,
    zeroMeans: "No calls were logged under your email this period",
    unit: "count",
    roles: ["rep"],
  },

  commission: {
    key: "commission",
    name: "Commission Earned",
    whatItMeasures:
      "Your earned commission based on deals closed multiplied by your commission percentage.",
    whereItComesFrom:
      "Calculated from GHL won deals \u00d7 your commission rate in Settings",
    sourceSystem: "computed",
    sourceUrl: null,
    zeroMeans:
      "No commission-eligible deals closed, or your commission rate is set to 0%",
    unit: "currency",
    roles: ["rep"],
  },

  revenue_won: {
    key: "revenue_won",
    name: "Revenue Won",
    whatItMeasures:
      "Total dollar value of deals you closed this period.",
    whereItComesFrom:
      "GoHighLevel \u2192 Your won opportunities \u2192 Sum of deal values",
    sourceSystem: "ghl",
    sourceUrl: "https://app.gohighlevel.com",
    zeroMeans: "No deals were closed by you this period",
    unit: "currency",
    roles: ["rep"],
  },

  pipeline_count: {
    key: "pipeline_count",
    name: "Pipeline Deals",
    whatItMeasures:
      "Number of open deals currently assigned to you in the pipeline.",
    whereItComesFrom:
      "GoHighLevel \u2192 Your assigned opportunities \u2192 Status is open",
    sourceSystem: "ghl",
    sourceUrl: "https://app.gohighlevel.com",
    zeroMeans: "You have no open deals assigned to you right now",
    unit: "count",
    roles: ["rep"],
  },

  pipeline_value: {
    key: "pipeline_value",
    name: "Pipeline Value",
    whatItMeasures:
      "Total dollar value of all open deals assigned to you right now.",
    whereItComesFrom:
      "GoHighLevel \u2192 Your open opportunities \u2192 Sum of values",
    sourceSystem: "ghl",
    sourceUrl: "https://app.gohighlevel.com",
    zeroMeans:
      "Your open deals have no dollar values set, or you have no open deals",
    unit: "currency",
    roles: ["rep"],
  },
} as const;
