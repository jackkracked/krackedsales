# Proposal status model (management 90-day terms)

## The problem, in production data

Two spread proposals in the identical situation carry different statuses:

```
paid     | management | spread | firstMonthComplete=true   <- Dan Bruxer
partial  | management | spread | firstMonthComplete=true   <- Tofu Go
```

Same product, same stage, first month collected on both. One was marked `paid` by the
`invoice.paid` webhook's customer+amount fallback (a $1,500 invoice matching a $1,500 monthly
`totalAmount`), the other stayed `partial` from the fulfilment logic. The status field is being
written by two systems that disagree.

Separately, "partial" is simply wrong for a client who has paid month 1 of 3 on time. Jack cannot
look at the proposals screen and tell who is actually paying.

## Decisions (Jack, 2026-08-13)

- Commission is OUT OF SCOPE. It becomes its own feature later. Do not design around it, but do
  not silently change when `proposal.paid` fires either — flag it if the trigger point moves.
- Renewals happen by GAGE EXTENDING THE SUBSCRIPTION IN STRIPE, not by creating a new proposal.
- Existing rows ARE to be reclassified.

## The model

Do NOT encode progress in the status (`paid 2 of 3`). It explodes the enum, breaks every
dashboard/KPI that groups by status, and still fails the key case: "3 of 3" cannot distinguish a
finished client from one Gage just upsold. Serious billing platforms (Stripe, Chargebee, Recurly,
Salesforce/HubSpot CPQ) all separate DEAL STATE from COLLECTION PROGRESS. So:

**Status follows the SUBSCRIPTION. The term is progress inside it.**

| Status      | Means                                          | Derived from |
|-------------|------------------------------------------------|--------------|
| `sent`      | Out, not signed                                | send |
| `signed`    | Signed, no money yet                           | signature |
| `partial`   | First month NOT fully collected (split outstanding) | `firstMonthComplete = false` + money started |
| `active`    | They have paid; term running OR extended       | live subscription in the mirror |
| `completed` | Term finished AND nothing follows              | subscription canceled + all contracted payments collected |
| `past_due`  | A scheduled payment failed                     | Stripe subscription status |

`partial` now means exactly what Jack described: only the split case, genuinely part-paid.

### Why derived from the mirror, not from `autoRebillMode`
Because renewals happen in Stripe. A proposal signed with `autoRebillMode: "none"` that Gage later
extends in Stripe would otherwise sit in the app as `completed` while the client is still being
billed. `autoRebillMode` records INTENT AT SIGNING; the subscription records TRUTH. Read
`local_stripe_subscriptions` (already synced by `lib/stripe/sync.ts`, guarded by the watchdog) so
the proposals screen costs no extra Stripe calls.

### The progress badge (derived, never stored as status)
```
Term 1 · 2 of 3 · $3,000 of $4,500      mid-term
Term 1 · 3 of 3 · rolling monthly       upsold, still active
Term 1 · 3 of 3 · completed             finished, nothing follows
```
Source: the frozen `schedule_snapshot` for the expected rows, paid invoices for the collected
count. Both already exist.

## READER AUDIT RESULTS (2026-08-13) — read before changing any writer

`proposals.status` is `text` with default `"draft"` and **no DB enum or check constraint**
(`lib/db/schema.ts:647`), so new values will NOT be rejected at the database layer. Nothing
protects you. No raw SQL touches it; every read is Drizzle or in-JS.

### RESOLVED (Jack, 2026-08-13): YES — `active` and `completed` still stamp `paidAt`.

`paidAt` keeps its current meaning: **the deal converted to cash.** It is stamped ONCE, at the
moment the first full month is collected (the same moment status becomes `active`), and is then
PRESERVED through `completed`. Never re-stamped, never cleared.

Consequences, all good:
- **Commission timing does not change.** Today a spread proposal is already marked paid at month 1
  by the webhook (that is how Dan Bruxer ended up `paid`), so `proposal.paid` already fires then.
  Stamping `paidAt` at `active` keeps that exact behaviour. The concern about commission silently
  moving to month 3 is therefore RESOLVED — it does not move.
- Everything keyed on `paidAt` keeps working untouched: `lib/kpi/rep-proposal-commission.ts`,
  `lib/unit-economics/clients.ts:34`, `app/api/dashboard/goal-progress/route.ts:85`,
  `app/api/dashboard/kpis/route.ts:185-187`.
- The outstanding-value reconstruction (`kpis/metrics:264,278`, `kpis/detail:515`) drops the
  proposal out of Outstanding at first payment, which is correct, and finished terms do NOT get
  stranded in Outstanding forever.
- `components/proposals/proposals-client.tsx:85` (`paidSoFar`) already falls back to `p.paidAt`,
  so the list's collected column keeps showing a value rather than $0.

Direct consequence for the code: the idempotency guard in `maybeCompleteProposal`
(`ninety-day-fulfillment.ts:586`) must STOP testing `status === "paid"`. With `paidAt` stamped at
`active`, the correct terminal guard is `status === "completed"` (has the term already been closed
out?), and the `proposal.paid` dispatch must be gated on the FIRST-PAYMENT transition, not on the
completion transition, or it will either double-fire or never fire.

### (original framing, kept for context) does `active`/`completed` still stamp `paidAt`?

Commission (`lib/kpi/rep-proposal-commission.ts`), new-client acquisition
(`lib/unit-economics/clients.ts:34`), deals-closed (`app/api/dashboard/goal-progress/route.ts:85`)
and the outstanding-balance reconstruction (`app/api/kpis/metrics/route.ts:264,278`,
`app/api/kpis/detail/route.ts:515`) are all keyed on `paidAt`, NOT on status. They are safe if and
only if `paidAt` keeps its meaning. **If `completed` does not stamp `paidAt`, every finished
90-day term stays in "Proposal Value Outstanding" forever.** Decide this first; everything else
follows from it.

### CRITICAL — silent money failures
1. `lib/proposals/ninety-day-fulfillment.ts:202` — the nightly self-heal sweep selects
   `inArray(status, ["signed","partial"])` to rebuild a missing `ninety_day_splits` ledger. A
   spread deal in `active` is INVISIBLE to it, so if the sign/webhook path ever crashed before
   creating the ledger, **months 2 and 3 are never scheduled and never charged**, silently and
   permanently. This is the exact failure the sweep exists to catch. Add the new values.
2. `lib/proposals/ninety-day-fulfillment.ts:586` (`maybeCompleteProposal`) — the idempotency guard
   returns early only when status is already the literal `"paid"`. If the terminal value becomes
   `completed`, **`proposal.paid` re-fires on every cron tick**: duplicate commission, duplicate
   Slack, duplicate onboarding. This function is also the natural place to emit `completed`, so it
   must be changed carefully, not incidentally.

### HIGH — status gets clobbered or money numbers move
3. `app/api/stripe/webhook/route.ts:482` — `invoice.payment_failed` writes `failed` unless status
   is `paid` or `signed`. An `active` retainer with one declined card flips the whole proposal to
   `failed`. Add `active`/`completed` to that NOT-list.
4. `app/api/stripe/webhook/route.ts:333,351,368` — `invoice.paid` updates to `paid` guarded only by
   `ne(status,"paid")`, so a later invoice on a live retainer overwrites `active` → `paid`.
5. `app/api/contacts/[id]/proposals/route.ts:47-50` — contact LTV and paid-count test
   `status === "paid"` only. **Every spread client's LTV drops to $0** in the contact drawer.
6. `lib/analytics/ad-efficiency.ts:99` — won-client universe is
   `inArray(status,["paid","partial","signed"])`; new values vanish, so cohort revenue is dropped
   or mis-bucketed with no error.
7. `app/api/contacts/route.ts:399-402` — `statusPriority` map with `?? 0` fallback; a paying
   retainer ranks BELOW a stale draft and the contact row displays "draft".
8. `app/api/proposals/[id]/lost/route.ts:49` — only blocks re-marking when already `lost`, so an
   `active` or `completed` proposal can be marked lost, **voiding real Stripe invoices**. The UI
   offers it too (`proposal-detail-slide-over.tsx:976`).
9. `app/api/proposals/[id]/instalments/[instId]/route.ts:38` — recomputes the parent as
   `paid|partial|signed`, clobbering the new vocabulary.

### MEDIUM / UI
10. `components/proposals/proposal-status-badge.tsx:20` — there is ALREADY a shim:
    `isActiveRetainer = management && status === "partial"` relabels the badge to "Active". **This
    hack must die in the same change**, or a first-month-uncollected deal still shows "Active".
    Unknown values fall back to a grey unstyled pill showing the raw lowercase word (`:22`).
11. `components/proposals/proposals-client.tsx:57,418-434` — no Active/Completed filter tabs, and
    the counts strip (`paid`, `partial`, `outstanding`) will visibly collapse as spread deals move
    to the new values. `paidSoFar()` at `:85` shows **$0 collected** without `paidAt`.
12. `components/proposals/public/proposal-signing-page.tsx:2144-2153` — CUSTOMER-FACING. Unknown
    status renders *"Unavailable — This proposal is not currently available."* A paying client
    reopening their link sees that. Note `partial` and `lost` are already missing from this map.
13. `lib/kpi/engine/datasets/proposals.ts:44-56` — the KPI configurator's `enumValues`. Any SAVED
    KPI config filtering `status in (paid, partial)` silently returns 0 and overrides the legacy
    compute in the metrics overlay.
14. Grey/blank badge fallbacks: `contact-modal.tsx:851`, `contacts-client.tsx:988`.
15. `proposal-detail-slide-over.tsx:154` vs `:919` already contradict each other on "Mark Paid".

### Confirmed SAFE (do not spend time here)
`rep-proposal-commission.ts`, `dashboard/goal-progress`, `dashboard/kpis:169-187`,
`kpis/business:77`, `cron/reconcile-prepaid-terms` (filters on type/autoRenew, not status),
**the 90-day charge cron `ninety-day-fulfillment.ts:441+` (recurring charging is NOT gated on
proposal status, so months 2/3 keep billing regardless)**, `lib/call-prep/*`, reminders store.

### Do NOT confuse with proposal status
`customers.status` (`active|inactive`), `localStripeSubscriptions.status`
(`active|canceled|past_due`), `proposalInstalments.status`, workflow-run `partial`
(`lib/workflows/executor.ts:212`), and especially **`projectStatuses.status` (`'active'|'complete'`)
which is JOINED against `proposals` in the same queries** at `kpis/detail:456` and
`kpis/metrics:390`. That last one is the most likely thing to be misread during this change.

### Only client-writable path
`app/api/proposals/[id]/route.ts:42` — `ALLOWED_STATUS_VALUES = new Set(["void","paid"])`.
`active`/`completed` are rejected there today.

### Test fixtures that will fail
`scripts/stripe-test/prove-integration.ts:75,86,127,148` assert `status === "paid"`/`"partial"`.

## Work

- [x] **`lib/proposals/status.ts` BUILT.** Pure `deriveProposalStatus()` — no DB, no Stripe, no
      clock. Proof: `scripts/prove-proposal-status.ts`, 22 assertions, 0 failures.
      Run: `./node_modules/.bin/tsx scripts/prove-proposal-status.ts`
      It is NOT WIRED IN ANYWHERE YET, so it currently changes no behaviour. Key properties:
      - Only re-classifies `type=management` + `managementOption=spread`. Everything else
        (projects, instalments, upfront, legacy retainers) is returned EXACTLY as stored, with
        `derived: false`. This is what keeps the ~15 audited call sites unaffected for them.
      - Never overwrites a human decision or a pre-sale state: draft/sent/lost/void/cancelled/
        expired pass straight through.
      - `completed` requires BOTH the full term collected AND the subscription canceled. A missing
        mirror record falls back to `active`, NEVER `completed`, so a mirror gap cannot silently
        declare a live retainer finished.
      - `3 of 3` with a still-active subscription stays `active` — this is the Gage-upsold case.
      - `past_due` outranks everything else.
      - Progress is returned as data (`{collected, expected, amountCollected, amountExpected,
        label}`), never encoded in the status.
- [ ] Stop `invoice.paid` writing `status: "paid"` on 90-day spread proposals. This is the
      webhook bug that produced the incoherence above. Also fix the dead correlation branch
      (`app/api/stripe/webhook/route.ts:338` reads `Invoice.subscription`, removed from the
      pinned `2026-04-22.dahlia` API; `lib/stripe/sync.ts:115` already reads
      `parent.subscription_details.subscription`). NOTE: fixing that branch ALONE makes things
      worse — it would start matching spread invoices and marking them paid more reliably. The
      two changes must land together.
- [x] **UI CRAFT DONE** (shape brief confirmed by Jack: counter INSIDE the pill; Active and
      Completed both get their own filter tabs).
      - `proposal-status-badge.tsx` — REWRITTEN. The `management && partial -> "Active"` shim is
        GONE. New states: `active` teal (the colour the shim already used, so the team's visual
        memory is preserved), `completed` slate (terminal, least visual weight), `past_due` red
        (same read as `failed`: money didn't arrive). Counter renders inside the pill for
        active/partial/past_due only — "COMPLETED 3/3" restates the word. Tabular-nums so a
        variable-width pill still scans down a list. `past_due` humanised so CSS uppercase does
        not render "PAST_DUE".
      - `proposals-client.tsx` — Active + Completed filter tabs; counts strip no longer drops
        spread deals (`active`/`past_due` count as outstanding, `completed` counts with paid);
        `paidSoFar` uses WON_STATUSES so an active retainer stops reporting $0 collected.
      - `proposal-signing-page.tsx` — CUSTOMER-FACING FIX. `active`/`completed`/`partial`/
        `past_due`/`lost` added to the status screen map. A paying client reopening their link no
        longer sees "Unavailable — This proposal is not currently available."
      - `proposal-detail-slide-over.tsx` — full progress line with the money figure
        ("2 of 3 collected · $3,000 of $4,500"), which is why the list pill carries only the
        counter. Mark-Paid and Mark-Lost gates aligned and both now refuse `active`/`completed`
        (the lost route rejects it server-side too).
      - `contact-modal.tsx` / `contacts-client.tsx` — new states styled; previously a paying
        client fell back to the DRAFT grey style and a dead grey dot.
- [ ] **NOT YET WIRED.** `termProgress` is declared as an optional field on the slide-over's
      Proposal interface and the UI renders nothing until the API supplies it. Nothing writes
      `active`/`completed` yet, so all of the above is still inert in production. The wiring step
      (API returns derived status + termProgress from `lib/proposals/status.ts`) is what turns it
      on, and it must come AFTER the `invoice.paid` webhook change.
- [ ] `/impeccable polish` then `/impeccable harden` on the above once it is wired and visible.
- [ ] Backfill to reclassify existing rows (Jack approved). Dry-run first, print the before/after
      for every row, and only commit on his say-so.
- [ ] Verify: no dashboard/KPI/Slack/filter groups by a status whose meaning shifts. `active`,
      `completed` and `past_due` are already in the codebase vocabulary (71 / 27 / 5 usages), so
      check what already consumes them before reusing.

## Risks
- Status is consumed widely. Enumerate every reader BEFORE changing writers.
- `dispatchWorkflowEvent("proposal.paid")` currently fires on the `paid` transition. If `paid`
  becomes `completed` at term end, that event moves. Commission is out of scope, but the event
  must not silently change timing without Jack knowing.
- The mirror must be fresh enough to drive UI status. Confirm sync cadence and the fallback when
  a subscription is missing from the mirror (fail to the stored status, never to `completed`).
