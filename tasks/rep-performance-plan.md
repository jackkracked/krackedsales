# Rep performance: role-based metrics, commissions, attribution

**Written 2026-08-14. Findings verified against production, not assumed.**

## FINDINGS FIRST — one changes the brief

### The zeros are CORRECT. Attribution is not broken.
```
demo boards since 2026-08-07 : 19
  ... with a rep attributed  : 19
  ... demo.created events    : 19
  ... all of them            : Gage
```
Every demo created since tracking began was recorded and attributed. **Kelsey and Alice have not
submitted a demo through the system in that window.** The zero is behavioural, not technical. (6
older boards pre-date attribution and carry no rep — nothing can recover those.)

One real fragility worth fixing anyway: `app/api/webhooks/demo/route.ts` wraps the logging in
`if (actor)`. If `getSessionUser()` ever fails, the demo still succeeds but the rep silently loses
credit. It should log an unattributed event rather than nothing.

### Roles already exist and are already correct
`users.role`: Alice = `closer`, Kelsey = `setter`, Gage = `admin`. Nothing to add — the
leaderboard simply ignores the field and shows everyone the same five columns.

### "Calls booked" cannot be computed today
`calls` has `rep_email` (who ATTENDED) but no record of who BOOKED. Kelsey books for Gage and
Alice, so today her work lands on their row and she gets nothing.

The data exists in GHL: appointments carry `createdBy: { source, userId }`, already documented in
`scripts/backfill-call-rep.mjs` as "booked in GHL, ATTRIBUTABLE". It is simply never stored.
**A `booked_by_ghl_user_id` column on `calls`, populated at sync, unlocks the whole setter side —
and can be backfilled from GHL history.**

### Current metrics (all in `app/api/dashboard/rep-performance/route.ts`)
| Metric | Source |
|---|---|
| Calls | `calls` by `rep_email` — works (Kelsey 306, Gage 275, Alice 126) |
| Proposals sent | `proposals.createdBy` + `sentAt` |
| Deals closed + $ | `proposals.createdBy` + `paidAt` |
| Demos | `activity_events` action=`demo.created` |
| Open leads | opportunity mirror by `ghlUserId` |

Everything is keyed on `createdBy`, which is why the attribution override below is needed.

## THE METRIC SPLIT (the research Jack asked for)

A setter creates qualified pipeline; a closer converts it to revenue. They should never be ranked
on the same number, because the setter cannot control close rate and the closer cannot control
dial volume.

### Setter (Kelsey) — judged on volume and quality of opportunities created
| Metric | Available? |
|---|---|
| Calls made | YES — `calls` by rep_email |
| **Calls booked** (for closers) | NO — needs `booked_by_ghl_user_id` |
| Demos created | YES — `demo.created` events |
| Show rate (booked → attended) | derived, once booked_by exists |
| Booked → closed conversion | derived; credits the setter for quality, not just volume |

Headline for a setter: **calls booked.** Show rate is the quality guard — it stops someone
booking junk to inflate the number.

### Closer (Alice, Gage) — judged on conversion and revenue
| Metric | Available? |
|---|---|
| Calls taken | YES |
| Proposals sent | YES |
| Deals closed | YES |
| Revenue closed ($) | YES |
| Close rate (proposals → closed) | derived |
| Average deal size | derived |

Headline for a closer: **revenue closed**, with close rate beside it so a big month on few deals
reads differently from a grind.

Gage is `admin` but works as a closer — the UI should let an admin appear in the closer table
rather than needing a role change.

## COMMISSIONS

Per-user percentage, editable in Settings. Kelsey 5%, Alice 10% as the starting values.
- Setter commission: on revenue from deals traceable to calls THEY booked.
- Closer commission: on revenue from deals THEY closed (see attribution below).
- Store the RATE on the user, and compute the amount — never store the amount, or a rate change
  silently rewrites history. If historic rates ever need to differ, that is a rate-effective-from
  table, not a mutable field.

Note `lib/kpi/rep-proposal-commission.ts` already exists and keys off `paidAt` — check it before
building a second commission path. Two sources of truth for money is the exact pattern behind the
90-day billing failure.

## ATTRIBUTION OVERRIDE

Jack's case: Tofu Go was Alice's deal, but Gage sent the proposal because she was tied up. Today
the leaderboard credits Gage, because everything keys on `proposals.createdBy`.

Add `proposals.closed_by` (nullable, FK to users):
- `NULL` means "same as createdBy" — no backfill, no behaviour change for existing rows.
- The leaderboard's closed/revenue/commission metrics read `COALESCE(closed_by, created_by)`.
- `createdBy` stays untouched as the audit trail of who actually built it.
- Editable from the proposal detail slide-over and/or the customers page.

## WORK

- [ ] `calls.booked_by_ghl_user_id` + populate at sync from the appointment's `createdBy.userId`;
      backfill from GHL history.
- [ ] `proposals.closed_by` + an editor in the proposal slide-over.
- [ ] `users.commission_pct` + a Settings control (admin only).
- [ ] Split the leaderboard by role: setter table, closer table, each with its own columns.
      Admin appears under closers.
- [ ] Derived metrics: show rate, close rate, average deal size, commission earned.
- [ ] Fix the `if (actor)` gap in the demo webhook so attribution can never silently vanish.

## ANSWERED BY JACK (2026-08-14)

1. **Setter commission** — 5% of revenue from deals whose call THEY booked. Confirmed. Requires
   the full chain: call (booked_by) → contact/opportunity → proposal. Building the column is step
   one; joining the chain is the real work.
2. **Alice only closes.** So one role per person is fine for now. Do NOT hard-code that
   assumption — Gage is `admin` and works as a closer, so the UI must already handle "which table
   does this person belong in" independently of the raw role string.
3. **Commission is earned ON SIGNATURE — for now, and it MUST be changeable.**

   Jack's own reasoning, which the design has to accommodate: if a 90-day spread client pays
   every 30 days, the rep will probably earn three lots of commission; if the same client pays
   upfront, one lot. That is a *per-payment* basis, not a per-signature one, and he expects to
   switch once he has agreed it with Gage.

   So the basis is a SETTING, not a rule in code:
   ```
   commission_basis = "on_signature"   (current) | "on_payment"
   ```
   - `on_signature` — one commission per deal, calculated from the full contract value at signature.
   - `on_payment`   — a commission per payment received, calculated from each payment's amount.
     A 90-day spread paid monthly yields three; paid upfront, one. This falls out naturally
     because it keys on payments, not on the deal.

   **Build both from the start.** Retro-fitting per-payment onto a signature-only implementation
   means recomputing history, and the payment records needed for `on_payment` are already there
   (Stripe invoices + `proposals.paidAt`). Writing the calculation against a payment list, then
   treating "signature" as the single-payment case, costs little now and nothing later.

   Storing the RATE and computing the amount (see above) is what makes the switch safe: flipping
   the basis recomputes cleanly instead of stranding historic rows on the old rule.
