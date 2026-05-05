import { NextRequest, NextResponse } from "next/server";
import { ghl, locationId } from "@/lib/ghl/client";
import type { GHLOpportunity, GHLPipeline } from "@/lib/ghl/types";

export const dynamic = "force-dynamic";

function normaliseDomain(str: string): string {
  return str
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim();
}

export async function GET(req: NextRequest) {
  const domain = req.nextUrl.searchParams.get("domain");
  if (!domain) return NextResponse.json({ opportunity: null });

  const term = normaliseDomain(domain);
  const loc = locationId();

  try {
    // Step 1: search GHL contacts by the brand name / domain
    const contactRes = await ghl.get<{ contacts: Array<{ id: string; name?: string; email?: string }> }>(
      `/contacts/?locationId=${loc}&query=${encodeURIComponent(term)}&limit=5`
    );

    const contacts = contactRes.contacts ?? [];
    console.log(`[by-domain] "${term}" → ${contacts.length} contacts`, contacts.map(c => `${c.name} <${c.email}>`));

    const contactId = contacts[0]?.id ?? null;
    if (!contactId) {
      return NextResponse.json({ opportunity: null });
    }

    // Step 2: find opportunity for that contact
    const [oppRes, pipeRes] = await Promise.all([
      ghl.get<{ opportunities: GHLOpportunity[] }>(
        `/opportunities/search?location_id=${loc}&contact_id=${contactId}&limit=1`
      ),
      ghl.get<{ pipelines: GHLPipeline[] }>(
        `/opportunities/pipelines?locationId=${loc}`
      ).catch(() => ({ pipelines: [] })),
    ]);

    const opp = oppRes.opportunities?.[0] ?? null;
    if (!opp) {
      console.log(`[by-domain] contact ${contactId} has no opportunity`);
      return NextResponse.json({ opportunity: null });
    }

    const pipeline = pipeRes.pipelines?.find((p) => p.id === opp.pipelineId);
    const stageName = pipeline?.stages?.find((s) => s.id === opp.pipelineStageId)?.name ?? "Unknown";

    console.log(`[by-domain] found opp "${opp.name}" stage "${stageName}"`);
    return NextResponse.json({ opportunity: { ...opp, pipelineStageId_name: stageName } });

  } catch (err) {
    console.error("[GET /api/ghl/opportunities/by-domain]", err);
    return NextResponse.json({ opportunity: null });
  }
}
