/**
 * A lease-based lock for background jobs, safe on the Neon HTTP driver.
 *
 * WHY NOT AN ADVISORY LOCK
 * `pg_try_advisory_lock` is session-scoped, and the HTTP driver gives every statement its
 * own session. The lock would be released the instant the statement returned, which is
 * worse than useless: it would look like it worked.
 *
 * WHY A LEASE AND NOT A FLAG
 * A Vercel function that times out or is killed cannot run a `finally`, so anything that
 * relies on the holder releasing the lock eventually wedges forever. A lease expires on
 * its own. Pick a TTL comfortably longer than the job's worst realistic run.
 *
 * The acquire is ONE statement, so two callers racing cannot both win: Postgres applies
 * the conditional update to one of them and the other's WHERE no longer matches, so it
 * gets no row back.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export type JobStatus = "ok" | "refused" | "failed";

export interface JobState {
  lockedUntil: Date | null;
  lastStartedAt: Date | null;
  lastFinishedAt: Date | null;
  lastOk: boolean | null;
  lastStatus: JobStatus | null;
  lastDetail: string | null;
}

/**
 * Try to take the lock. Returns true only if this caller now holds it.
 *
 * Takes it when no one holds it, or when the previous holder's lease has expired.
 */
export async function acquireJobLock(key: string, ttlSeconds: number): Promise<boolean> {
  const rows = await db().execute<{ key: string }>(sql`
    INSERT INTO job_locks (key, locked_until, last_started_at)
    VALUES (${key}, now() + make_interval(secs => ${ttlSeconds}), now())
    ON CONFLICT (key) DO UPDATE
      SET locked_until    = now() + make_interval(secs => ${ttlSeconds}),
          last_started_at = now()
      WHERE job_locks.locked_until IS NULL
         OR job_locks.locked_until < now()
    RETURNING key
  `);
  return (rows.rows ?? []).length > 0;
}

/** Release the lock and record how the run ended. */
export async function releaseJobLock(
  key: string,
  outcome: { status: JobStatus; detail: string; result?: unknown },
): Promise<void> {
  await db().execute(sql`
    UPDATE job_locks
       SET locked_until     = NULL,
           last_finished_at = now(),
           last_ok          = ${outcome.status === "ok"},
           last_status      = ${outcome.status},
           last_detail      = ${outcome.detail},
           last_result      = ${JSON.stringify(outcome.result ?? null)}::jsonb
     WHERE key = ${key}
  `);
}

/** Read the current state without touching it. */
export async function readJobState(key: string): Promise<JobState | null> {
  const rows = await db().execute<{
    locked_until: string | null;
    last_started_at: string | null;
    last_finished_at: string | null;
    last_ok: boolean | null;
    last_status: string | null;
    last_detail: string | null;
  }>(sql`
    SELECT locked_until, last_started_at, last_finished_at, last_ok, last_status, last_detail
      FROM job_locks WHERE key = ${key}
  `);
  const r = (rows.rows ?? [])[0];
  if (!r) return null;
  const date = (v: string | null) => (v ? new Date(v) : null);
  return {
    lockedUntil: date(r.locked_until),
    lastStartedAt: date(r.last_started_at),
    lastFinishedAt: date(r.last_finished_at),
    lastOk: r.last_ok,
    lastStatus: (r.last_status as JobStatus | null) ?? null,
    lastDetail: r.last_detail,
  };
}
