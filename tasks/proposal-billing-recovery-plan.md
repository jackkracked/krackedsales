# Proposal + Billing Recovery Plan (2026-07-15)

Sensitivity: MAXIMUM. Real client money. No step ships without tsc + Stripe-sandbox test + Jack's
sign-off on the money-flow phases. "One million percent flawless."

## What broke (root cause, verified)
1. **Signing dead since ~July 1** — the Stripe restricted key was rotated to one missing "Prices
   Write" (and Payment Links Write). Every subscription sign called `prices.create` → PermissionError
   → 500 → client could not sign. Conversions: May 5 signed / Jun 6 / **Jul 2**. Last sign Jul 1.
   → FIXED: Jack enabled Prices/Products/Payment Links/Checkout/Subscriptions Write. VERIFIED live
   (prices.create + paymentLinks.create now succeed).
2. **Invoices finalized on SEND, before signing** — deposit/single/instalment invoices are created +
   finalized when a proposal is sent, with a 7-day due date → Stripe automatic reminders chase
   unsigned clients. 9 open invoices on unsigned proposals; Katelyn Klos (due Jul 2) + Handmade By
   Meg (Jul 7) already overdue. This "puts clients off" and is a second conversion drag.
3. **Proposals default to same-day expiry** (`expiresAt = todayNoon` in app/api/proposals/route.ts)
   → links die same day; expired ones need delete+resend.

## Hard Stripe constraints (verified, so we don't waste moves)
- Finalized invoices are IMMUTABLE: cannot change/remove due_date ("Non-draft invoices can't be
  updated"), due_date can't be null, max 5y future. No per-invoice reminder off.
- Only ways to stop a finalized invoice's reminders: void it (kills pay page) or account-wide toggle
  (hits real management clients — not allowed).
- Therefore: fix the FLOW to use Payment Links (which never send invoice reminders), THEN void the
  old 9 once the new pay path is live.

## Target model (what Jack wants)
Send proposal → client signs → THEN the invoice/pay link is generated → they pay. NO invoices before
signing. Invoices carry a **30-day due date** (gentle; NOT same-day/7-day, NOT 4 years). NO proposal
expiry. No aggressive auto-chasing — manual chase for now; reminders move to our Reminders section
later. Never over-email prospects.

---

## Phase 0 — DONE
- [x] Stripe key permissions restored + signing verified live.

## Phase 1 — Simplify the money flow (HIGH RISK, sandbox-test, Jack sign-off)
- [ ] SEND (`app/api/proposals/[id]/send/route.ts`): stop creating/finalizing Stripe invoices for all
      structures (single, instalment, subscription, deposit). On send = create/attach the Stripe
      customer only + send the proposal email. No invoice, no due date.
- [ ] SIGN (`app/api/proposals/[id]/sign/route.ts`): generate the pay path AT SIGN.
      - single / instalment / deposit → create the Stripe invoice now with **due_date = +30 days**
        (days_until_due: 30), finalize, point the client to its hosted pay page.
      - subscription (recurring) → durable Payment Link (recurring; the deposit, if any, is the 30-day
        invoice above). Keep the existing subscription payment-link path.
- [ ] Make signing CRASH-PROOF: record the signature FIRST (client is never blocked), then set up the
      pay link best-effort; if it fails, surface loudly to reps/Slack, never 500 the client.
- [ ] Remove proposal expiry entirely: stop setting `expiresAt` (or set far-future/null), drop the
      expiry warning + any expired block on the public signing page. Proposals never expire.
- [ ] Verify end-to-end in Stripe sandbox: send → sign → pay for each structure. tsc + prod build.

## Phase 2 — Retire the 9 premature invoices (AFTER Phase 1 live)
- [ ] Once signing generates fresh pay links, VOID the 9 open invoices (they're no longer the pay
      path) so their reminders stop. List: PEMILL36-0001/0002 (Katelyn), ACCITHCH-0001/0002 (Handmade),
      HOSSRI3K-0001 (Local Love), FCHA1LN7-0001/0002 (Maria), 94AMIDT9-0002 (Phygitals), WRL25NB3-0002
      (Motif). Confirm each client can still pay via the new sign→link path. Jack sign-off before voiding.

## Phase 1.5 — Loud failure alerts to #kracked-ai-sales (Jack's ask — the safety net)
Every customer-facing failure posts a clear, specific message to #kracked-ai-sales via the existing
`postToSalesChannel()` (lib/proposals/slack-notify.ts). This is the net that would have caught the
July permission bug in minutes instead of two weeks. Hook points:
- [ ] SIGN fails (sign route catch): `⚠️ {Company} tried to sign their proposal ({title}, {amount})
      but it failed: {error}.` — the most important one; fires the instant signing breaks again.
- [ ] PAYMENT fails (webhook `invoice.payment_failed`): `⚠️ {Company} tried to pay {invoice #} ({amount})
      but the payment failed: {reason}.`
- [ ] SUBSCRIPTION setup fails after a deposit is collected (deposit-billing critical path): `🚨 {Company}
      paid their deposit but the subscription could NOT be created: {error}. Set it up manually.`
- [ ] SEND fails (send route catch): `⚠️ Couldn't send {Company}'s proposal: {error}.`
Each message names the company, the action, the invoice/proposal + amount, and the exact error.
Alert posting is best-effort (never blocks or breaks the customer path).

## Phase 3 — Pull ALL activity into the app (Jack's explicit ask)
- [ ] Surface every invoice/payment/reminder event in the app's activity view: finalized, reminder
      scheduled/sent (Stripe's AND ours), paid, voided — including existing history. Source: Stripe API
      backfill + webhook events → activity log. So nothing ever happens to a client invisibly again.

## Phase 4 — Re-engage stuck deals + follow-ups
- [ ] The ~8 stuck July proposals hit a dead sign button — give Jack the list to re-send/nudge now
      that signing works (Formula Z, Rendic Ranch, Epiphany, Fluency Beauty, Motif, Phygitals, + the
      single/instalment ones). These are recoverable revenue.
- [ ] Edit-and-resend (Gage): edit agreement wording + expiry without delete + resend.
- [ ] Move all chasing into the Reminders section (controlled, branded, not Stripe-auto).

## Revenue-decline finding (honest)
The July collapse was SYSTEM-caused, not demand: signing was physically broken from ~Jul 1 by the key
permission. That is the recoverable outcome — the stuck deals can now convert. It is NOT a market
problem. Fix Phase 1, re-engage Phase 4, and revenue should recover.
