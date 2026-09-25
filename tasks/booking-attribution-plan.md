# Booking attribution: close the loop from a sent link to a booked call

Created 2026-09-23. Status: SHIPPED 2026-09-23. Owner: Jack.

## The gap

`booking_links` records who sent a link, to whom, for which calendar, and whether it was
clicked. Nothing ever records that the click became a booking. Direct bookings (the rep picks
the slot in our app) are credited at the moment they are made, because we create the
appointment ourselves. Sent links stop at "clicked".

That last hop is the whole input to the setter tracker: Kelsey is paid $25 per booked call.
Without it, her tracker counts zero.

## Measured facts this design rests on

- `/calendars/events` returns **`dateAdded`**, the moment the appointment was CREATED, distinct
  from `startTime`. Verified against the live location on 2026-09-23. This is what makes the
  match exact rather than inferred.
- `booking_links` is currently **empty**: nobody has sent a tracked link yet. So this job
  credits nothing until Kelsey starts booking through the app. No backfill is possible and none
  is attempted.
- `calls` mirrors appointments, but `sync-calls` runs **once a day at 07:00**. Matching against
  our local mirror would mean "the row appeared after the link was sent", which with a daily
  sync would wrongly credit a booking made hours BEFORE the link went out. Reading `dateAdded`
  from GoHighLevel avoids that entirely.

## The rule

An appointment is credited to a link when ALL of these hold:

1. same GHL contact id
2. same calendar id
3. `dateAdded` is AFTER the link was sent (you cannot cause a booking that already happened)
4. `dateAdded` is within 30 days of the link being sent
5. the appointment is not deleted, and is not already credited to another link

Where two links from different people qualify, the **most recently sent** one wins: last touch
is the standard, and the person who sent the link they actually clicked is the person who did
the work. Where one link matches two appointments, the **earliest** booking claims it, and the
link is then spent.

### What this rule deliberately does NOT do

It will not credit a link when the prospect books a DIFFERENT calendar than the link pointed
at. That is a real miss, and the honest alternative (credit any appointment for that contact)
would hand a setter credit for onboarding calls and rebooks they had nothing to do with. A
silent wrong number in someone's pay is worse than a visible missing one.

## Cost

Events are fetched per CALENDAR, not per link, so the job costs roughly one GoHighLevel call
per calendar that has an open link, typically one or two, regardless of how many links are
outstanding.

## Build

- [x] `db/migrations/0058_booking_attribution.sql` + apply script: partial UNIQUE index on
      `ghl_appointment_id`, so one appointment can never pay two people; partial index for the
      pending scan.
- [x] `lib/booking/attribute.ts`: the job. Lease-locked, never throws, one statement per credit.
- [x] `app/api/cron/attribute-bookings/route.ts`: GET, `CRON_SECRET` bearer. Vercel crons only
      issue GET.
- [x] `vercel.json`: schedule (four daily entries, see below).
- [x] Prove it on real data with a temporary link before shipping, then remove the test row.

## Gates
Backend only, so no shape/craft gate. Gate 6 (data integrity) applies: this writes a row that
decides pay. Additive, idempotent, never overwrites an existing credit.


## What the review changed (2026-09-23)

A staff-engineer review found three ways the first version could pay the WRONG person. All are
fixed, and the rule above is tighter than originally planned. Measured on the live location the
same day, across 194 appointments:

```
124  booking_widget        the prospect booked themselves, off a link
 50  google_calendar       synced in from someone's own calendar
 20  contactdetails_page   a GHL user booked it by hand
  8  cancelled (of the 194)
```

Three rules added as a result:

1. **Only `booking_widget` appointments can credit a link.** An allow-list of one, not a
   deny-list. A hand-booked or calendar-synced appointment was not caused by our link, and
   crediting it would pay a setter for a colleague's work. The person who books by hand is
   already identified through `calls.booked_by_ghl_user_id`.
2. **The link must have been CLICKED, and the booking must come after the click.** GoHighLevel
   sends its own booking links from automations. Without this, a prospect who ignored our link
   and booked from one of those would still pay whoever had an unclicked link open.
3. **Cancelled appointments never credit.** The booked-calls KPI already excludes them, and a
   pay sheet that disagreed with the KPI would be argued about every month.

Open policy question for Jack: a booking credited and THEN cancelled is not walked back today.
The credit stands. Reversing it is a business call, not a technical one.

Also fixed: the calendar check could disable itself when GoHighLevel omitted `calendarId` (events
are now tagged with the calendar they were fetched FROM, never the one the payload claims); one
malformed `dateAdded` made the whole batch's ordering undefined; the scan window had no slack
against the cron cadence, so a booking in a link's last hours could be missed forever; a run where
every calendar read failed reported as a clean quiet run; and the direct-booking route returned
"could not book that slot" when it lost a race to this job, which invited a retry that would have
double-booked the customer.

## Schedule note

This Vercel account only accepts cron expressions that fire once a day, which is why `sync-ghl`
appears four times rather than as one interval. Attribution follows the same pattern: 01:20,
07:20, 13:20 and 19:20 UTC, so a credit is never more than about six hours old.

## Verified in production
Deployed 2026-09-23 14:26 UTC. 13 behavioural checks passed against live GoHighLevel data,
including the three new exclusions. The cron ran in production and returned a clean result.
`booking_links` holds zero rows: nothing is credited until Kelsey sends her first tracked link.
