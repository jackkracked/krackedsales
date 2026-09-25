# Accuracy + Leads Centre plan — opened 2026-08-07

Everything outstanding from the 2026-08-07 session, in the order I intend to do it.
Tick `[x]` as each lands so `bash tasks/scripts/standup.sh` stays honest.

---

## DONE 2026-08-07 (deployed + verified on prod)

- [x] **Meta stage import, signal-free.** `scripts/import-meta-leads.mjs` → `meta_leads`
      (migration 0046). 729 rows = Meta's exact Leads Centre set: intake 16 · qualified 62 ·
      converted 186 · not_qualified 465. No Conversions API events sent, no rows invented.
- [x] **GHL contact parity.** Ghost delete (`local_contacts.deleted_in_ghl_at`, migration 0047)
      + `scripts/reconcile-ghl-contacts.mjs`. **5,094 = 5,094 exact**, 0 missing inbound.
- [x] **GHL sync dropped new leads.** `syncContacts()` paged oldest-first and broke on a 50s
      budget, so the newest contacts were always the casualty — and it reported success.
      Now `/contacts/search` sorted `dateAdded desc`. Tony Lightwood arrived.
- [x] **Contacts page listed opportunities, not contacts.** 1,895 of 5,094 contacts (37%) were
      unsearchable — every brand-new lead among them. Now driven from `local_contacts`.
- [x] **Opportunity parity + stage-filter accuracy.** Ghost delete (migration 0048) +
      `scripts/reconcile-ghl-opportunities.mjs`. 98 deleted deals were still being counted;
      "Unresponsive (Demo Not Started)" read 46 against GHL's 0. **3,528 = 3,528 exact**, and
      all five sampled stages in the Email Design Demo Pipeline now match GHL to the row.
- [x] **Removed the stage chip bar** on Contacts — its numbers came from the stale mirror.
- [x] **Leads page visual pass** — Meta-style stage rail, pager freed from the floating widget,
      one Qualification section instead of duplicated form answers.

---

## NEXT

### 1. Rep performance ("direct performance") — fact-check every number  ★ Jack's priority
The panel is showing zeros and Jack believes **every** number on it is wrong. Do not patch it
cosmetically; verify each metric against source first.
- [ ] Inventory every metric on the panel and write down its intended definition.
- [ ] For each, compute the truth from source (GHL opportunities / calls / demos / proposals)
      and diff against what the panel renders. Table the result: metric · shown · true · cause.
- [ ] Fix the causes. Expect the same class of bug as everywhere else today: stale mirror rows
      now excluded by `deleted_in_ghl_at`, and counts derived from the wrong population.
- [ ] Re-verify against source after the fix, not against the previous render.

### 2. Demos column on rep performance
Kelsey is working the unresponsive list and creating demos; Jack wants that visible.
- [ ] Add a **Demos** column counting demos created per rep.
- [ ] Confirm the attribution field first — who "created" a demo (`demo_ghl_links`,
      `demos.created_by`?) — and confirm with Jack that created (not delivered) is the metric.
- [ ] Include it in the same fact-check pass as #1.

### 3. Leads rail reads the mirror
- [ ] Point `/api/leads` counts AND feed at `meta_leads` (left join `local_contacts`), so the
      rail reads Meta's numbers by construction: 16 / 0 / 62 / 0 / 186 / 465.
- [ ] Union in Meta-attributed contacts not present in the mirror so post-cutover leads still
      appear (they show as Untriaged, which is honest).
- [ ] Handle Meta-only rows in the drawer: no `contact_id`, so no GHL write-back — show what
      Meta gave us rather than a broken panel.

### 4. Ghosts filtered from the remaining read paths
`deleted_in_ghl_at IS NULL` is applied to the Contacts route and the opportunity mirror. Audit
and apply everywhere else that COUNTS or LISTS:
- [ ] `lib/dialer/mirror-source.ts` — never dial a contact GHL deleted.
- [ ] `app/api/ghl/contacts/search/route.ts`
- [ ] `app/api/calls/route.ts`, `lib/call-prep/gather.ts`, `app/api/cron/roll-up-orphans`
- [ ] Leave lookups BY ID unfiltered, so historical records still render a name.

### 5. Drawer / UI (Jack, 2026-08-07)
- [ ] **Sticky quick actions** — pin Task · Demo · Audit to the bottom of the drawer, always in view.
- [ ] **Message quick action** — opens the contact modal ready to message.
- [ ] **Remove the K copilot widget** (bottom-right). Nobody uses it, and it was covering the pager.

### 6. Contacts page navigation is slow
Clicking Contacts hangs before the page responds.
- [ ] Measure first — the route now loads 5,094 contacts + 3,528 opportunities + conversations
      per request. Confirm that is the cause before optimising.
- [ ] Likely: cache/paginate server-side rather than assembling the whole list per request.

---

## STANDING RULES FROM TODAY
- **Reconcile both directions.** "Is everything in A also in B" is half a question; the
  surprising number is always the one you did not ask for.
- **A stale mirror looks exactly like a broken filter.** Before touching filter logic, check
  whether the rows it counts still exist upstream. Six 404s settled it in one minute.
- **Never ghost-delete from a partial pull.** Both reconcile scripts abort unless the fetched
  set is complete/plausible.
- **Verify against source, not against the last render.**

---

## REP PERFORMANCE — fact-check results, 2026-08-07

The panel computes exactly five metrics. There is **no demos metric at all** — the file's own
doc comment claims "demos (ClickUp)" but no such code exists.

| Metric | Source | Verdict |
|---|---|---|
| calls | `calls.rep_email = user.email`, in range | **partly wrong** — 110 of 492 calls (22%) can never appear |
| proposalsSent | `proposals.created_by = user.id`, `sent_at` in range | correct |
| dealsClosed / closedValue | same, `paid_at` in range | correct (gage 16/$20,758 · alice 2/$6,000) |
| openLeads | mirror, grouped by `assigned_to` | **was wrong** — counted ghost-deleted opps. FIXED |
| demos | — | **does not exist** |

### Confirmed causes
1. **[x] Open leads counted deleted deals.** `getOpenCountsByRepFromMirror()` had no
   `deleted_in_ghl_at IS NULL` filter. Alice 368 → 336, Gage 1,726 → 1,677 (81 ghosts).
   Fixed + deployed.
2. **[ ] 104 calls have a NULL `rep_email`** and 6 belong to `taylor@krackedretention.com`,
   who is not a user. 110 of 492 calls are invisible to the leaderboard. Decide: backfill the
   attribution, add Taylor as an inactive user, or show an "unattributed" row so the total reconciles.
3. **[ ] Kelsey has `ghl_user_id = NULL`**, so `openLeads` is hard-coded to 0 for her by
   `!user.ghlUserId ? 0 : …`. Needs her GHL user id mapped.
4. **[ ] Kelsey has 0 calls and 0 proposals — legitimately.** She is a setter who creates
   demos, and the panel measures neither. Her row is not a bug; it is the missing Demos metric.
5. **[ ] Open leads only covers reps in our `users` table.** GHL users
   `Q1ecYY0ay3aLl1RXZLEZ` (315 open) and `PycNer8DQCsaKNz7q7gd` (106) are unmapped, plus 838
   unassigned and 121 empty-string. ~1,380 open opportunities belong to nobody on the panel.
6. **[ ] Not all zeros are bugs.** The panel defaults to `range=week`. This week: gage 8 calls,
   alice 6, 3 proposals sent, 0 deals paid. Verify a wrong number against the SAME range before
   calling it broken.

### Demos column — blocked on attribution
No demo table records who created the demo:
- `demo_boards` (6 rows) — has `rep_id`, **NULL on all 6**
- `demo_ghl_links` (302 rows) — no creator column
- `demo_sent_dates` (779 rows) — no creator column

Next step: trace the demo-creation path (`CreateDemoModal` → which table it writes) and check
whether the acting user is recoverable from `activity_events`. Then confirm with Jack whether
"demos" means created or delivered. Do NOT guess an attribution source — a wrong per-rep number
is worse than an absent one.

---

## SHIPPED 2026-08-07 (later block)

- [x] **Kelsey mapped.** `Q1ecYY0ay3aLl1RXZLEZ` (Kelsey Folcarell), found via
      `GET /users/?locationId=…` — note the endpoint rejects a `limit` param, which is what made
      the first attempt look like a 401/permissions problem. Her open leads: 0 → **315**.
      Taylor Flesher = `PycNer8DQCsaKNz7q7gd` (the 6 "invisible" calls).
- [x] **Demo attribution built.** `/api/webhooks/demo` now resolves the session user BEFORE
      board creation, passes `repId` into `createBoardFromDemo` (the column existed and was
      NULL on every row), and logs a `demo.created` activity event. The leaderboard counts the
      EVENT, not `demo_boards` — board creation is deliberately non-fatal, so a failed board
      must not erase the rep's credit.
- [x] **Demos column** on rep performance + its drilldown, both reading the same source so the
      list can never disagree with the number above it. Attribution starts today; earlier
      periods read 0 for everyone because nothing before this recorded who pressed the button.
- [x] **Open leads exclude ghost deals** (`getOpenCountsByRepFromMirror`). Alice 368 → 336,
      Gage 1,726 → 1,677.
- [x] **Leads rail reads the Meta mirror.** Live and exact:
      `intake 16 · qualified 62 · converted 186 · not_qualified 465`, plus `untriaged 10`
      (Meta-attributed leads we hold that Meta's last export predates).

## THE 104 UNATTRIBUTED CALLS — diagnosed, NOT Kelsey's

Jack's hypothesis was that they were Kelsey's, unattributed because she was unmapped. Checked:
they are not.
- All 104 are `call_type: "meet"`, `source: "ghl"` — GHL **calendar appointments**, not dialer calls.
- 94 sit on calendar `CCXiefSXYwcv7qvt64FB` ("Kracked Retention - Intro Call"), whose
  `teamMembers` array is **empty**, so there is no calendar-level owner to infer.
- The appointment payload has **no `assignedUserId`** and `assignedResources: []`. It does carry
  `createdBy`:
    - booked inside GHL → `{source:"contactdetails_page", userId:"…"}` — **attributable**
      (the one resolvable sample was Gage's)
    - synced from Google Calendar → `{source:"google_calendar"}` — **no user at all**
- So: attribution is recoverable for GHL-booked appointments via `createdBy.userId`; the
  Google-synced ones carry no rep in GHL and would need the Google Calendar owner instead.

### [ ] NEXT: real-time call/appointment streaming (Jack's ask)
- [ ] Backfill `rep_email` from `createdBy.userId` for appointments that have one.
- [ ] Capture `createdBy.userId` in the appointment sync going forward.
- [ ] Subscribe to GHL webhooks (AppointmentCreate/Update, and call messages) so calls land in
      real time instead of on the cron. The app already has a webhook surface under
      `/api/webhooks/`; add the handler + register in GHL.
- [ ] Decide what to do with Google-Calendar-sourced appointments, which have no GHL rep.

## UNASSIGNED CALLS — age + recoverability, answered 2026-08-07

**Age.** 24 Mar → 4 Aug 2026. Mostly stale, but still leaking:
```
2026-08   2      2026-07  14      2026-06  21
2026-05  36      2026-04  23      2026-03   8
```
44 older than 90 days · 60 within 90 · 15 in the last 30 · 3 in the last week.
Rate is improving: August is 2 unattributed against 14 attributed (~13%); May was 36 vs 53 (~40%).

**Recoverability — checked all 104 against GHL, one appointment at a time:**
```
createdBy.source
  google_calendar        99   ← no rep in the GHL payload AT ALL
  contactdetails_page     5   ← booked in GHL, attributable
```
- [x] Backfilled the 5 (all Gage's). **99 remain, and none of them are Kelsey's** — Jack's
      hypothesis is disproven: they are externally-booked Google Calendar appointments landing
      on the shared "Kracked Retention - Intro Call" calendar (`teamMembers: []`).
- `scripts/backfill-call-rep.mjs` is re-runnable; it will pick up any future GHL-booked ones.

### [ ] The 99 need a decision, not a guess
GoHighLevel does not know who owns them, so nothing in GHL can fix this. Options:
  a. Assign team members to the "Kracked Retention - Intro Call" calendar in GHL, so future
     bookings carry an owner. Fixes it going forward, not retrospectively.
  b. Read the owner from the Google Calendar API (a different integration).
  c. Show an "Unattributed" row on the leaderboard so the total reconciles and the gap is visible.
Recommend (a) + (c): (a) stops the leak, (c) makes the remaining history honest.

### [ ] Real-time streaming (still open)
- [ ] Capture `createdBy.userId` in the appointment sync so new GHL-booked calls never land blank.
- [ ] GHL webhooks (AppointmentCreate/Update + call messages) → calls arrive in real time
      instead of on the 4×/day cron. Webhook surface already exists at `/api/webhooks/`.

## WHY THE CALLS ARE UNATTRIBUTED AT ALL — Jack's question, answered

Fair challenge: the person who booked it must be an attendee. Checked, and the answer is that
GoHighLevel does not hold that information for these.

The sync already had a four-level fallback: `assignedUserId` → attendee (`ev.users`) →
calendar owner → contact owner. **All four fail on the intro-call calendar:**
- `assignedUserId` — absent on every one of these events
- `ev.users` (the attendee array) — **empty `[]`**
- calendar owner — "Kracked Retention - Intro Call" has `teamMembers: []`
- contact owner — those contacts are largely unassigned

- [x] **Added `createdBy.userId` to the chain** (above calendar owner: who booked it is a
      stronger claim than who owns the calendar). Recovers every GHL-booked appointment
      automatically from now on. Deployed.

**It does not rescue the other 99.** They are Google-Calendar-synced and carry
`{source:"google_calendar"}` with no userId — GHL genuinely does not know. And their titles show
many are not sales calls at all: "KR Taxes", "LESLIE OOO", "Canceled", "KR Branding Alignment",
"Closers.io Consult w/ Gage Flesher". That calendar is mirroring a personal Google Calendar into
GHL wholesale.

Title-matching would attribute 33 of 99 (gage 25, alice 4, jack 3, kelsey 1) — deliberately NOT
done. "Closers.io Consult w/ Gage Flesher" is Gage attending someone else's call, and a wrong
name on a leaderboard is worse than a blank one.

### [ ] The real fix: read the Google Calendar attendee list
`lib/google/client.ts` already implements a Workspace service account with domain-wide
delegation and the `calendar` + `meetings.space.readonly` scopes — written for exactly this.
**It has never been configured:** production has 43 env vars and none named `GOOGLE_SERVICE_*`.
- [ ] Jack: create the service account, grant domain-wide delegation in Google Workspace Admin,
      set `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_SERVICE_ACCOUNT_KEY` / `GOOGLE_WORKSPACE_DOMAIN`.
- [ ] Then: match `calls.meeting_url` / `meet_conference_id` to the Google event and attribute
      from the real attendee list. That is the only source that actually knows who was in the room.

---

## BOOKED CALLS — 2026-08-07

Two separate things; only one was a bug.

**Not a bug:** the screenshot is the **August 5** summary. On 5 Aug there genuinely were 2.
The live number for 1-7 Aug was already 5 before any change.

**Was a bug:** `isBookedCallCalendar()` matched only `"intro call"` or `"demo"`, which excluded
every **Strategy Session / Clarity Call / Consult** calendar — real booked calls, taken by the
closer. Missed 1 of 6 in that window; structurally it dropped a whole category.
- [x] Widened to `intro call · demo · strategy · clarity call · consult`, with an explicit
      `personal calendar` exclusion. **1-7 Aug: 5 → 6.** Deployed.
- [x] The endpoint now returns `excludedCalendars` so the in/out split is auditable rather than
      buried in a regex. Currently excluded: *Bloo io's Personal Calendar*,
      *Kracked Retention: Email/SMS Audit Preperation*, *Free Email Design*.
- [ ] **Jack to confirm** those three are correctly excluded — it is a business definition,
      not a technical one. "Audit Preperation" in particular may be a real booked call.

## KELSEY'S GHL DIALS — could not find them via the API

Probed before designing anything on top of them:
- 621 messages across the 100 most recent conversations → types are `TYPE_CUSTOM_SMS` (313),
  `TYPE_EMAIL` (183), `TYPE_INSTAGRAM` (53), `TYPE_ACTIVITY_OPPORTUNITY` (50), `TYPE_SMS` (20),
  `TYPE_ACTIVITY_APPOINTMENT` (1), `TYPE_ACTIVITY_CONTACT` (1). **No `TYPE_CALL` at all.**
- `/phone-system/number-pools` → `{"pools": []}` — **no LC Phone numbers provisioned** on this location.
- `/calls/`, `/locations/{id}/phone-numbers` → 404. No dedicated call-log endpoint.

Our own dialer is Twilio (`calls.twilio_call_sid`, `campaign_id`), which is a different system.
- [ ] **Needs Jack:** how is Kelsey actually dialling? GHL's built-in LC Phone, a GHL dialer
      integration, or a third-party (Aircall/JustCall/etc.)? The answer decides the source.
      If it is LC Phone, the number pool being empty suggests the token cannot see it and we
      may need a scope or a different credential.

---

## CLOSERS vs SETTERS — proposed split (design, not yet built)

**Why split at all:** one leaderboard with one column set makes a setter look like a failing
closer. Kelsey's row reads 0/0/0/0 today not because she is idle but because every column
measures closing. Different jobs, different scoreboards.

**Layout:** two stacked full-width containers, "Setters" then "Closers" — Jack's own conclusion
that side-by-side leaves no room for columns is right. Each keeps the existing table, its own
columns, its own drilldowns.

**Role source:** `users.role` already carries `setter` / `closer` / `admin`. Gage is `admin` and
should appear under Closers — needs either a role change or an explicit override list.
Recommend adding a `scoreboard` column (`setter` | `closer` | `none`) rather than overloading
`role`, which also controls permissions. Changing someone's permissions to fix a leaderboard is
the kind of coupling that bites later.

### Setter columns (top of funnel — did they create opportunity?)
| Column | Source | Status |
|---|---|---|
| Dials | GHL/Twilio calls, outbound | **blocked** — see above |
| Conversations | contacts messaged in period | derivable from `local_messages` |
| Demos created | `activity_events` `demo.created` | **built today** |
| Appointments set | booked-calls, attributed to the setter | needs the attribution fix |
| Show rate | appointments that happened ÷ set | derivable once attribution lands |
| Qualified handed over | Meta stage → `qualified` by this user | `local_contacts.meta_lead_stage_by` |

### Closer columns (bottom of funnel — did they convert it?)
| Column | Source | Status |
|---|---|---|
| Calls taken | `calls` where rep = closer | works (attribution caveats) |
| Proposals sent | `proposals.created_by` + `sent_at` | works |
| Closed | `proposals.paid_at` | works |
| $ Closed | `sum(total_amount)` | works |
| Close rate | closed ÷ calls taken | derivable |
| Avg deal size | $ closed ÷ closed | derivable |
| Open pipeline | open opps assigned | works (ghost-filtered today) |

**Open questions for Jack before building:**
1. Is "appointments set" credited to the setter who booked it, or the closer who takes it?
   (Standard is: setter gets *set*, closer gets *taken* — same appointment, two scoreboards.)
2. Should show-rate sit on the setter (they set it) or the closer (they ran it)?
3. Does Kelsey get credit for a deal that closes off a demo she created? If yes, closers and
   setters both need an attribution trail back to the originating demo.
