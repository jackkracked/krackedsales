-- Store the appointment/outcome status on calls (booked | confirmed | showed |
-- noshow | completed). Additive + idempotent. Meet/scheduled calls carry the
-- GHL appointmentStatus; dialer calls leave it null.
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "status" text;
