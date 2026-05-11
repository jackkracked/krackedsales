/** Importable from both client and server components — no server-only imports here */

export const FEATURES = [
  "view_dashboard",
  "view_kpis",
  "view_team",
  "view_analytics",
  "view_pipeline",
  "view_inbox",
  "view_calls",
  "view_calendar",
  "view_demo_tracker",
  "view_follow_ups",
  "view_templates",
  "manage_settings",
] as const;

export type FeatureKey = (typeof FEATURES)[number];

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  view_dashboard:    "Dashboard",
  view_kpis:         "KPI Analytics",
  view_team:         "Team Overview",
  view_analytics:    "Analytics",
  view_pipeline:     "Pipeline",
  view_inbox:        "Inbox",
  view_calls:        "Calls",
  view_calendar:     "Calendar",
  view_demo_tracker: "Demo Tracker",
  view_follow_ups:   "Follow-ups",
  view_templates:    "Templates",
  manage_settings:   "Settings",
};
