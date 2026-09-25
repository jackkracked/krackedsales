# 90-Day / Instalment Billing — recovery + permanent fix

**Owner:** Jack · **Raised by:** Gage, 2026-08-04 · **Status:** recovery DONE, code fixes WRITTEN, deploy PENDING APPROVAL

## Background

Six clients on 90 Day Retention Sprints had paid their first payment and had **nothing in Stripe** to collect payments 2 and 3. Cause: they were sold as *Projects with instalments* because the 90-day Management product did not exist in the proposal builder yet. The sign route creates instalment #1's invoice and **nothing ever creates #2 or #3**. Blast radius ~$21.8k across nine signed deals. Nothing was declined and nothing was late; the clients had simply never been billed.

---

## Phase 1 — Recovery (DONE 2026-08-05)

- [x] Prove the mechanic in Stripe test mode with a Test Clock — 16/16 (`scripts/stripe-test/prove-midterm-subscription.mjs`)
- [x] Prove Motif's sent invoice cannot be converted (Stripe: "Non-draft invoices can't be updated") and pay-off-session cannot double-charge (`scripts/stripe-test/prove-no-double-charge.mjs`)
- [x] Move 5 clients onto real subscriptions, dormant until their agreed dates (`scripts/fix-90day-billing.mjs`, dry-run by default, 8 preflight guards each)
- [x] Correct Green Haus's due dates (all three recorded as 24 Jul)
- [x] Hand manual MRR rows over to the subscriptions on each start date (no double-count, no dip)
- [x] Verify 49/49 — nothing charged, one subscription each, all dormant, all self-stopping

**$12,400 now collects itself.**

| Client | Charges | Then | Stops |
|---|---|---|---|
| Daily Few (Rossi Mckee) | 16 Aug $1,500 | 16 Sep $1,500 | 16 Oct |
| Green Haus Girls THC | 23 Aug $1,000 | 23 Sep $1,000 | 23 Oct |
| Primal Pal (Eat Meat Media) | 24 Aug $1,000 | 24 Sep $1,000 | 24 Oct |
| Cheeky | 23 Aug $1,200 | 23 Sep $1,200 | 23 Oct |
| Blush & Bliss | 27 Aug $1,500 | 27 Sep $1,500 | 27 Oct |

### Incident during Phase 1 (contained)
A subscription created with `trial_end` makes Stripe emit a **$0 invoice**, marked paid instantly. The webhook matched it to the proposal via metadata and marked five part-paid deals "paid" → 4 client receipt emails (delivered, unrecallable), 4 false Slack "Paid: $4,500" alerts, 8 onboarding tasks. Statuses restored, Slack posts and tasks deleted, metadata key renamed so the real Aug/Sep charges cannot re-trigger it. **No money moved.** Write-up in `tasks/lessons.md`.

---

## Phase 2 — Code fixes (WRITTEN, NOT DEPLOYED)

- [x] **Guard `invoice.paid` against $0 invoices** — `app/api/stripe/webhook/route.ts`. The exact bug that caused the incident.
- [x] **Issue the next instalment invoice when one is paid** — new `lib/proposals/instalment-billing.ts`, wired into the webhook. Root-cause fix. Sequential, refuses if a subscription owns the money, refuses if a row already has an invoice, idempotency-keyed.
- [x] **Stop the display tripling** — `lib/proposals/billing.ts`. An instalment plan stores the FULL value, not a monthly figure. This is what showed Cheeky's $3,600 as $10,800.
- [ ] Typecheck + independent review
- [ ] Deploy decision — BLOCKED, see below

### Deploy risk — needs Jack's call
`vercel --prod` ships the **local working tree**, currently **32 commits ahead of origin/main** (last push 2 Jul) plus dozens of uncommitted modified files. Deploying three small billing fixes would also ship all of that, unreviewed.
1. Review + commit the backlog, then deploy (safest)
2. Cherry-pick these three changes onto a clean branch, deploy that (recommended)
3. Deploy as-is (not recommended)

---

## Phase 3 — Outstanding

- [ ] **Motif, $1,000 due 16 Aug.** Invoice already sent, Stripe won't let us convert it. Needs the client to pay it or a one-off off-session charge on the day (proven safe).
- [ ] **Turn on Stripe dunning** (retries + failed-payment emails) in the dashboard. Free safety net, currently unverified.
- [ ] **Enable the `invoice_reminder` template** — currently disabled, so nothing chases an unpaid invoice.
- [ ] **~$23.7k of genuinely overdue invoices** (Casey Sherlock, Nature's Garden, Fly By Jing, Bright Side Candles + more). Separate problem: these clients WERE invoiced and have not paid. Nobody is chasing.
- [ ] **Daily reconciliation alert**: money owed in our DB vs what exists in Stripe, Slack any mismatch. Would have caught this on 18 Jul, not 5 Aug.
- [ ] **Make the broken state impossible**: a proposal with >1 payment should not be signable without a way to collect the rest.
- [ ] **Motif has no signature on file** (`signed_at` null) yet $1,000 was collected.
- [ ] **Tighten acceptance wording** to state scheduled payments are automatically charged to the card on file.

## Open questions for Gage
- Is "Daily Few" the same deal as Rossi Mckee? Only match on amount and dates.
- Cheeky: Gage said the 25th, signed agreement says the 23rd. Went with the agreement.
