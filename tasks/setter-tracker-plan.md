# Setter tracker + editable months: build plan

Created 2026-09-25. Branch `feat/setter-tracker` (off checkpoint `2da78b7`). Status: BUILT, reviewed, verified on real data. Migration 0063 APPLIED to prod (Jack's go, 2026-09-25). Code NOT deployed. 0064 (setters on) NOT applied.
Requirements: `tasks/commission-tracker-plan.md` (decisions 1-14). UI: `tasks/setter-tracker-shape.md`
(confirmed by Jack 2026-09-25). Nothing deploys without Jack's explicit go.

## Facts this rests on (measured, 2026-09-25)
- `calls` never stores a cancelled appointment (sync `continue`s past them, calls/sync l.363) and
  never stores `dateAdded`. It cannot show "cancelled, −$25". A dedicated appointment mirror is needed.
- Booked-call calendars = name match `isBookedCallCalendar` (booked-calls route l.51-54), private.
- `call_dispositions.calendar_event_id` = raw GHL event id; `calls.meet_conference_id = 'ghlappt_'||id`.
  128/140 recent dispositions join. First write wins (`onConflictDoNothing`).
- GHL appointment status: 0 showed / 0 noshow ever. Dispositions are the only outcome signal.
- `booking_links`: 0 rows. `local_opportunities.assigned_to` is a GHL user id.
- No test runner. Proofs are `scripts/prove-*.ts` run with tsx.
- `role_permissions` setter/view_tracker = false in prod.

## Rules (the maths), each one proved in scripts/prove-setter-tracker.ts
R1 Month of a booking row = month of the CALL (start time), America/New_York. Evidence: Kelsey's
   August tab carries Archetype booked 31 Jul. Closer tracker keeps its existing UTC months.
R2 Outcome, first match wins: override > appointment deleted/cancelled → CANCELLED > start in
   future → UPCOMING > disposition no_show → NO_SHOW, rebooked → NO_SHOW (did not happen) > any
   other disposition, or GHL status showed/completed → HELD > else AWAITING_OUTCOME.
R3 Credit, first match wins, only for users with role `setter`, never overwriting a human decision:
   booking_links.ghl_appointment_id → `in_app`/`link` CONFIRMED; createdBy.userId = setter's
   ghl_user_id → `ghl_manual` CONFIRMED; contact's opportunity assigned_to = setter → `owner`
   PENDING (setter confirms); manual add → `manual` CONFIRMED. Two live credits on one appointment
   from different people → both CLASH, neither pays until admin decides.
R4 Bonus: HELD + credit confirmed = bonus in the call month. CANCELLED / NO_SHOW = −bonus shown,
   not paid. PENDING/AWAITING/UPCOMING/CLASH = shown as pending, never in the total.
R5 Rebook: a NO_SHOW credit is RESTORED by the next later HELD appointment for the same GHL
   contact; the restored bonus lands in THAT appointment's month, labelled with the original date.
   The restoring appointment's own credit (if any) pays $0, "rebook of <date>": a no-show chain
   pays once. Opportunity lost with no restore → NEVER_REBOOKED.
R6 Setter commission: proposals whose ghl_contact_id is a contact with a paying credit (HELD or
   RESTORED) for this setter, sent at/after that booking. Recognised per the global payout-timing
   toggle, at the pct of the month the commission lands in.
R7 Month settings (base, bonus, pct): row per user×month. Resolution = that month's row; months
   up to the current one are materialised (carry forward the latest earlier row, else user
   defaults) before any read or any default change, so a past month can never move when a
   default changes. Editing the CURRENT month also updates the user default, so team settings
   and homepage KPIs stay aligned.
R8 Overrides: any cell, per user×row×field, marked with who/when; original kept. Totals use the
   overridden values. Notes are the `notes` field.
R9 Access: rep reads/writes only self; admin anyone. Reps edit settings/overrides/manual rows in
   the CURRENT month only; past months read-only for reps (confirm/reject of pending still
   allowed, it resolves rather than edits). Every write records actor and time.
R10 Go-live: setter rows start at 2026-09 (so September can be checked against her sheet).

## Steps
- [x] 1 Migration 0063 (written, NOT applied) (additive, idempotent) + apply script: `ghl_appointments`, `setter_credits`,
      `tracker_month_settings`, `tracker_overrides`, `users.booking_bonus_cents` (default 0;
      set 2500 for role setter where 0). NOT the view_tracker flip (ships in 0064 at go-live).
- [x] 2 Drizzle schema for the above.
- [x] 3 `lib/booking/calendars.ts`: move `isBookedCallCalendar` out of the route; route imports it.
- [x] 4 `lib/tracker/appointments-sync.ts`: read booked-call calendars (start −120d..+550d), upsert
      mirror incl. cancelled, first-seen timestamps; vanished rows verified by per-id 404 before
      marking deleted. Lease-locked like attribute-bookings.
- [x] 5 Credits computed on read (S1), decisions table only.
- [x] 6 Commission engine (proved identical: 24 comparisons, 174 events): factor query into `getCommissionEventsWhere(where)` returning base
      amounts; `getRepCommissionEvents` unchanged in output (prove identical numbers before/after).
- [x] 7 `lib/tracker/month-settings.ts` (R7), `lib/tracker/overrides.ts` (R8).
- [x] 8 `lib/tracker/setter.ts`: pure `buildSetterMonth(inputs)` (R1,R2,R4,R5,R6,R8) + loader.
- [x] 9 Closer: `getCloserMonth` uses month settings + overrides + notes + outcomes-needed list.
- [x] 10 API: GET /api/tracker/setter; PATCH /api/tracker/month-settings; PUT /api/tracker/overrides;
      POST /api/tracker/setter/credits (manual add); PATCH /api/tracker/setter/credits/[id]
      (confirm | reject | admin resolve). All session-enforced (R9).
- [x] 11 (folded into attribute-bookings, N1) Cron: /api/cron/sync-appointments (sync + credits, 4x daily, CRON_SECRET, GET);
      /api/cron/tracker-nudges (daily Slack DM digest, claimNotification dedupe).
- [x] 12 Team settings PATCH: materialise months before changing base/pct defaults (R7).
- [x] 13 UI per shape brief (craft), then polish, then harden.
- [x] 14 Proofs: scripts/prove-setter-tracker.ts (pure rules + access rules), live dry run of
      Kelsey's September vs her sheet, closer numbers identical before/after for every closer month.
- [x] 15 Reviews: staff code review, Gate 5 security, Gate 6 data integrity. Fix, re-prove.
- [ ] 16 Jack approves → apply migrations, deploy, run sync once, verify in prod.

## Deliberately not changed
- Existing outcome route (`/api/dashboard/calls/[eventId]/outcome`) has no ownership check.
  Reported as a finding, not silently changed: the dashboard relies on it.
- Booked-calls KPI definition, calls sync, Money page.

## Staff review 2026-09-25: 5 blockers, 8 should-fix, 3 nits. Resolutions (these SUPERSEDE R1-R10)

- B1 Self-marking a call as held. `call_dispositions` has no author. FIX: new additive column
  `call_dispositions.created_by_user_id`, set by the outcome route from the SESSION (no behaviour
  change otherwise). Tracker outcomes live in their own supersedable table `tracker_call_outcomes`
  (author, recorded_at, the appointment start it refers to). An outcome written by the setter
  credited on that appointment is never proof: it is an OVERRIDE, marked, admin-visible.
  Dispositions written before go-live (no author, no tracker existed, no incentive) are accepted.
- B2 Reschedule keeps a stale outcome. FIX: any outcome counts only if recorded at/after the
  appointment's CURRENT start time. A moved appointment returns to AWAITING and re-nudges.
- B3 Proposal paying two setters / forever. FIX: a proposal attaches to exactly ONE booking: the
  latest paying booking on that contact at/before `sent_at` (window: Jack's answer). Tie → pending.
- B4 Past months moving. FIX: month CLOSE. Until closed, a month is live. Closing freezes every
  row's settled amount in `tracker_settled_rows`. Any later change to a closed month's row
  appears in the current open month as a dated adjustment line (live minus already-settled), and
  is itself settled when that month closes. A closed month's total never changes.
- B5 Pre-go-live no-shows paying twice. FIX: appointments starting before 2026-09 never restore.
- S1 Stale insert-only credits. FIX: store only facts and human decisions. Owner suggestions are
  computed on read, never stored. Link attribution runs in the same job, before appointment sync.
- S2 Owner fallback guessing. FIX: a higher-priority signal naming a non-setter STOPS the chain
  ("Booked by Gage"). Suggest only when every live opportunity on the contact is owned by that
  one setter. Still requires the setter's confirm.
- S3 Unbounded restore. FIX: earliest open no-show is restored; window per Jack's answer; stops
  when the opportunity is lost. A pending credit must be confirmed to pay, restored or not.
- S4 Setter commission if the booked call never happened: Jack's answer.
- S5 "completed" is not proof (0 in GHL; set by another sync). FIX: GHL statuses are not used
  as outcome evidence at all. Evidence = tracker outcomes + authored dispositions only.
- S6 Settings: FROM-MONTH rows. Rate for month M = latest row with month <= M. Migration seeds a
  baseline row per user from current defaults. Editing month M upserts M and pins M+1 (if <= the
  current month and absent) at the prior values, so it changes M only. Rep edits never touch
  `users` defaults. Team settings keeps writing `users` (other features read it) AND upserts the
  current month's row. No materialisation, no race, step 12 simplified.
- S7 Timezones: America/New_York for everything new (booking months, setter commission, settings
  months). Closer tracker switches to NY months only if the proof shows no real closer month
  changes; otherwise it stays UTC and the difference is stated.
- S8 Deleted detection: only probe vanished events whose start was inside the fetched window.
  404 → DELETED (cancelled). 200 on a non-booked-call calendar → MOVED (no bonus, shown).
- N1 No new crons: appointment sync + credit facts fold into `attribute-bookings` (4x daily);
  the daily Slack nudge digest rides its 13:20 UTC run.
- N2 Header label "Calls held", with a note that the KPI counts bookings by booking date.
- N3 A new appointment replacing a cancelled one on the same contact within 14 days is suggested
  to the cancelled row's setter, labelled "replaces cancelled appointment on <date>".

### Jack's answers to the review's business questions (2026-09-25)
- S4/B3: setter 5% applies FOREVER, whether or not the call was held. One proposal still pays one
  setter only: the most recent credited booking on that contact at/before `sent_at`. No window.
- S3: rebook restore has NO time limit; the row closes only when the opportunity is lost.
- B4: month close is an ADMIN action, surfaced as a task on the admin's dashboard.

### Deploy-order constraint (found while building)
The outcome route now writes `call_dispositions.created_by_user_id`. Migration 0063 MUST be
applied before this code deploys, or every dashboard outcome insert fails.


## Build outcome (2026-09-25)
- Proofs: 85/85 (`node_modules/.bin/tsx scripts/prove-setter-tracker.ts`), mutation-tested.
- Commission engine refactor: identical on 24 comparisons / 174 real events.
- Closer tracker upgrade: identical pay on every person-month; only 3 "proposals sent" counts
  moved (UTC to New York months, Fumi The Label and Shark Guard), as measured beforehand.
- Reviews: staff plan review (5 blockers fixed before code), bug review (9 fixed), Gate 5 security
  (4 High fixed, H5 kept by Jack's decision with a close-time review list), Gate 6 data (7 fixed).
- HTTP access checks: 13/13 refusals as intended (+ proxy redirects anonymous requests).
- Real data: 909 appointments synced (35 cancellations `calls` had dropped). Against Kelsey's
  August sheet: 12/15 suggested automatically, 1 correctly filed in July (call 31 Jul), 2 need a
  one-click manual add (Revitalise: Gage's lead; Hard Tuned: booked by Gage, no owner). Ownership
  also suggests ~13 extra self-booked calls on her leads that she will decline.
- Only tracked links / in-app booking make setter credit PROVEN rather than suggested.
- Incident: 0064 applied by accident for ~2 min, reverted. See lessons.md.

## Deploy checklist (needs Jack's explicit go)
1. `vercel --prod` (team token, no --scope). 0063 is already applied, so the outcome route's new
   column exists.
2. Check that team-settings edits made on the OLD code since 0063 (users.base_pay_cents /
   commission_pct) match the current month's settings row; re-record any that differ.
3. `node scripts/apply-0064-tracker-setters-on.mjs --apply` (setters on).
4. Hit /api/cron/attribute-bookings once with the CRON_SECRET; confirm `appointments.status: ok`.
5. Open /tracker as admin for Kelsey and Alice; time the API (<1s expected in iad1).
