import { NextResponse } from "next/server";
import { reconcileOpportunities, type ReconcileResult } from "@/lib/ghl/reconcile-opportunities";
import { acquireJobLock, readJobState, releaseJobLock } from "@/lib/jobs/lock";
import { db } from "@/lib/db";
import { ghlSyncLog } from "@/lib/db/schema";

export const RECONCILE_LOCK_KEY = "reconcile-opportunities";
/** Longer than the worst realistic sweep, so a function killed at maxDuration still frees it. */
const LOCK_TTL_SECONDS = 330;
/**
 * How long a user-triggered sweep waits after an attempt that did not succeed.
 *
 * Without this, a failed sweep leaves drift in place, so the NEXT page load starts another
 * ~39-call walk, which keeps GHL rate-limiting us, which keeps the sweep failing. That loop
 * is what Jack was looking at on 2026-09-12. The scheduled run ignores the cooldown.
 */
export const BROWSER_COOLDOWN_MS = 10 * 60 * 1000;

/** The one line a human should read about a finished run. */
function describe(r: ReconcileResult): string {
  if (r.failed) return r.failureReason ?? "the check could not complete";
  if (!r.ok) return r.abortedReason ?? "a safety guard stopped the repair";
  return `${r.markedDeleted} removed, ${r.inserted} added, ${r.updated} updated (${r.ghlTotal} in GoHighLevel)`;
}

/** Append to the existing sync history, so the outcome survives the request. */
async function recordRun(result: ReconcileResult, trigger: string, startedAt: Date): Promise<void> {
  await db().insert(ghlSyncLog).values({
    entity: "opportunities_reconcile",
    status: result.failed ? "failed" : result.ok ? "success" : "refused",
    totalRecords: result.ghlTotal,
    syncedRecords: result.fetched,
    error: result.failed
      ? `[${trigger}] ${result.failureReason ?? "failed"}`
      : result.ok
        ? null
        : `[${trigger}] ${result.abortedReason ?? "refused"}`,
    startedAt,
    completedAt: new Date(),
  });
}

/**
 * Run one parity sweep, at most one at a time across the whole deployment, and record it.
 *
 * Shared by the user-triggered POST and the scheduled GET so the lock is genuinely global:
 * two entry points with two locks would be no lock at all.
 */
export async function runGuardedSweep(
  { dryRun, respectCooldown, trigger }: { dryRun: boolean; respectCooldown: boolean; trigger: string },
): Promise<NextResponse> {
  if (respectCooldown) {
    const state = await readJobState(RECONCILE_LOCK_KEY).catch(() => null);
    const startedMs = state?.lastStartedAt?.getTime();
    const finishedMs = state?.lastFinishedAt?.getTime();
    // A run killed at maxDuration never reaches releaseJobLock, so it records a START and no
    // FINISH. Without spotting that, the cooldown is skipped in exactly the case it exists
    // for: the sweep is being killed because GHL is slow, and we would immediately launch
    // another one.
    const diedMidRun = startedMs != null && (finishedMs == null || startedMs > finishedMs);
    const lastAttemptMs = diedMidRun ? startedMs : finishedMs;

    // Cool down after EVERY attempt, not just unsuccessful ones. A sweep can return `ok`
    // while drift stays non-zero forever — that is the `feedLied` case, where a deal is live
    // in GHL but missing from the search feed, so the repair correctly refuses to delete it
    // and the totals never reconcile. Cooling down only on failure meant that deal re-fired
    // a full ~39-call walk on every single page load: the 2026-09-12 loop, wearing a success
    // badge. In the healthy case a successful repair drives drift to zero, the next GET
    // reports in-sync, and no repair is requested at all, so this costs nothing.
    if (lastAttemptMs != null) {
      const waited = Date.now() - lastAttemptMs;
      if (waited < BROWSER_COOLDOWN_MS) {
        return NextResponse.json(
          {
            busy: true,
            reason: diedMidRun
              ? "the last check did not finish"
              : state?.lastDetail ?? "a check ran recently",
            retryAfterMs: BROWSER_COOLDOWN_MS - waited,
          },
          { status: 202 },
        );
      }
    }
  }

  let gotLock: boolean;
  try {
    gotLock = await acquireJobLock(RECONCILE_LOCK_KEY, LOCK_TTL_SECONDS);
  } catch (err) {
    // The likely one on deploy day is "relation job_locks does not exist", if the code ships
    // before the migration is applied. Escaping here would be a bare 500, which the banner
    // would render as a refusal — the very lie this change removes.
    console.error("[pipeline/reconcile] could not take the lock", err);
    return NextResponse.json(
      { error: "Reconcile failed", failed: true, failureReason: "The check could not be started." },
      { status: 503 },
    );
  }
  if (!gotLock) {
    // Tell the client when the lease actually expires. A flat 30s against a job that can
    // hold the lock for 300s means ~10 pointless polls, each costing a GHL call, at exactly
    // the moment GoHighLevel is refusing us.
    const held = await readJobState(RECONCILE_LOCK_KEY).catch(() => null);
    const remaining = held?.lockedUntil ? held.lockedUntil.getTime() - Date.now() : 0;
    return NextResponse.json(
      {
        busy: true,
        reason: "a check is already running",
        retryAfterMs: Math.min(Math.max(remaining, 15_000), 5 * 60_000),
      },
      { status: 202 },
    );
  }

  const startedAt = new Date();
  try {
    const result = await reconcileOpportunities({ dryRun });
    const status = result.failed ? "failed" : result.ok ? "ok" : "refused";
    // `deleteSample` carries opportunity ids and customer names. Useful in an admin's
    // response and in the server log, but there is no consumer for it in the stored record,
    // so it is not worth parking customer data in a new table indefinitely.
    const storedResult = { ...result, deleteSample: undefined };
    await releaseJobLock(RECONCILE_LOCK_KEY, { status, detail: describe(result), result: storedResult })
      .catch((e) => console.error("[pipeline/reconcile] could not release lock", e));
    await recordRun(result, trigger, startedAt)
      .catch((e) => console.error("[pipeline/reconcile] could not record run", e));

    if (result.failed) {
      // Broke, did not refuse. Say which, and say why.
      console.error(`[pipeline/reconcile] FAILED (${trigger}): ${result.failureReason}`, { rateLimited: result.rateLimited });
      return NextResponse.json(result, { status: 503 });
    }
    if (!result.ok) {
      // Refused, not failed. The mirror is untouched. This is a guard doing its job and it
      // should be loud rather than silent.
      console.error(`[pipeline/reconcile] ABORTED (${trigger}): ${result.abortedReason}`, result);
      return NextResponse.json(result, { status: 409 });
    }
    console.log(
      `[pipeline/reconcile] (${trigger})${dryRun ? " DRY RUN" : ""} ghl=${result.ghlTotal} fetched=${result.fetched} ` +
        `insert=${result.inserted} update=${result.updated} delete=${result.markedDeleted} ` +
        `restore=${result.restored} in ${result.durationMs}ms`,
    );
    return NextResponse.json(result);
  } catch (err) {
    // reconcileOpportunities does not throw, so this is a lock or DB problem. Still must not
    // leave the lease held for its full TTL.
    console.error("[pipeline/reconcile] unexpected", err);
    await releaseJobLock(RECONCILE_LOCK_KEY, {
      status: "failed",
      detail: "an internal error stopped the check",
    }).catch(() => {});
    return NextResponse.json(
      { error: "Reconcile failed", failed: true, failureReason: "An internal error stopped the check." },
      { status: 503 },
    );
  }
}
