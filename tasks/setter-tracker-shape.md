# Pay Tracker v2: setter half + editable months, shape brief

Created 2026-09-25. Status: AWAITING JACK'S CONFIRMATION. No code until confirmed.
Requirements: `tasks/commission-tracker-plan.md` decisions 1 to 14. Extends the shipped closer
view (`tasks/closer-tracker-shape.md`); same visual world, same `/tracker` route.

## 1. Job and audience
Kelsey (setter) and Alice (closer) open it on the 1st and on any day a number looks off. Jack and
Gage open it to check anyone's month and settle disputes. Mode: Operate. The job is "is my pay
right, and if it isn't, fix it in one click", replacing the hand-kept workbook.

## 2. Outcome and proof
Success: Kelsey stops maintaining the spreadsheet, and nobody asks "why did my number go down".
Product truth no template has: **every dollar is either proven, confirmed by a person, or
visibly pending. Nothing is guessed.** The total can be incomplete for a few days; never wrong.

## 3. Direction: a ledger that shows its working
Thesis: the sheet people trust, with the arithmetic written out. Three layers, top to bottom.

**A. The answer, with its working.** The existing total panel, plus one reconciliation line
under it. This is the focal moment and the answer to "why did it go down":

```
TOTAL ESTIMATED PAY            $1,825
Confirmed. $75 more pending on 3 calls.

15 booked  −1 cancelled  −2 no-show  +1 restored  = 13 counted × $25 = $325
```

Pending money is NEVER inside the total. It sits beside it, labelled, so the headline figure is
only ever money that is certain.

Supporting figures, all three header inputs editable in place (decisions 6 and 7):
`Base pay $1,500 ✎` · `Booking bonus 13 × $25 ✎` · `Closed value $4,500` · `Commission 5% ✎ $225`.
Click a value, type, Enter. Helper under the field: "Applies to September only". An edited value
carries a quiet marker, "Edited by Kelsey, 3 Oct", on hover and in admin view.

**B. Needs you.** A single strip between the answer and the table, shown only when there is
something to do, counting only the viewer's own actions:

- Setter: "2 bookings to confirm are yours"
- Closer: "3 calls need an outcome: did they show?"
- Admin: "1 booking claimed by two people"

Clicking it filters the table to those rows, and each row resolves inline in one click
(Yes / No-show / Not mine). The same items also go out as one daily Slack DM through the existing
rep-reminder path, so a gap cannot sit unseen. This is how "never guess" stays cheap.

**C. The rows: every column of Kelsey's sheet, grouped so it fits.** The 13 columns become 8
grouped columns; no variable is dropped.

| Prospect | Booked | Call | Bonus | Proposal | Commission | Closer | Notes |
|---|---|---|---|---|---|---|---|
| Company, contact under | date, source under | date + outcome badge | $25 / struck / pending | sent date · amount · status | amount or — | name | editable text |

- *Company, Contact Name* → Prospect. *Call Booked Date* → Booked. *Free Audit Status* → Call
  outcome badge. *Booking Bonus* → Bonus. *Proposal Sent?, Proposal Date, Proposal Amount,
  Closed?, Close Date* → Proposal (one cell, status badge Sent / Signed / Closed / Lost / none).
  *Proposal Commission* → Commission. *Sales Rep* → Closer. *Notes* → Notes.
- Source under the booked date says how the row got there: "Tracked link", "Booked in app",
  "Confirmed by you", "Added by you". The reason a row exists is always one glance away.
- Every auto-filled cell can be overridden. An overridden cell shows a small marker and the
  original value on hover, so a correction never hides the data it replaced.

Row states (the entire vocabulary, no others):

| State | Bonus cell | Row treatment |
|---|---|---|
| Counted | $25 | normal |
| Awaiting outcome | "pending" | muted, action inline |
| Confirm it's yours | "pending" | muted, Yes / Not mine inline |
| No-show, waiting for rebook | ~~$25~~ −$25 | muted, stays until rebooked or lost |
| Cancelled | ~~$25~~ −$25, "Cancelled 14 Sep" | muted |
| Restored | +$25, "booked 13 Aug" | normal, lands in the month they showed |
| No-show, never rebooked | ~~$25~~ | muted, closed out |
| Also claimed by X | "pending" | warning badge, admin decides |

"Add a booking" (top right of the table) opens a contact search, picks the appointment, and the
row appears marked "Added by you". Clashes are detected on insert, not later.

**Closer view:** same header editing (base pay, %) and notes, plus the Needs-you strip for call
outcomes. The existing deals table stays as it is.

## 4. Scope and boundaries
- In: setter view, editable month header for both roles, overrides and notes, manual add,
  nudges (in-page and Slack DM), no-show/cancel/rebook lifecycle, admin clash resolution,
  switching the tracker on for setters.
- Untouched: Money page, KPI definitions, the commission engine's maths (the tracker reads it),
  the booked-calls KPI.
- Anti-goals: no charts, no gamification, no leaderboard. It is someone's wages.

## 5. States and ranges
- Rows: 0 to about 100 per setter-month (her sheet pre-formats 100). Closer: 0 to about 30.
- Empty month: "No bookings in September yet" with the Add a booking action.
- Current month: "in progress, figures will keep moving" (as shipped).
- **Past months are final.** Read-only for reps once the month is over; admin can still correct,
  and every admin correction is marked. (Follows decision 12.)
- Error, loading: as shipped. Long company names truncate with the full name on hover.
- Base pay not set: "Not set" (as shipped), now fixable in place.

## 6. Interaction and layout
- Desktop 1100px max as shipped. Grouped columns keep the table within the width.
- Under 768px the table becomes stacked row cards: prospect and bonus on the first line, call
  and proposal on the second, actions full width.
- Inline edits are optimistic with a rollback on error, and a toast only on failure.
- Keyboard: every inline action is reachable; Enter saves, Esc cancels.

## 7. Constraints and decisions a builder must not invent
- Security: a rep reads and writes only their own month; enforced on the session. Admin writes
  are logged with who and when. Gate 5 and Gate 6 apply (new write routes, new tables).
- Data: new tables for month settings, row overrides and manual rows, all additive, idempotent
  migrations. Nothing existing is rewritten.
- Stack: Untitled UI table and badges (already installed), React Query, existing Slack DM path.
