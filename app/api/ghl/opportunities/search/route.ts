import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import type { GHLOpportunity } from "@/lib/ghl/types";

export const dynamic = "force-dynamic";

interface GHLContactsResponse {
  contacts: { id: string; firstName?: string; lastName?: string; name?: string }[];
}

/** GET /api/ghl/opportunities/search?q=searchTerm&limit=8
 *  Two-step search: contact name → opportunities by contact_id,
 *  plus a parallel opportunity name (brand) search via q=.
 *  Results are merged and deduplicated.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "8", 10), 20);

  if (!q || q.length < 2) {
    return NextResponse.json({ opportunities: [] });
  }

  const loc = locationId();

  try {
    // Run contact-name search and opportunity-name search in parallel
    const [contactsRes, brandRes] = await Promise.allSettled([
      ghl.get<GHLContactsResponse>(
        `/contacts/?locationId=${loc}&query=${encodeURIComponent(q)}&limit=5`
      ),
      ghl.get<{ opportunities: GHLOpportunity[] }>(
        `/opportunities/search?location_id=${loc}&q=${encodeURIComponent(q)}&limit=${limit}`
      ),
    ]);

    const seen = new Set<string>();
    const results: {
      id: string;
      name: string;
      contactId: string | null;
      contactName: string | null;
      pipelineStageId: string;
    }[] = [];

    function addOpps(opps: GHLOpportunity[]) {
      for (const o of opps) {
        if (seen.has(o.id)) continue;
        seen.add(o.id);
        results.push({
          id: o.id,
          name: o.name,
          contactId: o.contact?.id ?? null,
          contactName: o.contact?.name ?? null,
          pipelineStageId: o.pipelineStageId,
        });
      }
    }

    // Step 2: for each matched contact, fetch their opportunities
    if (contactsRes.status === "fulfilled") {
      const contacts = contactsRes.value.contacts ?? [];
      const contactOpps = await Promise.allSettled(
        contacts.slice(0, 4).map((c) =>
          ghl.get<{ opportunities: GHLOpportunity[] }>(
            `/opportunities/search?location_id=${loc}&contact_id=${c.id}&limit=3`
          )
        )
      );
      for (const res of contactOpps) {
        if (res.status === "fulfilled") addOpps(res.value.opportunities ?? []);
      }
    }

    // Add brand/opportunity name matches
    if (brandRes.status === "fulfilled") {
      addOpps(brandRes.value.opportunities ?? []);
    }

    return NextResponse.json({ opportunities: results.slice(0, limit) });
  } catch (err) {
    console.error("[GET /api/ghl/opportunities/search]", err);
    return NextResponse.json({ opportunities: [] }, { status: 500 });
  }
}
