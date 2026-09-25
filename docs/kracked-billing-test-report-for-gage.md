# Kracked Billing System: Test Report

A plain-English record of everything that was tested, how, and what came back.

Prepared: 15 July 2026. Environment: Stripe test mode (real Stripe behaviour, no real money) plus read-only checks against the live account.

---

## What "tested" means here

Two kinds of testing were done.

1. **Safe simulation.** Stripe provides a full test environment that behaves exactly like the real thing but moves no actual money and uses fake test cards. Every payment shape was run through it from start to finish.

2. **Live truth checks.** Read-only look-ups against the real Stripe account and our real database, to confirm the live system is set up correctly and our current clients are genuinely being billed. Nothing live was changed, except one tiny throwaway test object that was deleted straight after.

Every result below is a real check that either passed or failed. Nothing is assumed.

---

## Headline result

**Everything passed.** 19 out of 19 simulation checks passed across all four deal types. Every live check passed. Our three current retainer clients were each confirmed to be billing correctly in Stripe.

The one thing that is not a bug, but is worth knowing, is listed at the end under "Open items."

---

## Section 1: The four deal types (safe simulation)

Each was run end to end: set up the client, create the invoice or subscription, take a test payment, confirm the outcome.

**Monthly retainer, no deposit.** PASS.
- The client was put on a real recurring monthly subscription.
- The first month was charged correctly ($1,000 in the test).
- It is set to renew on its own every month.

**Monthly retainer, first charge on a chosen future date.** PASS.
- The subscription was created but correctly held off charging until the chosen start date.
- Nothing was taken early.

**Monthly retainer with a deposit.** PASS.
- The deposit invoice was created with a 30-day window.
- The deposit was paid.
- Only after that did the monthly subscription begin, and it began at the correct monthly retainer amount, not the deposit amount.

**Deposit split into two payments.** PASS.
- Both deposit payments were created as separate 30-day invoices and both were paid.
- Confirmed the subscription is designed to start only once the whole deposit is in, not after the first part.

**One-off project fee.** PASS.
- A single 30-day invoice was created and paid in full ($1,500 in the test).

**Project fee split into instalments.** PASS.
- Two instalment invoices ($750 each) were created and both paid, moving the deal from partly-paid to fully-paid.

---

## Section 2: Safety and edge cases (safe simulation)

**30-day payment window.** PASS. Every invoice created gives the client 30 days to pay. Checked directly on the invoices.

**No duplicate invoices.** PASS. If a signing is retried, the system re-uses the existing invoice instead of creating a second one. A client can never receive two invoices for the same thing.

**No duplicate payment links.** PASS. The same safeguard applies to subscription payment links.

**Declined card.** PASS. When a test card was deliberately declined:
- nothing was charged,
- the invoice stayed open so the client can simply try again,
- and this is exactly the situation that triggers a Slack alert to the team.
- A declined card does not cancel or damage a signed deal.

**Paid-in-full retainers (no auto-renew).** PASS. When a retainer is sold as a fixed prepaid term rather than ongoing, the subscription is correctly set to bill once and then stop, while still counting as an active client for the term.

---

## Section 3: Live system checks (real account, read-only)

**Can a client sign right now?** PASS.
The exact key the live app uses was tested for the two abilities that were broken in early July (creating a subscription price and a payment link). Both worked. This is the direct proof that the July signing failure is genuinely fixed, tested against the real live key, not a copy.

**Is the app being told about payments?** PASS.
Confirmed the live account is actively sending our app its payment notifications, and that they are being recorded. Recent real events include paid invoices, subscription updates, declined payments, and voided invoices. Eight deals have been correctly carried through to "paid" this way.

**Does the Billing Activity view show the truth?** PASS.
Checked on several real proposals. The live status (Paid, Awaiting payment, Overdue) matched Stripe's actual state each time, because it reads from Stripe directly.

**Are our current retainer clients actually being billed?** PASS. This was the most important check. Each was confirmed against Stripe one by one:

| Client | Monthly | Status in Stripe | Auto-renews |
|---|---|---|---|
| Better Blends | $1,000 | Active | Yes |
| Cuticle & Company | $2,400 | Active | Yes |
| Jeff O'Shea | $1,200 | Active | Yes |

All three are live, active, recurring subscriptions. The money is flowing. There is no missing revenue among current clients.

**Does the code still build cleanly?** PASS. The project compiled with zero errors, which is our required check before anything ships. The live app is up and responding.

---

## Section 4: Open items (not failures, but worth knowing)

1. **Nine old invoices** were created under the previous behaviour (before we moved invoicing to happen only at signing). They sit against proposals that were never signed. They are harmless and have been left untouched on purpose. This is the one bit of cleanup still outstanding.

2. **Three retainer records** (the three clients above) are billing perfectly in Stripe, but their subscription is not yet linked back onto their record inside our own app. This is a display and reporting detail, not a money detail. New deals link automatically going forward. The three old ones can be tidied in a couple of minutes on request.

3. **Stuck July deals.** Several proposals stalled on the broken sign button during the outage. Now that signing works, these are recoverable revenue worth re-engaging.

---

## How to read the confidence level

This was not a "looks fine" review. Every payment shape was actually run through Stripe and made to pay. The live key was actually exercised. The current clients were checked one by one against Stripe. If a rep sends a proposal today, a client can sign it, pay it, and we will know the instant they do, with the whole team alerted if anything goes wrong.

If any real client's situation looks different from what is described here, send me the name and I will trace that exact deal against the live system.
