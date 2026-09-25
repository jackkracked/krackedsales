-- 0060: Let setters and closers see their own Pay Tracker.
--
-- WHY A MIGRATION AND NOT JUST A CONSTANT
-- lib/auth/permissions.ts falls back to `role === "admin"` when a feature has no row for a
-- role. So adding the key to ROLE_PRESETS alone makes the nav item invisible to exactly the
-- people it is for. The seed has to exist in the database.
--
-- Reading the page still only ever returns the viewer's OWN pay unless they are an admin:
-- that rule lives in app/api/tracker/closer/route.ts and is enforced on the session, not here.
--
-- Additive and idempotent: inserts only where the row is absent, so re-running changes nothing
-- and an admin who has since switched it OFF is not silently switched back on.
INSERT INTO role_permissions (role, feature_key, enabled)
SELECT r.role, 'view_tracker', true
  FROM (VALUES ('setter'), ('closer'), ('rep'), ('admin')) AS r(role)
 WHERE NOT EXISTS (
   SELECT 1 FROM role_permissions x WHERE x.role = r.role AND x.feature_key = 'view_tracker'
 );
