import { db } from "@/lib/db";
import { metaPages } from "@/lib/db/schema";

const META_BASE = "https://graph.facebook.com/v25.0";

/**
 * Load the page access token from the DB first, fall back to env var.
 * If a pageId is given, tries to find that specific page; otherwise uses the first row.
 */
export async function getPageToken(pageId?: string): Promise<string> {
  try {
    const rows = await db().select().from(metaPages).limit(10);
    if (rows.length > 0) {
      const row = pageId
        ? rows.find((r) => r.pageId === pageId) ?? rows[0]
        : rows[0];
      return row.pageAccessToken;
    }
  } catch {
    // DB unavailable — fall through to env var
  }

  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) throw new Error("META_PAGE_ACCESS_TOKEN is not set and no pages are connected");
  return token;
}

/**
 * Load the page ID from DB first, fall back to env var.
 */
export async function getPageId(): Promise<string> {
  try {
    const rows = await db().select({ pageId: metaPages.pageId }).from(metaPages).limit(1);
    if (rows.length > 0) return rows[0].pageId;
  } catch {
    // DB unavailable — fall through to env var
  }

  const id = process.env.META_PAGE_ID;
  if (!id) throw new Error("META_PAGE_ID is not set and no pages are connected");
  return id;
}

// Internal: sync token getter still works when called from sync contexts
// (kept for the legacy meta object which resolves token per-request)
function getTokenSync(): string {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) throw new Error("META_PAGE_ACCESS_TOKEN is not set");
  return token;
}

async function metaFetch<T>(
  path: string,
  token: string,
  options: RequestInit = {},
  params?: Record<string, string>
): Promise<T> {
  const url = new URL(`${META_BASE}${path}`);

  url.searchParams.set("access_token", token);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url.toString(), {
    ...options,
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Meta API error ${res.status} on ${path}: ${body}`);
  }

  return res.json() as Promise<T>;
}

/**
 * Build a Meta API client bound to a specific page token.
 * Use this when you already have a token (e.g. per-page iteration).
 */
export function metaForPage(token: string) {
  return {
    get: <T>(path: string, params?: Record<string, string>): Promise<T> =>
      metaFetch<T>(path, token, {}, params),

    post: <T>(path: string, body: Record<string, unknown>): Promise<T> =>
      metaFetch<T>(
        path,
        token,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      ),

    async paginate<T>(path: string, params?: Record<string, string>): Promise<T[]> {
      const results: T[] = [];
      let nextUrl: string | null = null;

      const first = await metaFetch<{ data: T[]; paging?: { next?: string } }>(
        path,
        token,
        {},
        params
      );
      results.push(...(first.data ?? []));
      nextUrl = first.paging?.next ?? null;

      while (nextUrl) {
        const res = await fetch(nextUrl, { cache: "no-store" });
        if (!res.ok) break;
        const page = (await res.json()) as {
          data: T[];
          paging?: { next?: string };
        };
        results.push(...(page.data ?? []));
        nextUrl = page.paging?.next ?? null;
      }

      return results;
    },
  };
}

/**
 * Default Meta client — resolves the token from DB (first connected page)
 * or falls back to META_PAGE_ACCESS_TOKEN env var.
 *
 * Existing callers (meta.get, meta.post, meta.paginate) keep working unchanged.
 */
export const meta = {
  get: async <T>(path: string, params?: Record<string, string>): Promise<T> => {
    const token = await getPageToken().catch(() => getTokenSync());
    return metaFetch<T>(path, token, {}, params);
  },

  post: async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
    const token = await getPageToken().catch(() => getTokenSync());
    return metaFetch<T>(
      path,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
  },

  paginate: async <T>(path: string, params?: Record<string, string>): Promise<T[]> => {
    const token = await getPageToken().catch(() => getTokenSync());
    const results: T[] = [];
    let nextUrl: string | null = null;

    const first = await metaFetch<{ data: T[]; paging?: { next?: string } }>(
      path,
      token,
      {},
      params
    );
    results.push(...(first.data ?? []));
    nextUrl = first.paging?.next ?? null;

    while (nextUrl) {
      const res = await fetch(nextUrl, { cache: "no-store" });
      if (!res.ok) break;
      const page = (await res.json()) as {
        data: T[];
        paging?: { next?: string };
      };
      results.push(...(page.data ?? []));
      nextUrl = page.paging?.next ?? null;
    }

    return results;
  },
};

/**
 * Returns the configured Facebook Page ID.
 * Sync version kept for backward compatibility — reads env var only.
 * Use getPageId() (async) for DB-first lookup.
 */
export function pageId(): string {
  const id = process.env.META_PAGE_ID;
  if (!id) throw new Error("META_PAGE_ID is not set");
  return id;
}
