// Migration 0044 — role presets for admin / rep / setter / closer across all 21 sidebar features.
// Reseeds role_permissions for these four roles deterministically (delete + insert), so the sidebar
// (now permission-driven) reflects each role. rep preserves exactly what reps see today. Per-user
// overrides (user_permission_overrides) are untouched. Keep in sync with lib/auth/permission-constants.ts.
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const env = readFileSync(".env.verify", "utf8");
const url = env.split("\n").find((l) => l.startsWith("DATABASE_URL_UNPOOLED="))
  ?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL_UNPOOLED not found in .env.verify");
const sql = neon(url);

const FEATURES = [
  "view_dashboard", "view_pipeline", "view_contacts", "view_proposals", "view_boards",
  "view_calls", "view_dialer", "view_calendar", "view_tasks", "view_inbox",
  "view_kpis", "view_money", "view_demo_tracker", "view_analytics", "view_activity", "view_team",
  "view_workflows", "view_reminders", "view_follow_ups", "view_templates", "manage_settings",
];

// true-sets per non-admin role (admin = everything true)
const TRUE = {
  rep: ["view_dashboard", "view_pipeline", "view_contacts", "view_proposals", "view_boards",
        "view_calls", "view_calendar", "view_tasks", "view_inbox", "view_demo_tracker",
        "view_analytics", "view_workflows", "view_follow_ups", "view_templates", "manage_settings"],
  setter: ["view_dashboard", "view_pipeline", "view_contacts", "view_calls", "view_dialer",
           "view_calendar", "view_tasks"],
  closer: ["view_dashboard", "view_pipeline", "view_contacts", "view_proposals", "view_calls",
           "view_calendar", "view_tasks", "view_inbox", "view_follow_ups", "view_templates"],
};

const roles = ["admin", "rep", "setter", "closer"];
const enabledFor = (role, f) => (role === "admin" ? true : TRUE[role].includes(f));

// Clean reseed for these four roles (leaves any other roles + all user overrides intact).
await sql.query(`delete from role_permissions where role = any($1)`, [roles]);

let n = 0;
for (const role of roles) {
  for (const f of FEATURES) {
    await sql.query(
      `insert into role_permissions (role, feature_key, enabled) values ($1, $2, $3)`,
      [role, f, enabledFor(role, f)],
    );
    n++;
  }
}

// Verify
const counts = await sql.query(
  `select role, count(*)::int as features, sum(enabled::int)::int as enabled
   from role_permissions where role = any($1) group by role order by role`, [roles]);
console.log(`Seeded ${n} rows.`);
console.log(JSON.stringify(counts, null, 2));
console.log("0044 applied.");
