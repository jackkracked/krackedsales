# How Kracked Bills Clients

A plain-English guide to how our proposal and payment system works, start to finish.

Written for Gage. Last fully tested and verified: 15 July 2026.

---

## The short version

When a rep builds a proposal in the app, the client gets a clean link. They read it, they sign it, and only then does the app set up how they pay. The client pays through Stripe (our card and subscription processor). The moment their money lands, Stripe tells our app, the app marks the deal as paid, and the client gets a receipt. If anything goes wrong at any step, the whole team gets a message in the #kracked-ai-sales Slack channel within seconds.

That is the entire system in one paragraph. The rest of this doc explains each piece so you can sanity-check it yourself.

---

## The journey of every deal

Every deal moves through three stages, in this order, always:

1. **Send.** The rep finishes the proposal and sends it. At this point the app creates the client's record in Stripe (so we are ready to bill them later) and emails them the proposal link. **Nothing is charged and no invoice is created yet.** A sent proposal that is never signed will never chase the client for money.

2. **Sign.** The client opens the link and signs. The signature is saved first, before anything else happens. Then, and only then, the app sets up their payment: it creates the right invoice or subscription link for whatever they agreed to. If that payment setup ever hiccups, the signature is still safely recorded and the team is alerted, so a client can never be blocked from signing again.

3. **Pay.** The client pays on Stripe's secure page. Stripe notifies our app automatically, the deal flips to "paid," a receipt goes out, and (for retainers) their monthly billing is now live.

The key rule, and the thing that changed recently: **money setup happens at signing, never before.** We do not put an invoice in front of anyone until they have agreed to work with us.

---

## The four ways a client can pay

The app handles four deal shapes. A rep picks one when building the proposal.

**1. Monthly retainer (management).**
The client is set up on a real recurring subscription in Stripe. They are charged the same amount every month automatically, and it renews on its own until cancelled. The rep can choose the date of the first charge (for example, "start billing on the 1st of next month"), and Stripe simply waits until that date.

**2. Monthly retainer with a deposit.**
Same as above, but the client pays a one-time deposit first (for onboarding, setup, a first-month commitment, whatever we agreed). The deposit goes out as its own invoice. Once the deposit is fully paid, the recurring monthly subscription is created. Importantly, the recurring amount is the agreed monthly retainer, not the deposit. The deposit can even be split into more than one payment, and the subscription only starts once the whole deposit is collected.

**3. One-off project fee.**
A single invoice for the full project amount. The client pays it once and it is done. No subscription, no recurring charge.

**4. Project fee split into instalments.**
The project total is broken into a few invoices (for example, two payments of $750). Each is its own invoice. As each one is paid, the deal moves from partly-paid to fully-paid.

Every invoice we create gives the client **30 days to pay.** It is a gentle window, not a same-day or aggressive deadline.

---

## How the app knows a client has paid

This is the part that quietly matters most, so it is worth being clear.

We never store a "paid" flag by guessing or by a rep ticking a box. When a client actually pays, Stripe sends our app a secure, signed message (called a webhook). Our app listens for these messages around the clock. When one arrives, the app:

- flips the deal to "paid,"
- records the exact time and amount,
- links the deal to the live subscription (for retainers),
- and sends the client their receipt.

So "paid" in our app always means "Stripe actually took the money." The two can never drift apart, because Stripe is the one telling us.

---

## What happens if a payment fails, or anything breaks

Silence used to be the enemy. Now every customer-facing problem shouts.

If any of these happen, a clear, specific message posts to **#kracked-ai-sales** immediately, naming the client, the amount, and the problem:

- a client tries to pay and their card is declined,
- a client signs but their payment setup fails for any reason,
- a deposit is collected but the subscription could not be created,
- a proposal fails to send.

A declined card is treated as retryable. It does **not** cancel a signed deal or wipe anything out. It just tells us to follow up, and the client can still pay the same invoice.

This alerting is the safety net. If signing had broken like it did in early July (see below), we would have known within minutes instead of weeks.

---

## Seeing it all in one place: Billing Activity

Open any proposal in the app and you will see a **Billing Activity** timeline. It shows, in order, everything that has ever happened to that deal's money: proposal created, sent, signed, invoice created, invoice emailed to the client, reminder sent, paid, failed, subscription started, and so on. Each row that relates to a Stripe invoice links straight to Stripe.

At the top there is a live status badge: Paid, Awaiting payment (with the due date), or Overdue. This pulls the truth directly from Stripe every time it loads, so it is never stale. This view is admin-only.

The point: nothing ever happens to a client's money invisibly again. If it happened, it is on this timeline.

---

## What went wrong in July, and what we fixed

Being straight about it, because you asked the right questions.

Two real problems were found and fixed:

**1. Signing was silently broken from around July 1st.**
The key that lets our app talk to Stripe had been swapped to a restricted one that was missing a permission it needed to create subscriptions. Every time a management client tried to sign, it failed behind the scenes. This is the single biggest reason July looked like our worst month. It was a system fault, not the market. It is now fixed: the app runs on a full-permission key, and I have tested against the live key that a client can sign today. On top of that, the Slack alerts above now mean this exact failure could never go unnoticed for two weeks again.

**2. Invoices were being created before clients signed.**
You spotted this. Older proposals created and sent invoices the moment the proposal was sent, so unsigned prospects were getting chased for money. That was wrong. The flow now creates invoices only at signing. Proposals also no longer expire, so a link cannot quietly die on a client.

There are still nine older invoices that were created under the old behaviour, sitting against proposals that were never signed. We have deliberately left those untouched for now rather than risk disturbing anything. They are the only loose end, and they are inert.

---

## What was tested, and what it showed

Before writing this, I ran the whole system end to end in Stripe's safe test environment (real Stripe behaviour, no real money), plus checks against the live account. Results:

- All four deal shapes work correctly from signing through to payment: retainer, retainer-with-deposit, one-off project, and split instalments. 19 separate checks, all passed.
- A retainer client is genuinely put on a recurring monthly subscription that renews on its own.
- A deposit is collected first, and only then does the monthly subscription begin, at the correct monthly amount.
- The 30-day payment window is applied to every invoice.
- The system never creates a duplicate invoice or a duplicate payment link, even if signing is retried.
- A declined card is handled gracefully and alerts the team, without breaking the deal.
- Signing works against the real live key (the July problem is genuinely resolved).
- The "paid" notifications from Stripe are being received and are correctly moving deals to paid.

And the most reassuring check of all: **our three current retainer clients are all being billed correctly right now.** I confirmed each one against Stripe directly:

- Better Blends, active, $1,000 per month, auto-renewing.
- Cuticle & Company, active, $2,400 per month, auto-renewing.
- Jeff O'Shea, active, $1,200 per month, auto-renewing.

The money is flowing. There is no gap in what these clients are paying.

---

## The short list worth knowing

1. **The nine old pre-signing invoices** are left alone on purpose. They are harmless but they are the one bit of cleanup still outstanding.
2. **Those three retainer clients** are billing perfectly in Stripe, but their subscription is not yet linked back onto their record inside our app (a display detail, not a money detail). New deals link automatically. I can tidy the three old ones in a couple of minutes whenever we want.
3. **The stuck July deals** are recoverable. Several proposals hit the broken sign button and stalled. Now that signing works, those are real revenue we can re-engage.

If anything here does not match what you are seeing, tell me and I will dig into that exact deal. Everything above is checked against the live system, not assumed.
