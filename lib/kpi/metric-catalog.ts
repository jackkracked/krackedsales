/**
 * Metric catalog — single source of truth for every KPI across the /kpis page
 * AND the dashboard widget. Each entry carries:
 *   - label:       display name
 *   - explanation: plain-English "how this is read" for the detail drawer
 *   - detail:      how to build the cross-reference line-item list (or a breakdown
 *                  for ratio/derived metrics that have no list)
 *
 * Card keys from both pages are included so a click anywhere resolves here.
 */

export type DetailSource =
  | "charges_succeeded"        // Stripe succeeded charges (cash)
  | "open_invoices_pastdue"    // Stripe open invoices past due (snapshot)
  | "subs_active"              // Stripe active subscriptions (snapshot)
  | "subs_new"                 // Stripe subs created in range
  | "subs_canceled"            // Stripe subs canceled in range
  | "project_invoices_paid"    // Stripe paid one-off (non-subscription) invoices
  | "proposals"                // DB proposals (params: status, type, dateField)
  | "calls"                    // DB calls (params: scoped)
  | "software_costs"           // DB active software costs (snapshot)
  | "opps"                     // GHL opportunities (params: mode = created|won|open)
  | "meta_spend"               // Meta daily ad spend
  | "expenses_breakdown"       // components of total expenses
  | "ratio";                   // derived metric — show formula + components

export interface DetailConfig {
  source: DetailSource;
  params?: Record<string, string>;
}

export interface MetricCatalogEntry {
  label: string;
  explanation: string;
  detail?: DetailConfig;
  /** Funnel/derived metric whose line-item source isn't wired yet. */
  pending?: boolean;
}

/**
 * Keyed by the metric key used on the cards. Several keys (e.g. cash / cashCollected,
 * mrr / totalMrr / managementMrr) intentionally share a detail source.
 */
export const METRIC_CATALOG: Record<string, MetricCatalogEntry> = {
  // ── Cash / revenue ────────────────────────────────────────────────────────
  cash: {
    label: "Cash Collected",
    explanation: "Every payment successfully collected through Stripe (succeeded charges). “In period” means the payment date falls inside your selected range.",
    detail: { source: "charges_succeeded" },
  },
  cashCollected: {
    label: "Cash Collected",
    explanation: "Every payment successfully collected through Stripe (succeeded charges). “In period” means the payment date falls inside your selected range.",
    detail: { source: "charges_succeeded" },
  },
  outstandingPayments: {
    label: "Outstanding Payments",
    explanation: "Open Stripe invoices that are past their due date — money currently owed to you. This is a live snapshot, not period-scoped.",
    detail: { source: "open_invoices_pastdue" },
  },
  outstanding: {
    label: "Outstanding Proposals",
    explanation: "Proposals that have been sent or signed but aren’t fully paid yet. A live snapshot of pipeline value awaiting payment.",
    detail: { source: "proposals", params: { statusIn: "sent,signed" } },
  },

  // ── MRR / subscriptions ─────────────────────────────────────────────────────
  mrr: {
    label: "MRR",
    explanation: "Monthly recurring revenue from active Stripe subscriptions, valued as of the end of your selected range. Each line is one active subscription.",
    detail: { source: "subs_active" },
  },
  totalMrr: {
    label: "Total MRR",
    explanation: "Monthly recurring revenue from active Stripe subscriptions. Each line is one active subscription, normalised to a monthly amount.",
    detail: { source: "subs_active" },
  },
  managementMrr: {
    label: "Management MRR",
    explanation: "Recurring revenue from active management (retainer) subscriptions. Each line is one active subscription.",
    detail: { source: "subs_active" },
  },
  managementClients: {
    label: "Management Clients",
    explanation: "Distinct customers with at least one active subscription right now. Each line is an active subscription.",
    detail: { source: "subs_active" },
  },
  newManagementMrr: {
    label: "New Management MRR",
    explanation: "Subscriptions that started inside your selected range. “In period” = subscription created within the range.",
    detail: { source: "subs_new" },
  },
  churnedManagementMrr: {
    label: "Churned Management MRR",
    explanation: "Subscriptions cancelled inside your selected range. “In period” = cancellation date within the range.",
    detail: { source: "subs_canceled" },
  },

  // ── Projects ─────────────────────────────────────────────────────────────────
  newProjectValue: {
    label: "New Project Value",
    explanation: "Project-type proposals marked paid in our system. “In period” = paid date within the range.",
    detail: { source: "proposals", params: { type: "project", dateField: "paidAt" } },
  },

  // ── Proposals ─────────────────────────────────────────────────────────────────
  proposals_sent: {
    label: "Proposals Sent",
    explanation: "Proposals marked “sent”. “In period” = sent date within the range.",
    detail: { source: "proposals", params: { status: "sent", dateField: "sentAt" } },
  },
  proposals_sent_rep: {
    label: "Proposals Sent",
    explanation: "Proposals you personally sent. “In period” = sent date within the range.",
    detail: { source: "proposals", params: { status: "sent", dateField: "sentAt", scoped: "1" } },
  },
  mgmtProposalValueSent: {
    label: "Mgmt Proposal Value Sent",
    explanation: "Management-type proposals sent. “In period” = sent date within the range.",
    detail: { source: "proposals", params: { status: "sent", type: "management", dateField: "sentAt" } },
  },
  mgmtProposalValueLost: {
    label: "Mgmt Proposal Value Lost",
    explanation: "Management-type proposals marked lost. “In period” = lost date within the range.",
    detail: { source: "proposals", params: { status: "lost", type: "management", dateField: "lostAt" } },
  },
  projProposalValueSent: {
    label: "Project Proposal Value Sent",
    explanation: "Project-type proposals sent. “In period” = sent date within the range.",
    detail: { source: "proposals", params: { status: "sent", type: "project", dateField: "sentAt" } },
  },
  projProposalValueLost: {
    label: "Project Proposal Value Lost",
    explanation: "Project-type proposals marked lost. “In period” = lost date within the range.",
    detail: { source: "proposals", params: { status: "lost", type: "project", dateField: "lostAt" } },
  },

  // ── Calls ─────────────────────────────────────────────────────────────────────
  calls_admin: {
    label: "Calls Logged",
    explanation: "Calls logged by the whole team. “In period” = call start time within the range.",
    detail: { source: "calls" },
  },
  calls_rep: {
    label: "Calls",
    explanation: "Calls you logged. “In period” = call start time within the range.",
    detail: { source: "calls", params: { scoped: "1" } },
  },

  // ── Opportunities (GHL) ─────────────────────────────────────────────────────
  leads: {
    label: "New Leads",
    explanation: "New opportunities created in GHL. “In period” = created date within the range.",
    detail: { source: "opps", params: { mode: "created" } },
  },
  deals_won: {
    label: "Deals Closed",
    explanation: "Opportunities marked won. “In period” = the date the deal was marked won, within the range.",
    detail: { source: "opps", params: { mode: "won" } },
  },
  revenue_won: {
    label: "Revenue Won",
    explanation: "Value of opportunities marked won. “In period” = won date within the range.",
    detail: { source: "opps", params: { mode: "won" } },
  },
  commission: {
    label: "Commission Earned",
    explanation: "Your commission = the value of won deals × your commission rate. “In period” = won date within the range.",
    detail: { source: "opps", params: { mode: "won" } },
  },
  pipeline_value_admin: {
    label: "Pipeline Value",
    explanation: "Total value of all open opportunities right now. A live snapshot — each line is one open opportunity.",
    detail: { source: "opps", params: { mode: "open" } },
  },
  pipeline_value: {
    label: "Pipeline Value",
    explanation: "Total value of your open opportunities right now. A live snapshot.",
    detail: { source: "opps", params: { mode: "open", scoped: "1" } },
  },
  pipeline_count: {
    label: "Pipeline Deals",
    explanation: "Number of your open opportunities right now. A live snapshot.",
    detail: { source: "opps", params: { mode: "open", scoped: "1" } },
  },

  // ── Ad spend ──────────────────────────────────────────────────────────────────
  ad_spend: {
    label: "Ad Spend",
    explanation: "Meta ad spend. Each line is one day’s spend; “in period” = day within the range.",
    detail: { source: "meta_spend" },
  },
  adSpend: {
    label: "Ad Spend",
    explanation: "Meta ad spend. Each line is one day’s spend; “in period” = day within the range.",
    detail: { source: "meta_spend" },
  },
  adSpendMeta: {
    label: "Meta Ad Spend",
    explanation: "Meta (Facebook/Instagram) ad spend. Each line is one day’s spend; “in period” = day within the range.",
    detail: { source: "meta_spend" },
  },

  // ── Costs / expenses ────────────────────────────────────────────────────────
  software_spend: {
    label: "Software Spend",
    explanation: "Current monthly cost of active software subscriptions. Each line is one tool. A live snapshot of your stack.",
    detail: { source: "software_costs" },
  },
  totalExpenses: {
    label: "Total Expenses",
    explanation: "Everything that left the business in the period: software + manual expenses + ad spend + Stripe processing fees + refunds.",
    detail: { source: "expenses_breakdown" },
  },

  // ── Derived / ratio metrics (breakdown, no list) ──────────────────────────────
  netPL: {
    label: "Net P/L",
    explanation: "Net profit or loss for the period = cash collected − total expenses.",
    detail: { source: "ratio", params: { formula: "Cash collected − total expenses" } },
  },
  roas: {
    label: "ROAS",
    explanation: "Return on ad spend = cash collected ÷ Meta ad spend over the period. 3.0x means $3 collected per $1 spent.",
    detail: { source: "ratio", params: { formula: "Cash collected ÷ Meta ad spend" } },
  },
  cpl: {
    label: "CPL",
    explanation: "Cost per lead = ad spend ÷ new leads in the period.",
    detail: { source: "ratio", params: { formula: "Ad spend ÷ new leads" } },
  },
  bookingRate: {
    label: "Booking Rate",
    explanation: "Share of leads that booked a call = booked calls ÷ leads in the period.",
    detail: { source: "ratio", params: { formula: "Booked calls ÷ leads" } },
  },
  costPerBookedCall: {
    label: "Cost / Booked Call",
    explanation: "Ad spend ÷ booked calls in the period.",
    detail: { source: "ratio", params: { formula: "Ad spend ÷ booked calls" } },
  },
  costPerDemoCompleted: {
    label: "Cost / Demo",
    explanation: "Ad spend ÷ demos completed in the period.",
    detail: { source: "ratio", params: { formula: "Ad spend ÷ demos completed" } },
  },
  clientRetentionRate: {
    label: "Client Retention Rate",
    explanation: "Retained clients ÷ clients at the start of the period (new clients excluded from the numerator).",
    detail: { source: "ratio", params: { formula: "Retained clients ÷ clients at period start" } },
  },

  // ── Funnel counts — source wiring pending (explanation shown, list coming) ────
  bookedCalls: { label: "Booked Calls", explanation: "Calls booked in the period (from GHL booking stage).", pending: true },
  demosSubmitted: { label: "Demos Submitted", explanation: "Demos submitted in the period (from the demo tracker).", pending: true },
  demosCompleted: { label: "Demos Completed", explanation: "Demos completed in the period (from the demo tracker).", pending: true },
  auditsRequested: { label: "Audits Requested", explanation: "Audits requested in the period (from ClickUp).", pending: true },
  auditsCompleted: { label: "Audits Completed", explanation: "Audits completed in the period (from ClickUp).", pending: true },
  activeProjects: { label: "Active Projects", explanation: "Count of active project engagements (manual override, or project proposals in an active state).", pending: true },
  adSpendTiktok: { label: "TikTok Ad Spend", explanation: "TikTok ad spend in the period (integration pending).", pending: true },
};

export function getMetricEntry(key: string): MetricCatalogEntry | undefined {
  return METRIC_CATALOG[key];
}
