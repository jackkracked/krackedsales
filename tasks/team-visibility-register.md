# Team performance + visibility: the full register

Created 2026-09-22 from Jack's brief. **Nothing in this file gets dropped.**

## How the team actually works (Jack, 2026-09-22, corrects earlier assumptions)

- **Kelsey — setter.** Predominantly OUTBOUND CALLS. Books demos in. Creates tasks. Books
  calls for the closers. Creates demos. Has been dialling from the GoHighLevel dashboard, not
  ours; she has just been shown our dialer.
- **Alice — closer.** Shows up to the booked calls. Follows up. Books some of her own calls.
  Sells.
- They are judged on **different metrics** and must never share a leaderboard.

The consequence that matters: **while Kelsey dials in GHL, we cannot see her work.** Move her
onto our dialer and call volume, talk time and outcomes become ours by construction — which
also fixes the setter attribution problem at source rather than inferring it after the fact.
That is why the dialer work is sequenced first.

---

## 1. Dialer: load a campaign from a pipeline stage  ← STARTED FIRST
Jack: *"instead of creating campaigns, maybe we can have it when we go onto the dialer page,
when we're loading in a campaign, we could choose either from campaign or from pipeline stage
... they select the pipeline, then they select the stage of that pipeline, and then they load
all of those numbers ... same retry attempts, very similar to the campaign builder."*

- [ ] Source switch on the dialer load step: **From campaign** | **From pipeline stage**
- [ ] Pipeline picker, then stage picker (stage list depends on the pipeline)
- [ ] Show the count before committing: "Load 237 numbers from Unresponsive (Demo Not Started)"
- [ ] Same `maxAttempts` / retry behaviour as the campaign builder
- [ ] Skip contacts with no phone, and say how many were skipped rather than silently dropping
- [ ] De-dupe against numbers already queued in that campaign
- [ ] Existing machinery to reuse, do NOT rebuild: `dialer_campaigns`,
      `dialer_campaign_contacts` (contactId, name, phone, position, attempts, status,
      lockedByUserId), `components/dialer/campaign-builder.tsx`, `add-to-dialer.tsx`
- [ ] Phone numbers come from the mirror (`local_opportunities.contact_phone`,
      `local_contacts.phone`) — no GHL calls needed to build a queue

## 2. Admin visibility: where is the time going?
Jack: *"we need visibility as admins to see where the time is being spent as a company ...
How many calls has Kelsey booked? How many calls has she made? Is she being productive with her
time in regards to the calls, the talk time? ... what if Kelsey isn't on calls, what else would
she be doing?"*

- [ ] Per-rep, per-period: calls made, talk time total and average, connect rate, outcomes
- [ ] **Calls booked** (the setter's actual output) vs calls made
- [ ] Demos created, tasks created and completed
- [ ] **Utilisation**: how much of the working day is accounted for, and the gaps. This is the
      "what else would she be doing" question and it is the one with no existing answer
- [ ] Role-aware: setter panel and closer panel show different columns (see §4)
- [ ] Trend over time, not just a snapshot, or it cannot answer "is she improving"
- [ ] Source: `calls` (duration_seconds, started_at, rep_email, status, direction),
      `activity_events`, `proposals`, demo boards

## 3. Commission trackers (setter + closer)
Full detail and the measured feasibility findings live in `tasks/commission-tracker-plan.md`.
Summary: closer tracker is essentially free from `proposals`; setter tracker is blocked on
crediting booked calls.

- [ ] Setter tracker replacing `Commission_Tracker.xlsx`
- [ ] Closer tracker
- [ ] Month switcher, pay summary card, per-row source attribution
- [ ] Base pay per person, admin-editable
- [ ] **BLOCKED** on Jack's answers: attribution rule (A/B/C), base pay for Alice and Taylor,
      5% of full contract or first payment, "closed" = signed or paid, does the setter earn on
      a proposal someone else closed

## 4. Role-split metrics
A setter creates qualified pipeline; a closer converts it. Never rank them on the same number:
the setter cannot control close rate and the closer cannot control dial volume. Prior research
in `tasks/rep-performance-plan.md`.

- [ ] Setter: calls made, talk time, calls booked, demos created, show rate, booked→closed
- [ ] Closer: calls attended, proposals sent, close rate, average deal size, revenue, commission

## 5. Standing requirements (Jack, repeatedly)
- [ ] Untitled UI components for tables, modals, cards — **verify licence and install path
      first**; the repo currently runs shadcn + Watermelon UI
- [ ] Staff review before building, code review before shipping
- [ ] Validation loops: prove it works against production data, do not assert it
- [ ] No negative cascading effects on what already works
- [ ] "$100 billion VC level" finish: aesthetic, polished, impeccable gates (shape → craft →
      polish → harden)
- [ ] **Security gate: pay and performance data is sensitive.** A setter must never see another
      rep's earnings or another rep's productivity. Admin-only for the cross-team view.

## Still open from earlier, not forgotten
- [ ] Instagram blank thread: 20 media-only IG messages render as "No messages yet" on every
      Instagram conversation, because the display filter drops messages with an empty `body`
      while the content sits in `attachments`
- [ ] The IG 24-hour window error text Jack was going to send
- [ ] Real-time stage sync: `tasks/realtime-stage-sync-plan.md`, reviewed and revised, not built
