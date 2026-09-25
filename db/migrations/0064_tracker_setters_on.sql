-- 0064: Switch the Pay Tracker on for setters. GO-LIVE STEP, applied only with Jack's go.
--
-- 0060 seeded setters as OFF because the tracker then only computed a closer's pay; Kelsey would
-- have opened it and been told she earned nothing. 0063 and the setter view make it hers.
-- Idempotent: sets the one row, and inserts it if an environment never ran 0060.
UPDATE role_permissions SET enabled = true WHERE role = 'setter' AND feature_key = 'view_tracker';
INSERT INTO role_permissions (role, feature_key, enabled)
SELECT 'setter', 'view_tracker', true
 WHERE NOT EXISTS (SELECT 1 FROM role_permissions WHERE role = 'setter' AND feature_key = 'view_tracker');
