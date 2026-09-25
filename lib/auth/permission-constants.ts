/** Importable from both client and server components — no server-only imports here.
 *  One feature key per sidebar item (plus view_team). Order mirrors the sidebar so the
 *  per-user permission toggles read top-to-bottom like the nav. Adding a sidebar item?
 *  Add its key here and set item.featureKey in the sidebar — the toggle list auto-syncs. */

export const FEATURES = [
  // Work
  "view_dashboard",
  "view_leads",
  "view_pipeline",
  "view_contacts",
  "view_proposals",
  "view_boards",
  "view_calls",
  "view_dialer",
  "view_calendar",
  "view_tasks",
  "view_inbox",
  // Measure
  "view_kpis",
  "view_money",
  "view_tracker",
  "view_demo_tracker",
  "view_analytics",
  "view_activity",
  "view_team",
  // Automate
  "view_workflows",
  "view_reminders",
  "view_follow_ups",
  "view_templates",
  // Bottom
  "manage_settings",
] as const;

export type FeatureKey = (typeof FEATURES)[number];

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  view_dashboard:    "Dashboard",
  view_leads:        "Leads",
  view_pipeline:     "Pipeline",
  view_contacts:     "Contacts",
  view_proposals:    "Proposals",
  view_boards:       "Boards",
  view_calls:        "Calls",
  view_dialer:       "Dialer",
  view_calendar:     "Calendar",
  view_tasks:        "Tasks",
  view_inbox:        "Inbox",
  view_kpis:         "KPIs",
  view_money:        "Money",
  view_tracker:      "Pay Tracker",
  view_demo_tracker: "Demo Tracker",
  view_analytics:    "Analytics",
  view_activity:     "Activity",
  view_team:         "Team Overview",
  view_workflows:    "Workflows",
  view_reminders:    "Reminders",
  view_follow_ups:   "Follow-ups",
  view_templates:    "Templates",
  manage_settings:   "Settings",
};

/** Sensible starting sidebar visibility per role. Editable afterward via the toggles;
 *  seeded into role_permissions by scripts/apply-0044-roles.mjs. admin = everything. rep is the
 *  retired-but-still-resolved role (preserves what reps saw). setter/closer per the agreed presets. */
export const ROLE_PRESETS: Record<string, Partial<Record<FeatureKey, boolean>>> = {
  // rep: every non-admin sidebar item they see today stays on; admin-only stays off.
  rep: {
    view_dashboard: true, view_pipeline: true, view_contacts: true, view_proposals: true,
    view_boards: true, view_calls: true, view_calendar: true, view_tasks: true, view_inbox: true,
    view_demo_tracker: true, view_analytics: true, view_workflows: true, view_follow_ups: true,
    view_tracker: true,
    view_templates: true, manage_settings: true,
    view_dialer: false, view_kpis: false, view_money: false, view_activity: false,
    view_team: false, view_reminders: false,
  },
  setter: {
    view_dashboard: true, view_pipeline: true, view_contacts: true, view_calls: true,
    view_dialer: true, view_calendar: true, view_tasks: true,
    // Off until the SETTER half of the tracker exists. Today the page computes a closer's
    // proposals, so a setter would open it and be told they earned nothing. One toggle in
    // team settings turns it on the day their booking bonus is real.
    view_tracker: false,
  },
  closer: {
    view_dashboard: true, view_pipeline: true, view_contacts: true, view_proposals: true,
    view_calls: true, view_calendar: true, view_tasks: true, view_inbox: true,
    view_follow_ups: true, view_templates: true, view_tracker: true,
  },
};

/** The assignable roles shown in the UI, in display order. "rep" is retired — kept out of the
 *  pickers but still resolved/labelled for any legacy rep user until they're reassigned. */
export const ROLES = ["admin", "closer", "setter"] as const;
export type Role = (typeof ROLES)[number];
/** Labels for display (badges etc.) — includes the retired "rep" so legacy users still label. */
export const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  closer: "Closer",
  setter: "Setter",
  rep: "Rep",
};

/** Full feature→enabled map for a role from the presets (admin = everything). Used as the
 *  fail-CLOSED fallback when the DB permission lookup errors, so the nav never leaks admin links. */
export function resolveRolePreset(role: string): Record<FeatureKey, boolean> {
  const map = {} as Record<FeatureKey, boolean>;
  for (const f of FEATURES) map[f] = role === "admin" ? true : (ROLE_PRESETS[role]?.[f] ?? false);
  return map;
}
