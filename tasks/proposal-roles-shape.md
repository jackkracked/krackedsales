# Closer and setter on proposals: shape brief

Created 2026-09-29. Status: CONFIRMED by Jack 2026-09-29 ("yes, go ahead") with the revisions below. Revisions SUPERSEDE the original direction.
Requirements: tasks/proposal-roles-plan.md. Extends the existing proposals world (list + detail slide-over).

## Job and audience
Jack and Gage (admins) set who earns on a deal in seconds, and trust every pay figure downstream. Reps
open a proposal and see who is credited. Mode: Operate.

## Direction: credit is a fact about the deal, stated where the deal is
**Detail slide-over:** a "Credit" row directly under the Created / Sent / Signed timeline, as two cells:

  CLOSER                          SETTER
  (AG) Alice Galperin             (KF) Kelsey Folcarelli
  Suggested · created it  [✓]     Suggested · booked the call 20 Aug  [✓]

- Each cell names the person and WHY they were suggested, in plain words ("created it", "booked the
  call 20 Aug", "no booking found").
- Admin: [✓] confirms in one click. Clicking the name opens a short picker: the team (setters first
  for Setter, closers first for Closer), plus "No setter". Picking confirms at the same time.
- Confirmed cells drop the "Suggested" chip and read "Set by Jack · 29 Sep". No colour noise: a
  suggestion is a quiet dotted underline plus the chip, confirmed is plain text.
- Reps see the same row, read-only.

**List:** the existing "Rep" column becomes "Closer · Setter" (two short names stacked, a small dot on
any still suggested). Admins get one filter chip, "Credit to confirm (N)", to work through the backlog.

## States and ranges
- 91 existing proposals start as suggested. No setter found: "No setter · no booking found" (suggested).
- Changing credit on a deal paid in a closed month: the picker says so in one line ("Pay for
  September is closed; this shows as an adjustment in October") before it saves.
- Inactive people stay shown on old deals (greyed), and never appear in the picker.
- Error saving: the cell reverts and says why in place.

## Scope and boundaries
- In: the Credit row, the picker, list column + filter, and the data model that every pay/KPI
  surface reads.
- Untouched: proposal editing, billing, signing, public proposal page.
- Anti-goals: no commission split UI, no per-proposal percentages (rates stay per person per month).

## Constraints
- Admin-only writes, enforced on the server; every change logged with who/when.
- One source of truth: Pay Tracker, commission engine, leaderboard, KPIs read the same assignment.


## Revisions from Jack, 2026-09-29 (these win)
1. **Visible without clicking anything, editable where you see it.** No "Credit" section to open.
   - LIST ROW: two compact cells, Closer and Setter, each a person chip (avatar + first name). Admin clicks
     the chip and a person picker opens right there; picking saves. A suggested one shows a dotted ring
     and a one-click tick on hover to confirm.
   - DETAIL PANEL: the same two chips sit in the panel header next to the status, always visible, same
     inline picker. The "why suggested" line lives in the picker and the chip tooltip, not as page text.
2. **Multi-select action bar, the pipeline pattern** (fixed bottom-centre strip: "N selected" | text
   actions with icons, thin dividers | Clear). One component, same look as the pipeline.
   Actions, admin only, each one confirmed where money or history is touched:
   - **Set closer** (person picker) and **Set setter** (person picker + "No setter").
   - **Confirm credit** (turns every suggested closer/setter in the selection into confirmed).
   - **Mark lost** (asks for the one reason, applies to all; skips ones already paid or won, says which).
   - **Archive** / **Unarchive**.
   - **Export CSV** (the selected rows with closer, setter, amounts, dates) for payroll checks.
   - **Delete** (drafts and archived only, as a hard guard; confirm modal names the count).
   - NOT offered: a free-form "change status" to paid/signed/active. Those come from real signatures and
     Stripe payments; setting them by hand would fake revenue. Won/paid states stay event-driven.
   Every bulk action reports exactly what happened: "12 updated, 1 skipped (already paid)". Nothing
   fails silently (today's Archive swallows failures; fixed).
3. **Everything downstream follows the assignment, 100%.** Every KPI, rep-performance figure,
   leaderboard, commission, Pay Tracker row, Today item and notification that credits a person for a
   proposal reads the same assignment. Map of every consumer: see tasks/proposal-roles-plan.md.
