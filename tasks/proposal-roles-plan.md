# Closer and setter on every proposal

Created 2026-09-29. Owner: Jack. Status: BUILT on feat/proposal-credit (093195d, 700539d), reviewed x4, migration 0065 applied, NOT deployed.

Jack, 2026-09-29: "within each proposal, assign a setter and a closer ... so we can count up the
commissions and all of the metrics to do with the proposals far more accurately ... admin should
also be able to change who is the closer and who is the setter."

## Measured today
- `proposals.closed_by` exists and every pay/KPI surface reads COALESCE(closed_by, created_by), but it
  is NULL on all 91 proposals and nothing can set it: the closer is silently "whoever created it".
- There is no setter field. The Pay Tracker infers the setter from bookings (latest credited booking
  on the contact at/before sent_at; lib/tracker/setter-rules.ts).

## Decisions
1. (Jack) Auto-fill, marked SUGGESTED until an admin confirms or changes it. Pay counts either way;
   unconfirmed ones are visible to admin.
   - Closer suggestion: COALESCE(closed_by, created_by), as today.
   - Setter suggestion: the Pay Tracker's booking rule.
2. (inferred, Jack to correct) Admin-only edit; everyone sees it read-only.
3. (inferred) "No setter" is a valid, explicit choice: no setter commission.
4. (inferred) A confirmed assignment is THE source of truth: Pay Tracker (setter and closer), commission
   engine, leaderboard, KPIs all read it, replacing the booking inference.
5. (inferred) Changes after a month close never rewrite it: dated adjustment in the next open month.

## Gates (Jack, 2026-09-29): staff reviews, validation loops, no negative cascading effects; impeccable at
every UI stage (shape, craft, polish, harden); Gate 5 security, Gate 6 data.

## More decisions (Jack, 2026-09-29)
6. "Proposals sent" is credited to the CLOSER, so sent, closed and close rate line up for one person.
7. Client-facing emails name the CLOSER ("your rep").
8. UI: chips on the row and in the panel header, editable in place; pipeline-style bulk bar
   (see tasks/proposal-roles-shape.md, Revisions).

## Consumer map (Explore, 2026-09-29): ~30 places credit a person; only 4 read closed_by
Switch to CLOSER = coalesce(closed_by, created_by):
- app/api/dashboard/rep-performance/route.ts: proposalsSent :110, legacy dealsClosed/closedValue :118,
  closeRate/cohort :252/:284, commissionEarned :291 -> commission ENGINE (paid basis, Jack's rule)
- app/api/dashboard/rep-performance/drilldown/route.ts: proposals list :114
- app/api/dashboard/kpis/route.ts: proposals_sent_rep :172, deals_won :184/:348, revenue_won :379
- app/api/kpis/detail/route.ts: scoped proposals source :239 (card and drawer together)
- app/api/dashboard/goal-progress/route.ts :79-96
- lib/kpi/engine/datasets/proposals.ts: add closer + setter fields (keep createdBy for saved configs);
  non-admin scope = rows where they are closer OR setter OR creator
- app/api/today/route.ts :145 chase/Decide -> closer
- app/api/cron/weekly-summary/route.ts :103/:127/:132/:141 -> closer
- lib/proposals/slack-notify.ts :281 "Rep:" -> closer (+ "Setter:" line)
- app/api/stripe/webhook/route.ts :113 onboarding tasks -> closer
- lib/reminders/engine.ts :237-319 repFor -> closer; lib/reminders/transactional.ts :29 -> closer
- lib/proposals/ninety-day-fulfillment.ts :556 failed-charge DM -> closer
Unchanged (not proposal-based): calls booked, show rate, demos, rep-metrics GHL deals, Money.
Already COALESCE: commission helper, tracker closer sheet, tracker row check, leaderboard attributed.

## Build plan
- [ ] 1 Migration 0065 (additive, idempotent, dry-run default): proposals.setter_user_id, setter_mode
      (NULL = suggested by booking rule | 'assigned' | 'none'), closer_confirmed_by/at,
      setter_confirmed_by/at; proposal_credit_changes audit table (who, when, field, from, to).
      closed_by stays the closer column. NULL closer = suggested creator.
- [ ] 2 lib/proposals/credit.ts: closerSql(); suggestSetters() (pure, reuses the tracker booking rule);
      setCredit(actor, ids, change) admin-only, audited, per-id result, closed-month warning.
- [ ] 3 Tracker: explicit setter ('assigned') overrides the booking rule for commission; 'none' pays no
      setter; suggested keeps today's rule. Closed months: adjustments only.
- [ ] 4 Switch every consumer above to the closer; leaderboard gains setter columns (deals set, value set).
- [ ] 5 API: GET list returns closer/setter + suggestion + reason; POST /api/proposals/credit (bulk,
      admin-only); bulk lost/archive report per-id results.
- [ ] 6 UI (impeccable craft -> polish -> harden): row chips + inline picker, panel header chips,
      pipeline-style bulk bar (Set closer, Set setter, Confirm credit, Mark lost, Archive, Export CSV,
      Delete drafts/archived), "Credit to confirm (N)" filter.
- [ ] 7 Proofs: EVERY switched metric produces IDENTICAL numbers before and after on today's data (all
      closed_by NULL, no setters), except the deliberate leaderboard commission alignment, which is
      reported with its exact before/after. Then scenario proofs (reassign Alice/Kelsey, none, confirm,
      closed-month adjustment).
- [ ] 8 Reviews: staff code review, Gate 5, Gate 6. HTTP access checks. Render desktop + phone.
- [ ] 9 Jack's go -> migrate, deploy, verify.

## Staff review 2026-09-29: 5 blockers, 9 should-fix. Resolutions (SUPERSEDE the build plan where they differ)
- B1 Assigned setter with no booking lost pay. FIX: an assigned setter is paid through a PROPOSAL-keyed
  row (`p:<id>`) on their setter sheet, loaded by `setter_user_id`, not by contact. A proposal with an
  assignment (or 'none') is excluded from the booking rule, so the booked setter's line cleanly moves.
- B2 Cross-role pay never settled. FIX: pickers are role-restricted. Closer = closers + admins (Gage
  closes). Setter = setters only. A person is therefore always paid on the sheet month-close computes.
- B3 Close vs reassign race. FIX: credit writes are refused while a month close holds its lock; close
  takes the lock for its whole compute + write.
- B4 Bulk actions. FIX:
  - Mark lost: admin-only (server), sequential, per-proposal result; SKIPS anything signed, paid, with a
    paid instalment or a subscription (money in flight) and names each skip. Also closes an existing hole:
    the lost route had no permission check at all (any rep could mark any proposal lost); now admin or
    the deal's closer.
  - Archive: only unsigned, unpaid proposals; stores the status it had, so Unarchive restores it exactly.
    Server PATCH to "void" gets the same guard (today it can archive a PAID deal, which drops it from
    revenue KPIs while commission keeps paying).
  - Delete: only drafts, lost or archived proposals with no signature, no payment, no paid instalment.
  - Export CSV: admin-only, formula-injection safe.
  - Every bulk action returns per-proposal results; the bar says "12 done, 2 skipped: reasons".
- B5 Visibility and credit are separate predicates. A setter SEES deals she set; she is only CREDITED on
  closer metrics where she is the closer.
- S1 Old closer sees the clawback row. S2 Reassigning warns when a hand-typed pay override stops applying.
- S3 Confirming a booking-suggested setter makes pending pay payable; the confirm says so. Clashes show
  both names.
- S4 Every credit write is compare-and-set against the value the admin saw; audit row + update in one batch.
- S5 The setter suggestion comes from the SAME computeSetter output that pays, never a copy of the rule.
- S6 Same person both roles: impossible by role-restricted pickers.
- S7 Inactive closer: notifications, Today and DMs fall back to an admin; totals keep inactive people.
- S8 Creator stays where it means creator (edit permission, audit). Added to the map: list Rep column,
  engine hydrate, tracker row check, close-rate cohort.
- S9 CSV formula injection guarded.
## Proofs (replaces step 7): fixture ledger with hand-computed pay (closer != creator, assigned setter with
no booking, none, clash, inactive closer); month-close replay (A closed Aug, reassign to B: Sep shows
A -X, B +X, net 0; reassign attempted mid-close is refused); cross-surface agreement per person/period
(tracker, leaderboard, KPI cards, drawer); before/after byte-identical snapshot of every consumer on today's
data; read-only shadow run of every person's monthly pay before switching.
