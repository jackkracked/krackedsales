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
class GHLError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "GHLError";
    this.status = status;
  }
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
    throw new GHLError(res.status, `GHL API error ${res.status} on ${path}: ${body}`);
  }

  return res.json() as Promise<T>;
}

async function ghlFetchWithRetry<T>(
  path: string,
  options: RequestInit = {},
  retries = 4
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await ghlFetch<T>(path, options);
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
      // Exponential backoff (0.5s, 1s, 2s) with jitter to spread concurrent retries.
      const delay = Math.min(2 ** attempt * 500, 4000) + Math.floor(Math.random() * 250);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr ?? new Error("GHL fetch failed after retries");
}

export const ghl = {
  get: <T>(path: string) => ghlFetchWithRetry<T>(path),
  post: <T>(path: string, body: unknown) =>
    ghlFetchWithRetry<T>(path, { method: "POST", body: JSON.stringify(body) }),
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
