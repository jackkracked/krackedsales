# Closer tracker: shape brief

Created 2026-09-23. Status: SHIPPED 2026-09-23 15:47 UTC. Confirmed by Jack, built, rendered and verified.

## Who this is for, and what success looks like

Alice opens it on the 1st of the month and knows what she earned, without asking Kelsey and
without opening a spreadsheet. She trusts the number because she can see the deals behind it.
Jack opens it and sees the same figure for anyone on the team.

Success is that nobody asks "where does this number come from". So every figure on the screen
can be traced to the rows underneath it in one glance.

## Where it lives

`/tracker`, its own page in the sidebar, not a tab inside Money.

Money is the company's revenue. This is one person's pay. Putting a rep's earnings inside the
company P&L invites exactly the permission mistake that must never happen here.

## The page, top to bottom

**1. The answer first.** A row of summary figures, with total estimated pay as the one that
reads largest:

```
Base pay      Proposals sent   Deals closed   Closed value   Commission (10%)   TOTAL PAY
$2,500              3                1            $4,500          $450           $2,950
```

Commission carries the rate in its label, because "$450" alone is not checkable and "10% of
$4,500" is. Each figure gets a tooltip naming its source (for example: "Paid in full, recognised
when the whole proposal is paid").

**2. The month it refers to**, as a switcher next to the title, listing only months that have
something in them. Defaults to the current month, which is labelled **in progress**, because a
figure for a month that has not finished is a projection and must never be mistaken for a
settled amount.

**3. The proof.** One row per proposal that touched the month, using Untitled UI's table:

| Client | Status | Amount | Sent | Closed | Commission |

Status is a badge: Sent, Signed, Closed, Lost. A proposal sent in March and paid in April
appears on both months, as outreach on one and as income on the other, because a single date
column cannot tell that story honestly.

**4. Admin view.** Jack gets a person switcher beside the month switcher. Everyone else sees
only themselves, enforced on the session, not on anything the browser sends.

## Empty and edge states

- **No proposals this month:** "Nothing closed in September yet", not a blank table.
- **Base pay not set:** the figure reads "Not set" with a link to team settings, rather than
  showing $0 and quietly understating someone's pay by their whole salary.
- **0% commission** (Gage, who is on the admin role): the commission column is hidden entirely
  rather than showing a row of zeroes, which reads as broken.
- **Long client names** truncate with the full name on hover; amounts are tabular so columns of
  money line up.

## Deliberately NOT in this build

The setter half. Kelsey's booking bonus depends on tracked links, and none have been sent yet,
so a setter tracker today would show her a page of zeroes. It lands once there is data in it.

## Decisions taken, from Jack 2026-09-22

- "Closed means paid": a deal counts on `paid_at`, never on signature.
- Base pay is set per person in admin, which is now a real field.
- The payout-timing toggle (on full payment / on first instalment / per instalment) already
  exists in settings and this screen states which one is in force.


## What shipped, and what the render pass changed

Verified by rendering the real page against live data at 1440px and 390px, as admin and as
Alice, then reading the screenshots. Three defects were found and fixed before deploy:

1. **The total was stranded.** It sat as one more cell in a shared grid, so whenever the number
   of supporting figures did not divide evenly it dropped onto a second row beside a wide empty
   gap. The total now has its own panel, which cannot go ragged at any width.
2. **"$0" was being printed where the truth was "nobody has told us".** A person opening their
   own pay screen and reading a confident zero is a different statement from an honest "not
   set". The total now says "Not set" when no base pay exists and there is no commission, and
   "Commission only, no base pay set" when commission stands alone.
3. **The row count contradicted the summary.** "12 proposals" beside "Proposals sent 10" reads
   as a bug. The header now says "10 sent · 3 closed", which ties to the figures above it.

Also decided during the build: **setters cannot see the tracker yet.** It computes a closer's
proposals, so Kelsey would open it and be told she earned nothing. One toggle in team settings
turns it on the day her booking bonus is real.

Proof it traces: Alice's July shows total $450, "1 · $4,500" closed, commission $450, and the
single Epicured row underneath it closed 27 July for $4,500. The figure and its evidence agree
on screen.
