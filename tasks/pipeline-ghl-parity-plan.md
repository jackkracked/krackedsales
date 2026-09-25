# Pipeline ↔ GoHighLevel parity

**Written 2026-08-13. Root cause is PROVEN against the live GHL API, not inferred.**

## The requirement (Jack, verbatim intent)

The app's pipeline must reflect GHL exactly. The same number of opportunities in every pipeline
and every stage, and the same opportunities — "one opportunity out is not good enough". Moves in
either system appear in the other. Near real-time. **Poll every stage of whichever pipeline is
open, every 5 seconds.**

Two hard constraints:
- **No GHL workflows.** In current GHL the only way to get webhooks is to build a workflow per
  trigger. Jack will not do that. Everything here must work with read-only API polling.
- **No long skeletons.** The board must paint instantly, not wait on GHL.

## ROOT CAUSE (proven)

**The opportunity sync is upsert-only. Nothing ever deletes.**

Jack's board showed 8 in "Invalid or missing URL" where GHL showed 0. Every mirror row in that
stage was fetched individually from GHL:

```
Nicole Reyes           -> GHL 404 (gone)
Georgie Sloggett       -> GHL 404 (gone)
Camalott Clark         -> GHL 404 (gone)
Mama Emma's Seasoning  -> GHL 404 (gone)
David Hayth            -> GHL 404 (gone)
Chianti                -> GHL 404 (gone)
```

All deleted in GHL, all still `deleted_in_ghl_at IS NULL` in `local_opportunities`. The column
exists, so deletion handling was intended — it is not working. Once an opportunity is deleted or
moved away in GHL, the mirror keeps it forever.

### Contributing defects
1. **`lib/pipeline/mirror-source.ts` has NO status filter.** The mirror holds `open 3475`,
   `won 104`, `abandoned 1`. GHL's board shows open. That is 105 opportunities of guaranteed
   over-count before staleness is considered.
2. **Soft-deleted rows are not excluded** — 98 rows carry `deleted_in_ghl_at` and still render.
   (Mirror had 6 live in that stage; the board showed 8, i.e. 2 soft-deleted ones rendered too.)
3. **Mirror total 3,580 live vs GHL `meta.total` 3,567** — 13 phantom rows overall.
4. `pipeline_name` and `stage_name` are NULL on all 3,678 rows (names resolved at render). Not a
   count bug, but it makes the mirror un-auditable without a join. Worth populating.

## VERIFIED API CAPABILITIES (probed live, 2026-08-13)

```
GET /opportunities/search?location_id=…&pipeline_id=X&pipeline_stage_id=Y&status=open&limit=1
    -> meta.total = exact count for that stage.   ← the whole design rests on this
```
Confirmed against Jack's screenshots:
```
Invalid or missing URL                 GHL 0    app showed 8
Unresponsive (Demo Not Started)        GHL 2    app showed 54
Unresponsive (Demo Not Started) - TP1  GHL 237  Jack's GHL screenshot: 235
```

Also established:
- **The feed is ordered by `createdAt`, NOT `updatedAt`.** Verified: createdAt strictly
  descending while updatedAt jumps around. So there is NO cheap "what changed since" query — a
  stage move does not move a deal in the list. Do not waste time trying; the count oracle exists
  precisely because this does not work.
- `sort`, `sortBy`, `sort[0][field]`, `date=updatedAt` → all 422/400. Not supported.
- Pagination is cursor-based: `startAfter=<epoch-ms>&startAfterId=…`.
- The Ad Funnel pipeline (`JRvrpfcwAlAOM38mPAUJ`) has **27 stages**, 2,290 total / 2,237 open.

### Rate limits (from response headers)
```
x-ratelimit-max:                    100        (burst)
x-ratelimit-interval-milliseconds:  10000      → 100 requests / 10 seconds
x-ratelimit-limit-daily:            200000
single count request latency:       ~339ms
```

## DESIGN

### Principle
**Render from the mirror instantly. Verify against GHL continuously. Repair silently.**
GHL is never in the page-load path — that is what prevents the long skeletons.

### Three tiers

**1. Tripwire — per-stage counts (every 5s, all stages of the open pipeline)**
One `limit=1` request per stage, read `meta.total`. Responses are tiny (a number), so this is
light on bandwidth even at 27 stages. Compare against the mirror's count for that stage.

**2. Repair — set reconciliation for a drifted stage**
When a stage's total disagrees, fetch that stage's opportunities from GHL and make the mirror
**set-equal**: insert missing, update changed, and **DELETE what GHL no longer has**. That last
step is the bug above and the entire point.

Counts alone are NOT sufficient and must never be the source of the board: one deal wrongly
present plus another wrongly missing cancel out, and the number looks perfect while the column is
wrong. The count only decides *which* stage to rebuild.

**3. Sweep — full ID-set reconcile per pipeline (hourly, background)**
Fetch every open opportunity id for the pipeline (~23 requests for 2,237) and make the mirror
set-equal. Catches equal-count-but-wrong-contents, which tier 1 cannot see.

### Budget at Jack's chosen cadence (27 stages / 5s)
```
5.4 req/s
burst: 54 per 10s window vs limit 100        → 54%, safe
daily: ~156,000 over an 8-hour open board    → 78% of 200,000
```
Leaves ~44,000/day for the other syncs. Workable, but the two mitigations below are MANDATORY,
not optional:

- **Server-side cache (~4s TTL).** Browsers poll OUR endpoint; our endpoint calls GHL at most
  once per TTL. The whole team then costs the same as one person. Without it, 4 concurrent users
  = 312% of the daily limit and every other sync starts failing.
- **Pause when `document.visibilityState !== "visible"`.** One tab left open overnight is
  16h × 5.4/s = the entire daily budget.

If the daily budget gets tight, 10s halves it to 39% with little perceptible difference.

### Outbound (app → GHL)
Already works: `PATCH /api/ghl/opportunities/{id}`. Moves made in the app are optimistic locally
and pushed immediately, so they feel instant. **Use the guarded `opp` pattern** — see the
2026-08-13 wrong-contact incident in `tasks/HANDOFF-proposal-dates.md`; PATCHing an opportunity
fires GHL automations that message the client.

## WORK

- [ ] **Fix the sync to delete.** Whatever runs `sync-ghl` must mark/remove opportunities GHL no
      longer returns. This alone fixes the reported bug.
- [ ] **Add filters to `lib/pipeline/mirror-source.ts`**: `status = 'open'` and
      `deleted_in_ghl_at IS NULL`. Quick, and removes 203 rows of over-count.
- [ ] Backfill `deleted_in_ghl_at` for the existing phantoms (the 6 proven 404s plus any others
      found by a full sweep). Dry-run and show Jack the list before committing.
- [ ] New endpoint: per-stage counts for a pipeline, server-cached ~4s.
- [ ] New endpoint: reconcile a single stage (set-equal, including deletes).
- [ ] Client polling on the pipeline page: 5s, all stages of the open pipeline, paused when
      hidden, silent repair — no skeleton, no layout jump.
- [ ] Hourly full ID-set sweep per pipeline.
- [ ] Populate `pipeline_name` / `stage_name` on sync so the mirror is auditable.

## OPEN QUESTION FOR JACK

**Card order within a column.** Set-equality guarantees the same 237 deals; it does not guarantee
the same ORDER. GHL sorts columns its own way and the app's sort has not been checked. If they
differ the columns hold identical deals in a different sequence, which will still look "wrong".
Confirm GHL's ordering and match it.

## DO NOT

- Do not put a GHL call in the page-load path. That is the long-skeleton failure.
- Do not let counts populate the board. They are a tripwire only.
- Do not try to build a delta feed from `updatedAt` — the endpoint cannot sort or filter by it.
- Do not poll without the visibility pause and the server cache.
