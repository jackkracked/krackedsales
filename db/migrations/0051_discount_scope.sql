-- 0051: discount scope — does a discount repeat every month, or come off once?
--
-- THE BUG THIS FIXES
-- A discount was baked straight into `proposals.total_amount`, and for a management proposal
-- that column IS the monthly price. So a "$250 off" on a $1,000/month 90-day term became a
-- $750 discount: Stripe was told the subscription costs $750/month and charged that three
-- times (sign/route.ts passes total_amount as monthlyAmountCents). Gage spotted it on the
-- Kamil Broz proposal — 90-day total read $2,250 instead of $2,750.
--
-- NULL means "recurring", which is exactly today's behaviour, so every existing proposal is
-- unchanged and no backfill is needed.
--
--   recurring      — comes off every month. total_amount stays the DISCOUNTED monthly price.
--   first_payment  — comes off once. total_amount is the FULL monthly price and the discount is
--                    carried separately, applied to the first payment only (and, where a first
--                    month is split into portions, to the FIRST PORTION — Jack, 2026-08-15).
--                    In Stripe this is a coupon with duration "once", so the subscription runs at
--                    full price and only invoice 1 is reduced. It also shows as a real discount
--                    line on the client's invoice rather than an unexplained lower price.
--   total          — a single-payment project. One payment, so scope is academic; stored
--                    explicitly so the intent is readable rather than inferred.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS discount_scope text;

-- The Stripe coupon created for a first_payment discount, so a re-signed or resumed checkout
-- reuses it instead of stacking a second discount on the same proposal.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS stripe_discount_coupon_id text;
