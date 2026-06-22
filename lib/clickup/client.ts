const CLICKUP_BASE = "https://api.clickup.com/api/v2";

function getHeaders() {
  // Trim: a trailing newline pasted into the env var would corrupt the header.
  const token = process.env.CLICKUP_API_TOKEN?.trim();
  if (!token) throw new Error("CLICKUP_API_TOKEN is not set");
  return {
    Authorization: token,
    "Content-Type": "application/json",
  };
}

async function clickupFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${CLICKUP_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { ...getHeaders(), ...(options.headers ?? {}) },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ClickUp API error ${res.status} on ${path}: ${body}`);
  }

  return res.json() as Promise<T>;
}

export const clickup = {
  get: <T>(path: string) => clickupFetch<T>(path),
  post: <T>(path: string, body: unknown) =>
    clickupFetch<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    clickupFetch<T>(path, { method: "PUT", body: JSON.stringify(body) }),
};

export function demoListId(): string {
  const id = process.env.CLICKUP_DEMO_LIST_ID?.trim();
  if (!id) throw new Error("CLICKUP_DEMO_LIST_ID is not set");
  return id;
}
