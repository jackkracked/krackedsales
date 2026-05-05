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

async function ghlFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${GHL_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { ...getHeaders(), ...(options.headers ?? {}) },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GHL API error ${res.status} on ${path}: ${body}`);
  }

  return res.json() as Promise<T>;
}

async function ghlFetchWithRetry<T>(
  path: string,
  options: RequestInit = {},
  retries = 3
): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await ghlFetch<T>(path, options);
    } catch (err) {
      const isRateLimit = err instanceof Error && err.message.includes("429");
      if (!isRateLimit || attempt === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }
  throw new Error("GHL fetch failed after retries");
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
