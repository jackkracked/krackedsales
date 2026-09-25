// GHL v2 API — works with private integration tokens (pit-* format)
const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

function getHeaders() {
  const token = process.env.GHL_PRIVATE_TOKEN;
  if (!token) throw new Error("GHL_PRIVATE_TOKEN is not set");
  return {
    Authorization: `Bearer ${token}`,
    Version: GHL_VERSION,
    "Content-Type": "application/json",
  };
}

/** A GHL HTTP error that carries the status code, so the retry layer can decide. */
export class GHLError extends Error {
  status: number;
  /** From a `Retry-After` header, when GHL tells us how long to wait. */
  retryAfterMs?: number;
  constructor(status: number, message: string, retryAfterMs?: number) {
    super(message);
    this.name = "GHLError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** True when this error is GHL refusing us for going too fast. */
export function isRateLimit(err: unknown): boolean {
  return err instanceof GHLError && err.status === 429;
}

/** `Retry-After` is either a number of seconds or an HTTP date. Returns ms, or undefined. */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const when = Date.parse(header);
  return Number.isNaN(when) ? undefined : Math.max(0, when - Date.now());
}

/** Per-attempt timeout. GHL's gateway sometimes hangs ("connection timeout"); a
 *  bounded attempt turns a hang into a retryable failure instead of stalling. */
const ATTEMPT_TIMEOUT_MS = 20_000;

async function ghlFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${GHL_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers: { ...getHeaders(), ...(options.headers ?? {}) },
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new GHLError(
      res.status,
      `GHL API error ${res.status} on ${path}: ${body}`,
      parseRetryAfter(res.headers.get("retry-after")),
    );
  }

  return res.json() as Promise<T>;
}

/**
 * Cap on GHL requests in flight from this function instance at any moment.
 *
 * THIS IS THE FIX FOR THE 429s, and it belongs here rather than in any one caller.
 * `lib/ghl/paginate.ts` fans every remaining page out with a single `Promise.all`, which at
 * 3,772 opportunities is ~37 requests in one tick, from routes a user can trigger by loading
 * /contacts or a KPI page. GHL burst-limits per LOCATION (~100 requests / 10s), so those
 * bursts rate-limit everything else sharing the budget — including the pipeline parity sweep,
 * which is how Jack got "Repair was refused" on 2026-09-12.
 *
 * Putting the gate in the client means every existing caller inherits it with no edit, and
 * `Promise.all` fan-out becomes "queued, a few at a time" instead of "all at once".
 *
 * Honest limitation, so nobody mistakes this for a rate limiter: it caps CONCURRENCY, not
 * requests per second, and the module state is per route bundle per function instance. It
 * flattens the spike that caused this incident. It does not make 429s impossible, and the
 * retry ladder below is still what carries a call through one. Real cross-instance fairness
 * would need Redis or a DB token bucket.
 */
// 3, not 6. At the ~350ms per-call latency this location measures, 6 in flight sustains
// ~17 req/s = ~170 per 10s, which is OVER the limit it is meant to respect. 3 lands around
// ~8.5 req/s. The gate flattens a `Promise.all` spike; the retry ladder handles the rest.
const MAX_IN_FLIGHT = 3;
/** How long a queued request waits for a slot before giving up. */
const SLOT_WAIT_TIMEOUT_MS = 15_000;

let inFlight = 0;
/** Each entry takes the offered slot and returns true, or returns false if it already gave up. */
const waiting: Array<() => boolean> = [];

function releaseSlot(): void {
  // Transfer the slot rather than freeing it, so the count never dips and lets a fresh
  // caller barge ahead of whoever has been waiting longest. Skip entries that timed out,
  // otherwise the slot is handed to a dead waiter and leaks.
  while (waiting.length) {
    const next = waiting.shift()!;
    if (next()) return;
  }
  inFlight--;
}

/**
 * Run `fn` holding one of the limited slots.
 *
 * A helper rather than acquire/release calls, so there is no way to add a line between
 * taking a slot and the try/finally that gives it back.
 *
 * The wait is bounded: queue time is invisible to the per-attempt timeout and to the
 * caller's function budget, so an unbounded queue could park an interactive request for
 * minutes with nothing noticing. Giving up throws a status-0 GHLError, which the retry
 * layer already treats as transient.
 */
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight++;
  } else {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const i = waiting.indexOf(entry);
        if (i >= 0) waiting.splice(i, 1);
        reject(new GHLError(0, "timed out waiting for a GHL request slot"));
      }, SLOT_WAIT_TIMEOUT_MS);
      const entry = (): boolean => {
        if (settled) return false;
        settled = true;
        clearTimeout(timer);
        resolve();
        return true;
      };
      waiting.push(entry);
    });
  }
  try {
    return await fn();
  } finally {
    releaseSlot();
  }
}

/**
 * How hard to try. A 429 needs its own ladder.
 *
 * GHL burst-limits per location at roughly 100 requests per 10 seconds, so a rate-limited
 * call has to outlast that window to have any chance. The old ladder (0.5s, 1s, 2s) spent
 * every attempt INSIDE it, so a 429 could only ever end in failure.
 *
 * `default` deliberately does NOT wait the window out. Most callers are on a user-interactive
 * path with a 30s (or shorter) function budget — `app/api/contacts` and the kanban drag in
 * `app/api/ghl/opportunities/[opportunityId]` among them — and turning a 3s error into a 30s
 * platform timeout with no readable body is a worse outcome, not a better one. Fast, honest
 * failure there; patience only where something is genuinely waiting in the background.
 */
export type RetryPolicy = "default" | "patient";

/** Longest single backoff each policy may take, whatever `Retry-After` asks for. */
const MAX_BACKOFF_MS: Record<RetryPolicy, number> = {
  default: 2_000,
  patient: 30_000,
};

const RATE_LIMIT_DELAYS_MS: Record<RetryPolicy, number[]> = {
  default: [500, 1_000, 2_000],
  patient: [2_000, 5_000, 11_000, 20_000, 30_000],
};

async function ghlFetchWithRetry<T>(
  path: string,
  options: RequestInit = {},
  policy: RetryPolicy = "default",
): Promise<T> {
  const rateLimitDelays = RATE_LIMIT_DELAYS_MS[policy];
  // One attempt, then one per delay in the ladder.
  const retries = policy === "patient" ? rateLimitDelays.length + 1 : 4;
  let lastErr: unknown;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await withSlot(() => ghlFetch<T>(path, options));
    } catch (err) {
      lastErr = err;
      // Retry transient failures only: rate limits (429), GHL gateway/upstream
      // errors (5xx — "no healthy upstream", "upstream connect error"), and
      // network/timeout/abort errors (which throw a non-GHLError, status 0).
      // GHL's 5xx gateway errors mean the request never reached the backend, so
      // retrying is safe even for writes. A 4xx (e.g. 404/422) is deterministic
      // and rethrown immediately — no point retrying.
      const status = err instanceof GHLError ? err.status : 0;
      // status 0 = a network/timeout/abort error (fetch threw, not an HTTP status).
      const isTransient = status === 0 || status === 429 || status >= 500;
      if (!isTransient || attempt === retries - 1) throw err;

      let delay: number;
      if (status === 429) {
        // Believe GHL's own Retry-After when it sends one; otherwise wait out the window.
        // Capped per policy: an interactive route must fail fast rather than sit through a
        // 60-second Retry-After and get killed by the platform with an unreadable 504.
        const told = err instanceof GHLError ? err.retryAfterMs : undefined;
        const ladder = rateLimitDelays[attempt] ?? rateLimitDelays[rateLimitDelays.length - 1];
        // Floored: a `Retry-After: 0`, or an HTTP date already in the past through clock
        // skew, would otherwise fire every remaining attempt back to back.
        delay = Math.max(500, Math.min(told ?? ladder, MAX_BACKOFF_MS[policy]));
      } else {
        // Exponential backoff (0.5s, 1s, 2s) for everything else.
        delay = Math.min(2 ** attempt * 500, 4000);
      }
      // Jitter spreads concurrent retries so they do not re-collide.
      await new Promise((r) => setTimeout(r, delay + Math.floor(Math.random() * 250)));
    }
  }
  throw lastErr ?? new Error("GHL fetch failed after retries");
}

export const ghl = {
  get: <T>(path: string) => ghlFetchWithRetry<T>(path),
  /**
   * A GET that waits out a rate limit instead of failing fast.
   *
   * Only for background work with no one watching: a single call can take ~68s of backoff
   * before it gives up. Never put this on a path a user is waiting on.
   */
  getPatient: <T>(path: string) => ghlFetchWithRetry<T>(path, {}, "patient"),
  post: <T>(path: string, body: unknown) =>
    ghlFetchWithRetry<T>(path, { method: "POST", body: JSON.stringify(body) }),
  /**
   * POST exactly once, with NO retry.
   *
   * `post` retries on "status 0", which includes this client's own 20s abort. That is safe for a
   * read and safe for a 5xx (the request never reached GHL's backend), but it is NOT safe for a
   * non-idempotent write: GHL regularly takes longer than 20s under load, completes the write,
   * and only then loses the race with our AbortController. The retry then submits the same
   * create again and the customer ends up with two records, each firing that stage's automations.
   *
   * Use this for any write that creates something. Callers must handle a timeout by re-reading
   * to find out whether the write actually landed, rather than assuming it did not.
   */
  postOnce: <T>(path: string, body: unknown) =>
    // Still goes through the slot gate — a write that bypassed it would make the cap a
    // suggestion — but deliberately keeps its single-attempt, no-retry behaviour.
    withSlot(() => ghlFetch<T>(path, { method: "POST", body: JSON.stringify(body) })),
  put: <T>(path: string, body: unknown) =>
    ghlFetchWithRetry<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    ghlFetchWithRetry<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
};

export function locationId(): string {
  const id = process.env.GHL_LOCATION_ID;
  if (!id) throw new Error("GHL_LOCATION_ID is not set");
  return id;
}
