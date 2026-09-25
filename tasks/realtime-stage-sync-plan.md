# Real-time stage sync: one writer, many readers

Created 2026-09-17. Owner: Jack. Status: REVISED after staff review 2026-09-17. Awaiting sign-off.

Jack, 2026-09-17: "Gage moved the lead in GoHighLevel, our system still says New Lead."
And on architecture: *"Maybe we populate one place, and then all the other places populate
from that so we're not polling everything."* That is the shape of this plan.

## Why it was stale, proven

1. **No GoHighLevel event has ever reached the app.** `app/api/webhooks/ghl/route.ts` is fully
   built and handles `OpportunityStageUpdate`, but there are **zero** `opportunity.created` /
   `opportunity.updated` rows in `activity_events` across the entire history, and zero rows in
   `message_index` in the last 24h. GHL never calls it, because that needs a workflow per
   trigger and Jack has refused to maintain those. The receiver is dead code awaiting a caller.

2. **A stage move changes no total, so the on-load check is blind to it.** The parity check
   shipped on 2026-09-12 compares location-wide counts: 3806 before a move, 3806 after. It
   correctly reports "in sync" and never repairs, because the deal did not appear or disappear,
   it moved sideways. The one mechanism that runs on demand cannot see the one change that
   matters here.

3. So the mirror only learns about a stage move from `sync-ghl` (4x/day: 0, 6, 12, 18 UTC) or a
   full sweep (20:00, 20:30, 23:00 UTC). **Worst case lag ~6 hours**, which is what Jack saw.

4. **Pusher is not configured in production.** `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`
   and `NEXT_PUBLIC_PUSHER_KEY` are all absent; only the two cluster vars exist.
   `getPusherServer()` throws, `pusherTrigger` swallows it, the client never initialises. Every
   real-time claim in the codebase is currently inert, the notification bell included.

## The oracle this rests on (re-verified 2026-09-17)

```
GET /opportunities/search?location_id=…&pipeline_id=X&pipeline_stage_id=Y&status=open&limit=1
    -> meta.total = exact count for that stage,  ~367ms
```
A move from A to B changes TWO stage counts (A minus one, B plus one), so unlike the
location-wide total it is detectable. Ad Funnel has 29 stages.

## STEP 0, AND IT SHIPS FIRST: the app's own moves revert today

Independent of anything below, and already live. Traced through the code:

1. `lib/hooks/use-pipeline.ts:69-85` optimistically sets `pipelineStageId`. The board groups on
   exactly that field (`components/pipeline/kanban-board.tsx:343`), so the card moves.
2. `app/api/ghl/opportunities/[opportunityId]/route.ts` PATCHes GoHighLevel and **contains no
   database write at all**. Verified by grep: no `localOpportunities`, no `db()`, no upsert.
3. `onSettled` (use-pipeline.ts:95) invalidates `["opportunities"]`, which refetches
   `feed=mirror`, which still holds the OLD stage. **The card snaps back.**

The move succeeded in GHL. The board says it failed, and then disagrees with GHL until the
next sync. Every fix below is layered on top of this, so it goes first.

- [ ] On a successful `ghl.put`, upsert the row into `local_opportunities`: `raw_data`,
      `pipeline_stage_id`, `pipeline_id`, `status`, `stage_name`, and `deleted_in_ghl_at = NULL`.
- [ ] Do NOT reuse `lib/ghl/sync.ts` `upsertOpportunity`: its conflict set omits
      `deletedInGhlAt`, so a wrongly soft-deleted deal would stay invisible forever.
- [ ] Only then `invalidateQueries`, so the refetch reads the truth we just wrote.
- [ ] Verify: drag a card, watch through two poll cycles, prove ZERO position changes.

## Architecture: one writer, many readers

**`local_opportunities` is the single source.** Exactly one thing spends GoHighLevel budget;
every surface reads the mirror. No surface ever calls GHL for itself.

### Tier 1 — the only GHL poller (pipeline board open)
- [ ] `GET /api/pipeline/stage-counts?pipelineId=X` — reads a SHARED counts table and returns
      instantly. It never calls GHL itself.
- [ ] **The cache must live in Neon, not module memory.** An in-memory cache does NOT make ten
      users cost the same as one: Vercel module state is per instance, concurrent pollers land
      on separate instances with cold caches, and an 8s TTL under a 10s interval never hits for
      a single user anyway. Use the proven `job_locks` pattern: a `stage_counts` table keyed
      `(pipeline_id, stage_id)` with `count` and `checked_at`; whoever wins
      `acquireJobLock("stage-counts:{pipelineId}", 30)` refreshes it when `checked_at` is older
      than ~8s, and everyone else just reads the row. That is Jack's "populate one place"
      applied to the counts, and it makes cost genuinely independent of user count.
- [ ] **Count the mirror side by `raw_data->>'pipelineStageId'`**, under mirror-source's exact
      predicate (`pipeline_id`, `deleted_in_ghl_at IS NULL`, `status = 'open'`). Counting the
      `pipeline_stage_id` COLUMN would report "in sync" while the board draws cards in the
      wrong column, which is the same blindness in a new costume.
- [ ] **429 handling:** the route classifies rate limits and returns `retryAfterMs`; the client
      backs off exponentially and trips a circuit breaker after N consecutive failures.
      **Partial count failures must never read as mismatches**, or 5 failed counts out of 29
      fire 5 spurious repairs at exactly the moment GHL is refusing us.
- [ ] Client polls it every **10s**, and **pauses when `document.visibilityState !== "visible"`**.
      Both are mandatory: without the cache four users exceed the daily budget, and without the
      pause one tab left open overnight does.
- [ ] On a per-stage mismatch, repair only that stage (below). No mismatch, no further calls.

### Tier 2 — repairing one stage, exactly
- [ ] `POST /api/pipeline/reconcile-stage` with `{pipelineId, stageId}`:
  1. Fetch that stage's opportunities from GHL and upsert them. Fixes every deal that moved IN.
  2. For mirror rows still claiming that stage but absent from GHL's list, the deal moved OUT.
     Do NOT delete: `GET /opportunities/{id}` individually to learn its true stage, or
     soft-delete only on a genuine 404 (the rule established 2026-09-12).
- [ ] **Repair the GAINING stage first.** A move dirties two stages, and fixing the gainer
      clears both mismatches without spending any per-id calls.
- [ ] **Write set is explicit**, because this repo has already shipped the bug of updating a
      column nobody reads: `raw_data` (the board renders from it), plus `pipeline_id`,
      `pipeline_stage_id`, `status`, `stage_name`, `pipeline_name`, `deleted_in_ghl_at = NULL`.
      A deal moved to a DIFFERENT pipeline needs both `raw_data` and `pipeline_id` written, or
      it lands in a phantom "Unknown Stage" column.
- [ ] **Short-read guard, same as the full sweep.** If `fetched < meta.total` for the stage,
      refuse and change nothing. Walk `meta.nextPageUrl`, NOT `page=N`.
      **Never use `lib/ghl/paginate.ts` here**: it catches its own failures and returns partial
      data, so a failure on page 4 of 11 would turn ~700 live deals into "absent" candidates
      and fire ~700 per-id calls from a single 10s poll.
- [ ] **Cap the absent-candidate set at ~25.** Above that, refuse and leave it to the sweep.
- [ ] **Skip stages over ~500 deals entirely** (one holds 1041). They cannot be reconciled
      inside a 10s cadence; the nightly sweep owns them.
- [ ] **Snapshot guard:** record `startedAt` before the GHL fetch and never upsert a row whose
      `updated_at > startedAt`. Without it, a repair that started before a user's drag lands
      after it and silently reverts their move. Same pattern as the sweep's delete guard.
- [ ] **Quiet window:** suppress repair of an opportunity for ~10s after a local PATCH, so
      GHL's eventually-consistent search index cannot flip the card A-B-A-B.

### Locking: a SEPARATE key, and never the sweep's
- [ ] Key per stage: `stage-repair:{pipelineId}:{stageId}`, TTL 30-60s. Sharing the sweep's
      `reconcile-opportunities` key causes three concrete failures: the sweep holds its lease
      for up to 330s and starves every repair while the poller burns 29 counts every 10s
      competing for the same budget; the repair's `releaseJobLock` writes `last_finished_at`
      and so permanently trips the sweep's 10-minute cooldown; and the board's "last verified"
      line starts reporting a single stage check as if it were a full sweep.
- [ ] **Read** the sweep's lock instead. If `lockedUntil > now()`, `/api/pipeline/stage-counts`
      returns `{deferred: true, retryAfterMs}` and the client stops polling. Zero GHL calls
      while the sweep owns the budget.
- [ ] **Per-stage failure backoff.** If a repair leaves the stage still mismatched, suppress
      that stage for 60s, doubling to ~10min. Without this, a stage the search feed omits
      (proven to happen in this location) mismatches forever and fires a repair every 10
      seconds: the 2026-09-12 loop at thirty times the cadence.

### Tier 3 — single-opportunity freshness for cards
- [ ] **Extend the EXISTING `app/api/ghl/opportunities/[opportunityId]` GET**, which already
      does exactly one `GET /opportunities/{id}`. It only lacks the mirror write. Adding a
      second endpoint for the same GHL resource is the duplication this whole effort exists to
      remove.
- [ ] **Verify the single-GET response shape first.** It returns `{opportunity: {...}}`, a
      different shape from the search feed. If it omits the `contact` sub-object, writing it
      straight into `raw_data` blanks the name, email and phone on every card and breaks both
      the board's search filter and the `?contact=` auto-open. If `contact` is absent, MERGE
      into the existing `raw_data` rather than replacing it.
- [ ] Clear `deleted_in_ghl_at` on a 200.
- [ ] **Fire on an explicit single-card open only, never on list render.** A list mounting 60
      rows would queue 60 calls behind a gate of 3; the tail exceeds the 15s slot timeout,
      throws, and is then RETRIED up to 4 times: ~240 attempts from one screen. Dedupe by id
      with an in-flight map and a 30s already-refreshed memo.

### Tier 4 — the backstop (already shipped)
The scheduled sweeps of 2026-09-12 stay as they are and catch anything the above misses.

### Fan-out: how every other surface updates
Every write above lands in the mirror, and the mirror is what the dashboard, KPIs, contact
cards and inbox already read. Two ways to make them notice, and they are not exclusive:

- [ ] **Now, no credentials needed:** the repair endpoints return the changed opportunity ids,
      and the client patches those rows with `setQueryData`. **Do not blanket-invalidate
      `["opportunities"]` every 10s**: that refetch pulls every live row's `raw_data` jsonb for
      the pipeline, which at ~2,400 deals is a multi-megabyte Neon response and a full
      re-render, per user, per cycle. Invalidate only when the changed set is large or unknown.
- [ ] **Better, needs Jack:** set `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET` and
      `NEXT_PUBLIC_PUSHER_KEY` in Vercel. Then the repair broadcasts `opportunity.stage_changed`
      and every open surface updates instantly with no polling of anything at all. The server
      helper and the client pattern both already exist. Until those four vars are set, do not
      claim anywhere in the UI or the comments that pushing works.

## MEASURED: a poll cycle is slower than it looks (2026-09-17)

One full cycle of all 29 Ad Funnel stage counts, through the real client with its
`MAX_IN_FLIGHT = 3` gate:

```
run 1: 29 counts in 3923ms   peak in-flight 3   headroom vs 10s = 6.1s
run 2: 29 counts in 6198ms   peak in-flight 3   headroom vs 10s = 3.8s
```

It fits inside 10s, but run 2 consumed most of the window, so a slow GHL day WILL exceed it.
Two consequences the implementation must honour:

- **Drive the client interval from COMPLETION, never `setInterval`.** Schedule the next poll
  10s after the previous one finishes, and never allow two in flight. A fixed interval will
  overlap and pile up, and each pile-up multiplies GHL load exactly when GHL is already slow.
- **Serve the endpoint stale-while-revalidate.** The browser must never wait 6s for a board
  tripwire. Return the cached counts immediately and refresh behind them; the client's latency
  is then ~0 and only the refresh costs GHL calls.

## Budget at 10s, 29 stages, and why the 42% is optimistic

```
29 x 6/min x 60 x 8h = ~83,500/day = 42% of 200,000
```
That arithmetic is right and the conclusion is not. It counts **Tier 1 only, one cache-warm
poller**. It excludes Tier 2 repairs, Tier 3 refreshes, four daily `sync-ghl` runs, three daily
sweeps (~39 pages plus per-id calls each), and the contacts, KPI and inbox pages, all drawing on
the same 200,000. The "58% headroom" is already partly spent.

- [ ] **Measure current daily GHL call volume BEFORE committing to the cadence.** If the
      baseline is already heavy, start at 15s or 30s. The lag drops from ~6 hours to half a
      minute either way, which is the win; 10s versus 30s is a refinement.

## Authorisation and throttling
- [ ] Decide who may trigger Tier 2. The full sweep is admin-only precisely because any
      logged-in user firing it in a loop was the 2026-09-12 incident. Tier 2 is a
      GHL-spending write fired automatically by every rep's browser every 10 seconds.
      Gate it by role or put a hard per-session throttle in front of it, and record who fired it.

## Observability
- [ ] The sweep writes `ghl_sync_log` and `job_locks.last_detail`; the stage path must write
      something equivalent, or "is the poller alive, how many repairs fired, which stage keeps
      failing" is unanswerable. The shared counts table gives this for free.

## Correct the lies while we are here
- [ ] `lib/hooks/use-pipeline.ts:41` comment claims Pusher pushes stage changes in real time.
      It does not, and Pusher is not even configured. Fix the comment or make it true.
- [ ] Drop that hook's `refetchInterval: 3 * 60 * 1000` to `false` while the stage poller is
      active, or the board pays for two independent pollers.
- [ ] Stage ids come from `local_pipelines.stages`, refreshed only by `sync-ghl` 4x/day. A
      stage ADDED in GHL is therefore never polled, and a deal moved into it vanishes from the
      board with no tripwire. Refresh pipelines on the poller's first tick.

## Verification
- [ ] Move a deal in GHL, watch it land in the app inside ~10s without a refresh.
- [ ] Move one in the app, confirm it still reaches GHL and does not bounce back.
- [ ] Open a contact card for a deal moved in GHL seconds earlier: correct stage immediately.
- [ ] Confirm counts hold: run `scripts/audit-pipeline-parity.ts`, expect 100%.
- [ ] Leave a tab hidden for 10 minutes and confirm GHL call volume drops to zero.
- [ ] Four browsers on the board at once must not multiply GHL calls (cache proof).
- [ ] Two stages mismatched at once, both repaired in one cycle.
- [ ] A deal moved to a DIFFERENT pipeline: lands in the right pipeline, not "Unknown Stage".
- [ ] An open-to-won transition: disappears from the board, matching GHL's Open tab.
- [ ] GHL 429 for 60s: the board backs off, and must NOT claim "in sync".
- [ ] A stage whose count never converges: backs off, does not loop every 10s.
- [ ] The known blind spot, documented not fixed: one deal moving IN and another OUT of the
      same stage inside one 10s window leaves the count unchanged and the column wrong until
      the nightly sweep. Rare, real, and accepted.

## DO NOT
- Do not put a GHL call in the page-load path — that is the long-skeleton failure.
- Do not let counts populate the board. They are a tripwire only; one deal wrongly present
  plus one wrongly missing cancel out and the number looks perfect while the column is wrong.
- Do not build a delta feed from `updatedAt`. The feed sorts by `createdAt` and rejects every
  sort parameter. Proven 2026-08-13, do not spend time on it again.
- Do not delete a mirror row because it vanished from a stage listing. Re-read it by id first.
