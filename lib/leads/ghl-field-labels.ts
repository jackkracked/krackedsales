/**
 * GHL custom-field id -> question label.
 *
 * A lead's answers are stored as `[{ id: "1ex0jpJBMoSEZMOZoWZs", value: "Under $3M/year" }]`.
 * Without this map the drawer renders the raw id as the question, which is worse than useless.
 *
 * Cached in module scope for an hour: 24 fields that change maybe twice a year, versus one
 * extra GHL round-trip on every page of the Leads Centre.
 */
import { ghl, locationId } from "@/lib/ghl/client";

type GhlCustomField = { id?: string; name?: string };

let cache: { at: number; labels: Record<string, string> } | null = null;
const TTL_MS = 60 * 60 * 1000;

export async function getGhlFieldLabels(): Promise<Record<string, string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.labels;

  try {
    const res = await ghl.get<{ customFields?: GhlCustomField[] }>(
      `/locations/${locationId()}/customFields`,
    );
    const labels: Record<string, string> = {};
    for (const f of res.customFields ?? []) {
      if (f.id && f.name) labels[f.id] = f.name;
    }
    cache = { at: Date.now(), labels };
    return labels;
  } catch (err) {
    // A GHL blip must never blank the drawer. Serve stale rather than nothing, and fall back
    // to de-snake-casing the key, which still reads better than a bare id.
    console.error("[leads] could not load GHL field labels:", err);
    return cache?.labels ?? {};
  }
}
