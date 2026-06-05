# Deposit System for Management Proposals

## Status: APPROVED — ready to build

## Summary

A deposit option for management (subscription) proposals that lets reps collect upfront payments in flexible instalments before the Stripe subscription starts. Deposits cover the first billing cycle. The subscription auto-creates when all deposits are paid, with the first charge skipped (via Stripe `trial_end`).

## Key decisions (confirmed by Jack)

- Deposits are for **management proposals only** (project proposals already have instalments)
- Deposit total is **locked to one billing cycle** amount (e.g. $2,000 for a $2,000/month retainer)
- Deposit can be **split into multiple instalments** (any number, any split, must total one cycle)
- Deposit **covers the first month** of the retainer — clearly communicated in UI
- Subscription **auto-starts** when all deposits are paid (no manual trigger needed)
- Admins can **override** and mark deposits as paid to trigger subscription creation
- If start date arrives but deposits aren't fully paid: **don't start subscription**, wait until paid
- First subscription charge is **skipped** using Stripe `trial_end` (set to start date + one cycle)
- **No automated emails** from our system for deposit collection — just Stripe hosted invoice links
- Reps share payment links manually or via future Workflow automations

## KPI impact

| Event | Cash Collected | MRR |
|---|---|---|
| Deposit instalment paid | +amount (that month) | No change |
| Subscription created (on start date) | No change | +retainer amount |
| Subscription cancelled | No change | -retainer amount |

## Status flow

```
Draft → Sent → Signed → Partial (deposits collecting) → Paid (all deposits in, subscription active)
```

No new statuses needed.

## Database changes

### `proposals` table — new columns:
- `has_deposit` (boolean, default false)
- `deposit_total` (double precision) — locked to one billing cycle amount
- `deposits_paid_total` (double precision, default 0) — running total collected
- `subscription_created_at` (timestamp) — when Stripe subscription was actually created

### `proposal_instalments` table — new column:
- `is_deposit` (boolean, default false) — distinguishes deposit instalments from regular

## Stripe flow

1. **Proposal created** with `hasDeposit: true` + deposit instalments
2. **On send**: Stripe invoices created for each deposit instalment (same as current instalment flow), metadata: `{ proposal_id, instalment_number, is_deposit: "true" }`
3. **Client signs**: NO Checkout Session created. Client directed to pay first deposit invoice.
4. **Each deposit paid** (`invoice.paid` webhook): Update instalment, update `depositsPaidTotal`, proposal → "partial"
5. **Last deposit paid**:
   - If `now >= startDate`: Create Stripe subscription immediately with `trial_end` = start date + one billing cycle
   - If `now < startDate`: Create subscription with `billing_cycle_anchor` = start date and `trial_end` = start date + one cycle
   - Proposal → "paid", `subscriptionCreatedAt` = now
   - MRR increases
6. **Admin override**: "Mark deposit as paid" button triggers same subscription creation logic

## UI changes

### Payment step (proposal creation):
- When `type === "management"` and billing frequency selected: toggle "Collect deposit before start?"
- When on:
  - Deposit total shown (locked = one billing cycle, read-only)
  - "Add deposit payment" to add splits with amount + due date
  - Running total with validation: must equal cycle amount
  - Helper: "This deposit covers the first month of the retainer."
  - Two dates: **Retainer Start Date** + **First Subscription Charge** (auto-calculated)
  - Helper: "Deposits cover the first month. Recurring billing starts [date]."

### Review step:
- Deposit section: each instalment with amount + due date
- Summary: "Client pays $1,000 on May 25 + $1,000 on May 30, retainer starts June 1, first charge July 1"

### Proposal detail slide-over:
- Deposit progress tracker ("1 of 2 deposits paid — $1,000 / $2,000")
- Each deposit instalment with status + Stripe payment link (copyable)
- Admin "Mark as Paid" button on unpaid deposits
- Subscription status: "Pending deposits" → "Active since June 1"

### Public proposal page (client-facing):
- After signing: deposit payment schedule (not Checkout Session)
- Each deposit has Stripe hosted invoice link
- Progress bar: paid vs remaining
- Messaging: "Pay your deposits to get started on [start date]"

## What doesn't change
- Project proposals (unchanged, still use instalments)
- Management proposals without deposits (unchanged, current Checkout flow)
- Single payment proposals (unchanged)
- Existing instalment proposals (unchanged)

## Files to modify
- `lib/db/schema.ts` — add columns
- `app/api/proposals/[id]/send/route.ts` — create deposit invoices for subscription proposals
- `app/api/proposals/[id]/sign/route.ts` — skip Checkout Session when hasDeposit, show first deposit link
- `app/api/stripe/webhook/route.ts` — handle deposit completion → subscription creation
- `components/proposals/proposal-create-modal.tsx` — deposit UI in Payment step
- `components/proposals/proposal-detail-slide-over.tsx` — deposit progress + admin override
- `components/proposals/public/proposal-signing-page.tsx` — deposit payment schedule
- `app/api/proposals/[id]/deposit-paid/route.ts` — new: admin "mark deposit as paid" endpoint
