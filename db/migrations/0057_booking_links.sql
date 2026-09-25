-- 0057: Tracked booking links, so a booked call can be credited to the person who earned it.
--
-- WHY THIS EXISTS
-- Jack, 2026-09-22: Kelsey books calls by sending a GoHighLevel booking link. Measured across
-- all 17 calendars: 68% of appointments are created by `booking_widget`, i.e. the PROSPECT
-- booked themselves off a link. GoHighLevel records no user against those, so there is nothing
-- to read to find out whose work produced the booking. Her commission sheet pays $25 per
-- booked call, so "we cannot tell" is not an acceptable answer.
--
-- A link minted HERE, per send, closes that gap: we know who generated it, for whom, on which
-- calendar, whether it was clicked, and therefore which booking to credit. It is a record
-- rather than an inference.
--
-- Deliberately mirrors `proposal_events` + /api/proposals/track/[token], which already does
-- exactly this for proposals (32 random bytes, a redirect that logs the click).
--
-- Additive and idempotent. Safe to re-run. Nothing reads it until the quick action ships.
CREATE TABLE IF NOT EXISTS booking_links (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token          text NOT NULL UNIQUE,
  ghl_contact_id text NOT NULL,
  contact_name   text,
  calendar_id    text NOT NULL,
  calendar_name  text,
  -- The destination this token redirects to, frozen at mint time so a later calendar rename
  -- or slug change cannot silently repoint a link already in a prospect's inbox.
  target_url     text NOT NULL,
  sent_by_user_id uuid REFERENCES users(id),
  sent_by_name   text,
  -- "sent" when it went out as a message we delivered, "copied" when the rep took the link to
  -- paste elsewhere. Both attribute a booking; only "sent" proves outreach actually happened,
  -- so the funnel must never count a copy as a send.
  delivery       text NOT NULL DEFAULT 'sent',
  channel        text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  first_clicked_at timestamptz,
  click_count    integer NOT NULL DEFAULT 0,
  -- Set when an appointment for this contact was matched back to this link.
  booked_at      timestamptz,
  ghl_appointment_id text
);

CREATE INDEX IF NOT EXISTS booking_links_contact_idx ON booking_links (ghl_contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS booking_links_sender_idx ON booking_links (sent_by_user_id, created_at DESC);
