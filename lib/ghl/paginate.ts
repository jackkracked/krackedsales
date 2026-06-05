import { ghl } from "./client";
import type { GHLOpportunity } from "./types";

/**
 * Fetch EVERY page of a GHL `/opportunities/search` query.
 *
 * Pass the query WITHOUT `limit`/`page` params — this appends `limit=100` and
 * loops every page (page 1 reveals `meta.total`, the rest fetch in parallel).
 * Prevents the "first 100 only" data-integrity bug across the app.
 *
 * Never throws — returns whatever it managed to fetch (callers degrade safely).
 */
export async function fetchAllOpportunities(queryBase: string): Promise<GHLOpportunity[]> {
  const sep = queryBase.includes("?") ? "&" : "?";
  const MAX_PAGES = 100; // hard cap: 10,000 opportunities
  const all: GHLOpportunity[] = [];
  try {
    const first = await ghl.get<{ opportunities?: GHLOpportunity[]; meta?: { total?: number } }>(
      `${queryBase}${sep}limit=100&page=1`,
    );
    const firstBatch = first.opportunities ?? [];
    all.push(...firstBatch);
    const total = first.meta?.total ?? 0;

    if (total > 100) {
      // meta.total is present and reliable on /opportunities/search — fan the
      // remaining pages out in parallel (fast).
      const pages = Math.min(Math.ceil(total / 100), MAX_PAGES);
      const rest = await Promise.all(
        Array.from({ length: pages - 1 }, (_, i) =>
          ghl.get<{ opportunities?: GHLOpportunity[] }>(`${queryBase}${sep}limit=100&page=${i + 2}`),
        ),
      );
      for (const p of rest) all.push(...(p.opportunities ?? []));
    } else if (!first.meta?.total && firstBatch.length === 100) {
      // Defensive fallback: meta.total missing but the page was full — keep
      // paging sequentially until a short page proves we've reached the end.
      for (let page = 2; page <= MAX_PAGES; page++) {
        const d = await ghl.get<{ opportunities?: GHLOpportunity[] }>(
          `${queryBase}${sep}limit=100&page=${page}`,
        );
        const batch = d.opportunities ?? [];
        all.push(...batch);
        if (batch.length < 100) break;
      }
    }
  } catch (err) {
    console.error("[ghl/paginate] fetchAllOpportunities failed:", err);
  }
  return all;
}
