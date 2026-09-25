# Commission trackers: setter + closer, auto-populated

Created 2026-09-22. Owner: Jack. Status: findings complete, awaiting one decision.

Replaces Kelsey's `Commission_Tracker.xlsx`, which she maintains by hand every month.

## The pay model, taken exactly from her sheet

Read out of the workbook's own formulas, not inferred:

```
Monthly Base Pay                     1500           (typed, per person)
Calls Booked This Month              COUNTA(A13:A111)
Booking Bonus Total                  SUM(E13:E111)          E = IF(company<>"", 25)
Closed Proposals — Total $ Value     SUMIFS(H,I,"Yes")
Proposal Commission Total (5%)       SUM(K13:K111)          K = IF(closed="Yes", amount*0.05)
TOTAL ESTIMATED PAY                  C4 + C6 + C8           base + bonus + commission
```

Columns: Company · Contact Name · Call Booked Date · Free Audit Status · Booking Bonus ($25) ·
Proposal Sent? · Proposal Date · Proposal Amount · Closed? · Close Date · Proposal Commission
(5%) · Sales Rep · Notes. One tab per month, 100 rows pre-formatted.

Her stated structure: **$1,500/month + $25 per booked call + 5% of the proposal amount for every
booked call that CLOSES.**

`users.commission_pct` already exists and is already correct: **Kelsey 5%, Alice 10%, Gage 0.**

## What can be auto-populated, measured not guessed

### The closer tracker: essentially free
`proposals` holds 87 rows, 86 sent, 27 paid, and **100% carry `created_by`**. It already has
`total_amount`, `sent_at`, `paid_at`, `lost_at`, `closed_by`, `contact_name`, `ghl_contact_id`,
`opportunity_id`, `signed_at`, `status`. Every column of the sheet's money half maps directly.
By creator: Gage 69 proposals (25 closed), Alice 18 (2 closed).

### The setter tracker: blocked on one thing
Everything except **which booked calls are hers**.

The plan of 2026-08-14 proposed reading GHL's `createdBy.userId` on the appointment. Measured
today across all 17 calendars, last 45 days:

```
110 appointments created by:
   75  booking_widget        (68%)  the PROSPECT booked themselves. No user id exists.
   28  google_calendar       (25%)  synced in. No user id.
    7  contactdetails_page   ( 6%)  a GHL user booked it manually. Has a user id.
```

So `createdBy.userId` is present on **7 of 110**. The column `calls.booked_by_ghl_user_id`
already exists and is populated on **46 of 1,008** rows; Kelsey has **4 all time**, against the
15 she logged in August alone. That approach cannot work, because in two thirds of cases no
human booked the call: the lead booked itself off a link after the setter warmed it up.

### The signals that DO exist
| Signal | Coverage | Verdict |
|---|---|---|
| `local_opportunities.assigned_to` | **2,953 of 3,846 live (77%). Kelsey owns 778.** | Best available |
| `calls.rep_email` (who attended) | Kelsey 260 calls in August | Her dials, not her bookings |
| `local_conversations.last_responder_user_id` | 84 of 1,867 (4.5%), Kelsey 6 | Too sparse |
| `activity_events` by user | Gage dominates; Kelsey barely appears | She works in GHL, not here |
| `calls.booked_by_ghl_user_id` | 46 of 1,008 | Only the 6% manual path |

## THE DECISION (only Jack can make it)

How a booked call gets credited to a setter:

- **A. Opportunity owner.** A booked call on an opportunity Kelsey owns counts as hers. Works
  today, no behaviour change, 77% coverage, 778 opportunities already hers. Misattributes when
  ownership is stale or a lead was passed along.
- **B. Process change.** Setters book from the GHL contact-details page instead of sending a
  link. 100% accurate going forward, nothing retroactive, and it is a habit change for Kelsey.
- **C. Claim-it.** The tracker lists every booked call in the period and the setter ticks the
  ones that are hers. 100% accurate, ~15 ticks a month against a whole spreadsheet, and the
  ticks become training data for A.

Recommendation: **A as the default, C as the correction affordance, B offered as a nudge.** The
tracker should never silently guess: a row credited by rule shows how it was credited, and a
wrong one can be reassigned in a click.

## Shape

Two trackers, one shared spine, `/tracker` (plus an admin view of everyone's).

- **Setter:** rows = booked calls in the month. Columns mirror her sheet. Pay summary card:
  base, calls booked, booking bonus, closed $ value, commission, total estimated pay.
- **Closer:** rows = proposals in the month. Pay summary: base, proposals sent, closed count,
  closed $ value, commission at their own `commission_pct`, total.
- **Month switcher**, because her workbook is one tab per month.
- **Every derived number states its source** on hover: this is someone's pay, and a number they
  cannot trace is a number they will not trust.
- Base pay is per-person config (admin-editable), the one value the sheet also types by hand.

## Open questions beyond the decision above

- [ ] Base pay per person: Kelsey is $1,500. What are Alice's and Taylor's?
- [ ] Is 5% of the proposal amount paid on the FULL contract value or the first payment?
      The sheet says amount x 0.05 with no qualifier; management fees and deposits exist in
      `proposals`, so this needs to be exact before anyone is paid from it.
- [ ] "Closed" in her sheet vs `paid_at` in ours: does a signed-but-unpaid proposal count?
      Her sheet has a Pending state, which suggests signed-not-yet-paid.
- [ ] Does the setter earn commission on a proposal closed by someone else on their booked
      call? Her sheet says yes (that is the whole 5% line). Confirm.

## Build constraints
- Untitled UI components for the table, modals and summary cards, per Jack 2026-09-22.
  Verify the license and install path before adding the dependency; the repo currently uses
  shadcn + Watermelon UI.
- Gates: shape (this) → craft → polish → harden, plus a security pass (pay data is sensitive:
  a setter must never see another rep's earnings).

## Decisions from Jack, 2026-09-25 (setter half)

1. **Attribution: automate, with a manual override.** The tracker fills itself (tracked link
   credit first, opportunity owner as the fallback), and the rep can add a row the system
   missed or correct one it got wrong, the way they edit Kelsey's sheet today. Target is
   "automate 99%, editable for the rest".
2. **Commission basis stays an admin setting.** Full value vs first payment is already the
   `commission_settings.payout_timing` toggle (full_paid / first_instalment / split). The setter
   tracker reads the same toggle, so both halves always agree.
3. **Percentages are editable.** Admin can set them, and each rep has a place to set their own.
4. **The setter always earns on a call they booked that someone else closes.** That is the
   role: a setter books for a closer.
5. **A cancelled booking loses its credit, visibly.** The row stays on the sheet, marked
   cancelled with the date, and the bonus shows as removed, so the rep sees exactly why the
   total went down.
6. **The rate belongs to the month, like the sheet.** Kelsey's workbook has one tab per month
   with the rate typed at the top. So a rate is edited on the month being viewed and changes
   that month only. A new month starts with the previous month's values. Past months never
   move when a later month is edited.
7. **Reps edit all three month numbers, visibly.** Base pay, per-booking bonus and commission %
   are editable by the rep on their own month. Every edited value carries an "edited by X, date"
   marker, and admin can see it and correct it.
8. **Manual rows count immediately, clashes are flagged.** A rep's added or removed row counts
   straight away and is marked "Added by X". If two people claim the same booking, both rows
   show "Also claimed by Y" and admin decides which stands. One call can never pay twice unseen.
9. **The $25 is for a call that happened.** A cancellation OR a no-show removes the bonus,
   shown on the row with its badge. A reschedule is still one booking, paid once.

## Jack, 2026-09-25: "100% accuracy. 98 is not good enough, 99 is not good enough."

Every variable in Kelsey's sheet is kept and every one stays editable, but auto-filled.
Header: Monthly Base Pay · Calls Booked · Booking Bonus (calls x $25) · Closed Proposals $ ·
Proposal Commission (5%) · TOTAL ESTIMATED PAY. Columns: Company · Contact Name · Call Booked
Date · Free Audit Status · Booking Bonus ($25) · Proposal Sent? · Proposal Date · Proposal
Amount · Closed? · Close Date · Proposal Commission · Sales Rep · Notes.

### Measured 2026-09-25: what the data can prove today
- GHL appointment status: 194 "confirmed", 28 "completed", **0 showed, 0 noshow** in 90 days.
  Nobody marks attendance in GHL, so it cannot decide a no-show.
- `call_dispositions` (the in-app outcome log) covers 37 of 64 past September sales calls,
  45 of 69 in August. It is the only real show/no-show signal, and it has gaps.
- `booking_links`: 0 rows. Opportunity owner is the only fallback, and it is a guess (~77%).
- Duration and Meet conference id are present on every call: they are the SCHEDULED meeting,
  not proof of attendance, so they cannot be used as evidence.

### Consequence: 100% accurate means never guessing
A row is either PROVEN by data or CONFIRMED by a human in one click. Anything else is shown
as unresolved ("Awaiting outcome", "Confirm this is yours") and does not count toward pay
until resolved. The total can be incomplete for a few days; it can never be wrong.

### Conflict with the sheet
Kelsey's August pays $25 on two rows she marked "No-showed" (Papier Doll Factory, Mirabilia
Darline). Jack's rule removes that: August would read $1,825, not $1,875. Tell her first.

### Resolved 2026-09-25 (Jack, with Gage in Slack)
10. **Unproven rows are nudged to whoever owns the gap.** The closer who ran the call gets a
    one-click "did X show?" (writes the existing `call_dispositions` log). The setter gets
    "is this yours?" on suspected bookings. Pending rows do not count toward pay.
11. **No-show rule, Gage's wording:** "flag it and confirm they no showed so we can deduct,
    but if they reschedule / rebook then it gets added back as long as they show up."
    - RESCHEDULE = same GHL appointment id, new time. Sync upserts on `ghlappt_<id>`, so it
      is one row, one booking, one $25 by construction.
    - REBOOK = a no-show then a NEW appointment. Credit follows the PROSPECT (GHL contact),
      not the appointment. The no-show row stays open ("No-show, waiting for rebook") and
      is never dropped; if the same contact books again and shows, the $25 returns to the
      ORIGINAL setter, whoever rebooked. Closes as "No-show, never rebooked" when the
      opportunity is lost. Measured: 42 no-show contacts, 12 rebooked, 4 later showed.
12. **A restored $25 lands in the month the prospect shows**, labelled with the original
    booking date. Past months are final once over; nothing reopens after payday.
13. **Closer tracker gets the same treatment** (Jack: "same with the closer"): per-month
    editable base pay and %, cell overrides with markers, notes.
14. Commission basis (full / first instalment / split) stays the one admin toggle for both.
