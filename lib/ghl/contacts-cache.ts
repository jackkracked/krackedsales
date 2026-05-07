import { ghl, locationId } from "@/lib/ghl/client";

export interface GHLContactFull {
  id: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  name: string; // normalized
  email?: string;
  phone?: string;
  source?: string;
  tags?: string[];
  website?: string;
  createdAt: string;
  dateAdded?: string;
}

interface GHLContactsResponse {
  contacts: GHLContactFull[];
  meta?: { total?: number; nextPageUrl?: string };
}

// Module-level cache — survives across requests in the same process
let _cache: GHLContactFull[] | null = null;
let _cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function normalizeName(c: GHLContactFull): string {
  if (c.fullName?.trim()) return c.fullName.trim();
  const parts = [c.firstName, c.lastName].filter(Boolean);
  if (parts.length) return parts.join(" ").trim();
  return c.name?.trim() || "Unknown";
}

async function fetchAllContacts(): Promise<GHLContactFull[]> {
  const locId = locationId();
  const all: GHLContactFull[] = [];
  const MAX_PAGES = 30;

  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const data = await ghl.get<GHLContactsResponse>(
        `/contacts/?locationId=${locId}&limit=100&page=${page}&sortBy=date_added&sortOrder=desc`
      );
      const contacts = data.contacts ?? [];
      if (!contacts.length) break;
      all.push(...contacts);
      if (contacts.length < 100) break; // last page
    } catch (err) {
      console.error(`[contacts-cache] page ${page} error`, err);
      break;
    }
  }

  return all.map((c) => ({ ...c, name: normalizeName(c) }));
}

export async function getCachedGHLContacts(): Promise<GHLContactFull[]> {
  const now = Date.now();
  if (_cache && now - _cachedAt < CACHE_TTL_MS) return _cache;
  _cache = await fetchAllContacts();
  _cachedAt = Date.now();
  return _cache;
}

export function invalidateContactsCache(): void {
  _cache = null;
  _cachedAt = 0;
}
