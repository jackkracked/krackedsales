# Pipeline parity: why "Repair was refused" appeared, and how to make it never lie again

Created 2026-09-12. Owner: Jack. Status: SHIPPED to production 2026-09-12 14:01 UTC (kracked-sales-fkqc6hqyx).

## The banner Jack saw

    Could not verify against GoHighLevel: Repair was refused

## Root cause — proven, not inferred

Reproduced end to end against production on 2026-09-12:

1. `/pipeline` mounts → `usePipelineParity` GETs `/api/cron/reconcile-opportunities`
   (1 GHL call, cheap). It reported `drift: 15`, so it POSTed the repair.
2. The repair walks the whole opportunity feed: **39 sequential GHL calls**.
3. GHL burst-limits the location and starts returning **429 Too Many Requests**.
4. `ghlFetchWithRetry` does retry 429, but its total backoff is **0.5s + 1s + 2s ≈ 3.5s**,
   which is *inside* GHL's ~10s burst window. All 4 attempts fail.
5. `reconcileOpportunities` throws. The route catches it and returns
   **HTTP 500 `{"error":"Reconcile failed"}`**.
6. The client sees `!fix.ok`, finds no `abortedReason`, and falls back to the string
   **"Repair was refused"** — describing a crash as a deliberate guard decision.

Captured live (after deliberately exhausting the rate limit):

    GET  /api/cron/reconcile-opportunities            -> HTTP 502 {"error":"Drift check failed","inSync":null}
    POST /api/cron/reconcile-opportunities?dryRun=1   -> HTTP 500 {"error":"Reconcile failed"}

That 500 is exactly the banner. Nothing "refused" anything: the guards never ran.

## Why it persisted for 16 days

- **Vercel crons only issue GET.** Both scheduled entries
  (`0 20 * * *`, `0 23 * * *`) therefore only run the *drift check* and throw the answer
  away. The "scheduled full sweeps still run twice a day" claim in the code comments is
  false — the sweep has never run on a schedule. Soft-delete history proves it:
  repairs on 2026-08-07, 08-13, 08-27, then nothing.
- **The only repair trigger is a human opening `/pipeline`**, and it fires on *every*
  mount while drift is non-zero. Each attempt is another 39-call burst, which sustains
  the rate limiting that makes it fail. Drift stays non-zero, so it tries again. A loop.
- Between 08-28 and 09-03 `/pipeline` crashed outright (the conditional-hook bug), so
  even the human trigger was unavailable.

## Data state as of 2026-09-12 (already corrected)

Ran the repair manually: 17 ghosts cleared, 2 inserted, 10 updated.
Each of the 17 was independently confirmed gone with a per-id `GET /opportunities/{id}`
returning 404 before anything was written. Verified after:

- ids, pipeline, stage and status: **100% parity, 3772 = 3772**, every stage of all 11 pipelines
- `local_pipelines` (the stage columns the board renders): **100% in sync**

## The fix

### 1. Survive GHL's rate limit — `lib/ghl/client.ts`
- [x] Honour the `Retry-After` header when GHL sends one.
- [x] Give 429 its own backoff that actually clears a ~10s window (2s, 5s, 11s, 20s)
      instead of the current 0.5/1/2s, and allow more attempts for reads.
- [x] Leave 5xx/network backoff as it is.

### 2. Stop bursting — `lib/ghl/reconcile-opportunities.ts`
- [x] Small delay between pages (~100ms). 39 pages costs ~4s more and stays well
      inside the burst window.
- [x] Return a structured failure (`ok: false, failed: true, failureReason`) instead of
      throwing, so a crash is distinguishable from a guard refusal.

### 3. Tell the truth — route + hook + banner
- [x] `app/api/cron/reconcile-opportunities/route.ts`: on exception return the real
      message and a `rateLimited` flag, not a bare "Reconcile failed".
- [x] `lib/hooks/use-pipeline-parity.ts`: separate `refused` (409, a guard decided) from
      `failed` (5xx, it broke), and carry the real reason.
- [x] `components/pipeline/pipeline-client.tsx`: distinct copy per state. A rate-limited
      run should read as "busy, will retry", not as an error.

### 4. Make the schedule actually repair
- [x] Vercel cron can only GET, so the repair moved to its own path,
      `/api/cron/reconcile-opportunities/sweep`, taking the `CRON_SECRET` bearer and nothing
      else. The original route's GET stays a cheap, read-only drift check, because the
      pipeline board hits it on every mount.

      CHANGED DURING REVIEW: the plan said to make the EXISTING GET mutate when a bearer is
      present. Rejected — it overloads one URL with two behaviours differing by 39x in cost
      and by "reads nothing" vs "soft-deletes production rows", switched by a header, on a
      URL the browser calls constantly. A separate path is unambiguous in the code and in
      the logs, and matches `app/api/cron/sync-ghl/route.ts`.
- [x] A third cron entry at `30 20`, because Vercel crons do not retry. It carries
      `?ifStale=1` so it respects the cooldown and does nothing when the 20:00 run succeeded.

### 5. Stop the retry loop, and make failures diagnosable
- [x] Server-side cooldown/lock so a sweep cannot be started while one is running or
      within N minutes of the last attempt. Page loads then cost 1 GHL call, not 39.
- [x] Persist each reconcile outcome (when, ok, counts, failure reason) so "when did this
      last succeed and why did it fail" is answerable without forensics. This is what
      made today's diagnosis expensive: Vercel keeps no runtime logs reachable by the
      team-scoped token.

## Out of scope, noted

`local_opportunities.pipeline_name` and `.stage_name` are NULL on all 3,927 rows and are
read by nothing (the board resolves names from `local_pipelines`). Dead columns. Leave
them, or drop them in a later pass. They do not affect a single number on the board.

## Verification before sign-off

- [x] Re-run the full stage audit: every stage of all 11 pipelines, GHL vs mirror.
- [x] Force a 429 and confirm the banner says "rate limited, retrying", not "refused".
- [x] Confirm a cron-shaped GET (bearer secret) performs a real repair.
- [x] `npx eslint` clean on every touched file (per the 2026-08-28 lesson).


## Shipped, and verified in production

Deployment `kracked-sales-fkqc6hqyx`, target production, READY, 2026-09-12 14:01 UTC.

- Migration 0054 applied before the deploy; `job_locks` present with all 8 columns.
- Auth: sweep route 401s with no secret and with a wrong secret; POST 401s with no session.
- The scheduled sweep RAN FOR THE FIRST TIME: 200 OK, 3774 fetched over 39 pages,
  2 inserted, 1 updated, 0 deleted, 17s.
- Run recording works: the drift GET now returns
  `lastRun: {status: "ok", detail: "0 removed, 2 added, 1 updated (3774 in GoHighLevel)"}`.
- Cooldown works: an admin POST straight after the sweep returned **202 in 0.45s** instead of
  starting another 39-call walk. That is the 16-day loop broken.
- Lock: 10 concurrent racers, exactly 1 winner; expired leases reclaimable.
- Concurrency gate: 40 concurrent calls peak at 3 in flight, 0 failures.
- Full rendered-path audit: **100% parity, every stage of all 11 pipelines**, 3774 = 3774,
  0 rows with NULL `raw_data`, 0 column-vs-`raw_data` stage disagreements.

Re-run the proof any time:
`node_modules/.bin/tsx --env-file=.env.verify scripts/audit-pipeline-parity.ts`

## Follow-ups deliberately NOT done

- No alert when a reconcile has not succeeded in over ~26 hours. The outcome is now recorded
  in `job_locks` and `ghl_sync_log`, but nothing surfaces it, so a future silent failure is
  still only visible to someone who looks. The daily Slack summary is the obvious home.
- `local_opportunities.pipeline_name` / `.stage_name` are NULL on every row and read by
  nothing. Dead columns, left alone.
- The concurrency gate is per function instance, so two instances can still collide. Real
  cross-instance fairness needs Redis or a DB token bucket.
