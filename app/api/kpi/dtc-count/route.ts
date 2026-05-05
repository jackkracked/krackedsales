import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import { categorizeBrand } from "@/lib/ai/gemini";
import { db } from "@/lib/db";
import { brandCategories } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PIPELINE_ID = "JRvrpfcwAlAOM38mPAUJ";
const WEBSITE_CUSTOM_FIELD_ID = "te2hH1PWliUW8R18epQn";

interface RawOpportunity {
  id: string;
  contact?: { id: string };
  createdAt: string;
}

interface RawContact {
  customFields?: Array<{ id: string; value: string }>;
  customField?: Array<{ id: string; value: string }>;
}

function normalizeDomain(url: string): string {
  return url
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "")
    .split("/")[0]
    .split("?")[0]
    .trim();
}

function looksLikeUrl(s: string): boolean {
  return /\.[a-z]{2,}/.test(s) || s.startsWith("http");
}

/** Fetch contacts in batches to avoid GHL rate limits */
async function fetchContactsInBatches(
  contactIds: string[]
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  const BATCH = 10;

  for (let i = 0; i < contactIds.length; i += BATCH) {
    const batch = contactIds.slice(i, i + BATCH);
    await Promise.allSettled(
      batch.map(async (contactId) => {
        try {
          const contact = await ghl.get<RawContact>(`/contacts/${contactId}`);
          const fields = contact.customFields ?? contact.customField ?? [];
          const website = fields.find((f) => f.id === WEBSITE_CUSTOM_FIELD_ID)?.value ?? null;
          result.set(contactId, website && looksLikeUrl(website) ? website : null);
        } catch {
          result.set(contactId, null);
        }
      })
    );
  }

  return result;
}

export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since");
  const until = req.nextUrl.searchParams.get("until");
  const sinceMs = since ? new Date(since).getTime() : 0;
  const untilMs = until ? new Date(`${until}T23:59:59Z`).getTime() : Infinity;

  try {
    const loc = locationId();

    // ── 1. Fetch all pipeline opportunities (paginated) ────────────────────────
    const allOpps: RawOpportunity[] = [];
    let page = 1;
    while (true) {
      const res = await ghl.get<{
        opportunities: RawOpportunity[];
        meta?: { nextPage: number | null };
      }>(
        `/opportunities/search?location_id=${loc}&pipeline_id=${PIPELINE_ID}&limit=100&page=${page}`
      );
      const batch = res.opportunities ?? [];
      allOpps.push(...batch);
      if (!res.meta?.nextPage || batch.length < 100) break;
      page++;
    }

    // ── 2. Filter by date range ────────────────────────────────────────────────
    // GHL returns createdAt as a numeric millisecond timestamp string (e.g. "1714000000000"),
    // not an ISO date — parse as integer before comparing.
    const inRange = allOpps.filter((opp) => {
      const raw = opp.createdAt;
      const ms = typeof raw === "string" && /^\d+$/.test(raw)
        ? parseInt(raw, 10)
        : new Date(raw).getTime();
      return ms >= sinceMs && ms <= untilMs;
    });

    const contactIds = [...new Set(inRange.map((o) => o.contact?.id).filter(Boolean) as string[])];

    if (contactIds.length === 0) {
      return NextResponse.json({ count: 0, total: 0 });
    }

    // ── 3. Fetch contact websites in batches ───────────────────────────────────
    const websiteMap = await fetchContactsInBatches(contactIds);

    // Collect unique domains that have a website
    const domainToContactIds = new Map<string, string[]>();
    for (const [contactId, website] of websiteMap) {
      if (!website) continue;
      const domain = normalizeDomain(website);
      if (!domain) continue;
      const existing = domainToContactIds.get(domain) ?? [];
      existing.push(contactId);
      domainToContactIds.set(domain, existing);
    }

    const domains = [...domainToContactIds.keys()];

    if (domains.length === 0) {
      return NextResponse.json({ count: 0, total: contactIds.length });
    }

    // ── 4. Check DB cache for already-analyzed domains ─────────────────────────
    const cached = await db()
      .select()
      .from(brandCategories)
      .where(inArray(brandCategories.domain, domains));

    const cachedMap = new Map(cached.map((r) => [r.domain, r.category]));

    // ── 5. Categorize uncached domains (cap at 20 to keep response time fast) ──
    const uncached = domains.filter((d) => !cachedMap.has(d)).slice(0, 20);

    if (uncached.length > 0) {
      await Promise.allSettled(
        uncached.map(async (domain) => {
          try {
            // Use domain name only (no page scrape) to keep this fast
            const result = await categorizeBrand({ domain, content: "" });
            if (result.category) {
              cachedMap.set(domain, result.category);
              await db().insert(brandCategories).values({
                domain,
                category: result.category,
                reason: result.reason ?? null,
              }).onConflictDoUpdate({
                target: brandCategories.domain,
                set: { category: result.category, reason: result.reason ?? null, analyzedAt: new Date() },
              });
            }
          } catch {
            // Non-fatal — just skip this domain
          }
        })
      );
    }

    // ── 6. Count DTC (ecommerce) contacts ─────────────────────────────────────
    let dtcCount = 0;
    for (const [domain, cIds] of domainToContactIds) {
      const category = cachedMap.get(domain);
      if (category === "ecommerce") {
        dtcCount += cIds.length;
      }
    }

    return NextResponse.json({ count: dtcCount, total: contactIds.length });
  } catch (err) {
    console.error("[/api/kpi/dtc-count]", err);
    return NextResponse.json({ count: 0, total: 0 }, { status: 500 });
  }
}
