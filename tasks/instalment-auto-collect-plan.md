# Instalments must collect themselves, and stop at the last one

Created 2026-09-24. Owner: Jack. Status: built and proven, AWAITING JACK'S GO TO DEPLOY.

Jack, 2026-09-24: "It's an instalment. It should automatically collect if it's not a
subscription. And then stop on the last instalment. It shouldn't be that hard. We already have
the details." Plus: "I don't want any negative cascading effects."

## What is wrong today, measured

1. **Nothing raises instalment 2 onwards.** The call that does it is commented out in the Stripe
   webhook, disabled for the silent 13 August billing-dates release and never re-enabled.
   9 paying clients, 13 invoices, **$20,975** never billed.
2. **Even when on, it does not COLLECT.** It creates a `send_invoice` invoice, which emails the
   client a link and waits for them to pay. Jack is asking for the card on file to be charged.
   Measured against live Stripe on 2026-09-24: **8 of the 9 clients already have a saved payment
   method with a default set** (card or Link). Only Chris Branch has none.
3. **A failed payment silently skips ahead.** `invoice.payment_failed` sets the instalment to
   `failed`. The "is anything still outstanding" guard only looks for `pending` rows, so a
   failed instalment does not block, and the NEXT one would be billed while the unpaid one is
   forgotten. Nobody would notice until the total came up short.

## The rules this must obey

- If the deal has a Stripe subscription, do nothing. The subscription owns that money.
- If the customer has a default payment method, **charge it automatically** on the due date.
- If they do not, fall back to emailing an invoice. Never fail silently, never skip the client.
- **One outstanding instalment at a time.** Anything not paid blocks the next, whatever its
  status: pending, failed, uncollectible, draft.
- **Stop at the last instalment.** No invoice is ever created beyond the agreed count, and the
  proposal is marked paid when the final one settles.
- Never create a second invoice for an instalment that already has one (idempotency key).
- Never charge earlier than the date the client agreed.

## Date rule, decided by Jack 2026-09-24

New deals: each instalment falls **30 days after the previous payment**. For the 9 existing
clients, bill on the LATER of the agreed date and the recalculated one, so nobody is ever asked
earlier than the schedule they were shown. (Without that guard Olive & Piper would move from
16 October to 16 September, pulling $5,125 forward a month against what they agreed.)

## Validation required before this touches a client

- Test-mode proof, Stripe Test Clock: auto-charge fires on the due date, not on signing.
- Test-mode proof: after the LAST instalment, nothing further is created.
- Test-mode proof: a failed payment blocks the next instalment instead of skipping it.
- Test-mode proof: a customer with no saved method gets an invoice, not a crash.
- Test-mode proof: running the job twice creates exactly one invoice.
- Independent staff review of the diff before deploy.
- Live catch-up on ONE client (Roots) first, verified in Stripe, before the other 8.


## Two review rounds, and what they caught (2026-09-24)

Nothing here was found by reading the code and feeling confident. Both rounds found defects that
would have reached a client's card.

### Round one
1. **Double charge.** The call was fire-and-forget, so Vercel could reclaim the instance between
   Stripe creating the invoice and our recording it. Thirty days later Stripe charges the card,
   we cannot match the payment to a row, and we raise it again. Stripe's idempotency key expires
   after 24 hours, so it would not have stopped it. Enzo Prina, $2,900, twice.
2. **Overdue instalments debited on the spot**, with the whole remaining balance able to leave
   one card within minutes.
3. **A voided or written-off invoice jammed a client forever**, silently. Production had already
   seen 20 voided and 27 failed-payment events.
4. **$12,400 of superseded rows were one guard away from being billed twice.**
5. **Declined payments would have vanished from the overdue figures**, so collection getting
   worse would make overdue revenue go down.

### Round two, after the fixes
1. **A no-card client already overdue could never be billed at all.** Stripe rejects a `due_date`
   in the past, confirmed against the API. Flooring the send instant had missed the due date
   itself, so it threw on every attempt: alerted daily, collected never. Deterministic, not a
   race, and it would have hit Chris Branch the day his date passed.
2. **The void fix created a worse bug.** Clearing the invoice id let the daily sweep raise a new
   invoice the next morning and debit the card three days after a human deliberately voided it.
   A killed invoice is now terminal ("cancelled") and a person decides what happens next.
3. **The manual "mark paid" toggle moved money from one unconfirmed click**, with no admin
   check, no ownership scoping, no runtime validation, and it left the superseded Stripe invoice
   live so the client could pay twice. All five fixed.

Also fixed: the repair step could bind a row to a $0 or written-off invoice; a failed finalise
jammed the row permanently; a deleted draft was unhandled; and the re-onboarding guard did not
work for the nine clients it was written for.

## Proof

- `scripts/stripe-test/prove-engine-real.ts` — **19/19**, calls the real engine against seeded
  rows, including the double-charge scenario reproduced deliberately (raise, wipe the record,
  re-run: finds the existing invoice, charges nothing).
- `scripts/stripe-test/prove-auto-collect.mjs` — **14/14**, Stripe's own timing behaviour.

## Deploy order, deliberately

The sweep cron is written and tested but **not scheduled**. Scheduled now, its first run would
raise invoices for all nine clients on their agreed dates, front-running the catch-up script
that applies Jack's 30-day rule. So: deploy, run the catch-up on one client, verify, run the
rest, then schedule the sweep.
