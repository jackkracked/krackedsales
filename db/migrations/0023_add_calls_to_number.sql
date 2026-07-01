-- Dialer calls: persist the dialed number so the Calls page can show it (and
-- phone-match it to a contact) for manual dials. Additive + idempotent.
ALTER TABLE calls ADD COLUMN IF NOT EXISTS to_number text;
